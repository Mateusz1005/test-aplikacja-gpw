"use server";

import { redirect } from "next/navigation";
import { requireAdmin, requireCurrentUser } from "@/lib/auth/guards";
import { sendPasswordResetEmail } from "@/lib/integrations/email";
import {
  CatalogImportError,
  type CatalogImportRow,
  MAX_CATALOG_IMPORT_BYTES,
  parseCatalogImport,
} from "@/lib/admin/company-catalog-import";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

const userIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getUserId(formData: FormData): string {
  const userId = formData.get("user_id");
  if (typeof userId !== "string" || !userIdPattern.test(userId)) {
    redirect("/admin?error=invalid-user");
  }
  return userId;
}

function getText(formData: FormData, name: string, maxLength: number): string {
  const value = formData.get(name);
  if (typeof value !== "string" || value.length > maxLength) {
    redirect("/admin?error=invalid-input");
  }
  return value.trim();
}

function getDays(formData: FormData, name: string, fallback?: number): number {
  const value = formData.get(name);
  if (value === null && fallback !== undefined) {
    return fallback;
  }
  if (typeof value !== "string" || !/^\d{1,4}$/.test(value)) {
    redirect("/admin?error=invalid-days");
  }
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
    redirect("/admin?error=invalid-days");
  }
  return days;
}

async function getManagedUser(userId: string, actorId: string) {
  if (userId === actorId) {
    redirect("/admin?error=self-action");
  }

  const admin = createAdminClient();
  const [{ data: authResult, error: authError }, { data: role, error: roleError }] =
    await Promise.all([
      admin.auth.admin.getUserById(userId),
      admin
        .from("user_roles")
        .select("access_role")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

  if (authError) {
    throw authError;
  }
  if (roleError) {
    throw roleError;
  }
  if (!authResult.user || !role) {
    redirect("/admin?error=invalid-user");
  }
  if (role.access_role === "admin") {
    redirect("/admin?error=protected-account");
  }

  return { admin, target: authResult.user };
}

async function writeAudit(
  admin: ReturnType<typeof createAdminClient>,
  actorId: string,
  targetUserId: string | null,
  action: string,
  details: Record<string, string | number | boolean | null>,
) {
  const { error } = await admin.from("admin_audit_log").insert({
    actor_id: actorId,
    target_user_id: targetUserId,
    action,
    details,
  });

  if (error) {
    throw error;
  }
}

export async function grantManualAccess(formData: FormData) {
  const { user } = await requireAdmin();
  const userId = getUserId(formData);
  const note = getText(formData, "note", 500);
  const { admin, target } = await getManagedUser(userId, user.id);

  const { data: settings, error: settingsError } = await admin
    .from("app_settings")
    .select("manual_access_days")
    .eq("id", true)
    .single();
  if (settingsError) {
    throw settingsError;
  }

  const indefinite = formData.get("indefinite") === "on";
  const days = getDays(formData, "days", settings.manual_access_days);
  const startsAt = new Date();
  const expiresAt = indefinite
    ? null
    : new Date(startsAt.getTime() + days * 24 * 60 * 60 * 1000);
  const { error } = await admin
    .from("user_access")
    .update({
      access_status: "active",
      access_type: "manual",
      access_starts_at: startsAt.toISOString(),
      access_expires_at: expiresAt?.toISOString() ?? null,
      granted_by: user.id,
      note,
      updated_at: startsAt.toISOString(),
    })
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  await writeAudit(admin, user.id, userId, "access.manual_granted", {
    email: target.email ?? "",
    days: indefinite ? 0 : days,
    indefinite,
    note,
  });
  redirect("/admin?notice=manual-granted");
}

export async function extendAccess(formData: FormData) {
  const { user } = await requireAdmin();
  const userId = getUserId(formData);
  const days = getDays(formData, "days");
  const { admin, target } = await getManagedUser(userId, user.id);

  const { data: current, error: currentError } = await admin
    .from("user_access")
    .select("access_status, access_type, access_expires_at")
    .eq("user_id", userId)
    .single();
  if (currentError) {
    throw currentError;
  }
  if (current.access_status === "blocked") {
    redirect("/admin?error=blocked-account");
  }
  if (!current.access_expires_at) {
    redirect("/admin?error=indefinite-access");
  }

  const now = new Date();
  const oldExpiry = new Date(current.access_expires_at);
  const startAt = oldExpiry > now ? oldExpiry : now;
  const expiresAt = new Date(startAt.getTime() + days * 24 * 60 * 60 * 1000);
  const { error } = await admin
    .from("user_access")
    .update({
      access_status: "active",
      access_type: current.access_type === "none" ? "manual" : current.access_type,
      access_starts_at: now.toISOString(),
      access_expires_at: expiresAt.toISOString(),
      granted_by: user.id,
      updated_at: now.toISOString(),
    })
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  await writeAudit(admin, user.id, userId, "access.extended", {
    email: target.email ?? "",
    days,
    expires_at: expiresAt.toISOString(),
  });
  redirect("/admin?notice=access-extended");
}

export async function grantSubscriptionTrial(formData: FormData) {
  const { user } = await requireAdmin();
  const userId = getUserId(formData);
  const note = getText(formData, "note", 500);
  const { admin, target } = await getManagedUser(userId, user.id);

  const { data: settings, error: settingsError } = await admin
    .from("app_settings")
    .select("subscription_trial_days")
    .eq("id", true)
    .single();
  if (settingsError) {
    throw settingsError;
  }

  const startsAt = new Date();
  const expiresAt = new Date(
    startsAt.getTime() + settings.subscription_trial_days * 24 * 60 * 60 * 1000,
  );
  const { error } = await admin
    .from("user_access")
    .update({
      access_status: "active",
      access_type: "subscription_trial",
      access_starts_at: startsAt.toISOString(),
      access_expires_at: expiresAt.toISOString(),
      granted_by: user.id,
      note,
      updated_at: startsAt.toISOString(),
    })
    .eq("user_id", userId);
  if (error) {
    throw error;
  }

  await writeAudit(admin, user.id, userId, "access.subscription_trial_granted", {
    email: target.email ?? "",
    days: settings.subscription_trial_days,
    expires_at: expiresAt.toISOString(),
    note,
  });
  redirect("/admin?notice=subscription-trial-granted");
}

export async function activateSubscription(formData: FormData) {
  const { user } = await requireAdmin();
  const userId = getUserId(formData);
  const expiresAtValue = getText(formData, "expires_at", 40);
  const note = getText(formData, "note", 500);
  const expiresAt = new Date(expiresAtValue);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) {
    redirect("/admin?error=invalid-date");
  }

  const { admin, target } = await getManagedUser(userId, user.id);
  const now = new Date();
  const { error } = await admin
    .from("user_access")
    .update({
      access_status: "active",
      access_type: "subscription",
      access_starts_at: now.toISOString(),
      access_expires_at: expiresAt.toISOString(),
      granted_by: user.id,
      note,
      updated_at: now.toISOString(),
    })
    .eq("user_id", userId);
  if (error) {
    throw error;
  }

  await writeAudit(admin, user.id, userId, "access.subscription_activated", {
    email: target.email ?? "",
    expires_at: expiresAt.toISOString(),
    note,
  });
  redirect("/admin?notice=subscription-activated");
}

export async function blockUser(formData: FormData) {
  const { user } = await requireAdmin();
  const userId = getUserId(formData);
  const note = getText(formData, "note", 500);
  const { admin, target } = await getManagedUser(userId, user.id);
  const now = new Date();
  const { error } = await admin
    .from("user_access")
    .update({
      access_status: "blocked",
      granted_by: user.id,
      note,
      updated_at: now.toISOString(),
    })
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  await writeAudit(admin, user.id, userId, "access.blocked", {
    email: target.email ?? "",
    note,
  });
  redirect("/admin?notice=user-blocked");
}

export async function deleteUser(formData: FormData) {
  const { user } = await requireAdmin();
  const userId = getUserId(formData);
  const { admin, target } = await getManagedUser(userId, user.id);
  const confirmation = getText(formData, "confirm_email", 320).toLowerCase();
  if (!target.email || confirmation !== target.email.toLowerCase()) {
    redirect("/admin?error=delete-confirmation");
  }

  const forecastPaths: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data: forecasts, error: forecastsError } = await admin
      .from("user_analyst_forecasts")
      .select("storage_path")
      .eq("owner_id", userId)
      .range(offset, offset + 999);
    if (forecastsError) {
      throw forecastsError;
    }
    forecastPaths.push(...forecasts.map(({ storage_path }) => storage_path));
    if (forecasts.length < 1000) {
      break;
    }
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    throw error;
  }

  let storageCleanupError: Error | null = null;
  if (forecastPaths.length > 0) {
    const { error } = await admin.storage
      .from("analyst-forecasts")
      .remove(forecastPaths);
    storageCleanupError = error;
  }

  const { error: auditError } = await admin.from("admin_audit_log").insert({
    actor_id: user.id,
    target_user_id: null,
    action: "user.deleted",
    details: {
      email: target.email ?? "",
      user_id: userId,
    },
  });
  if (storageCleanupError && auditError) {
    throw new AggregateError(
      [storageCleanupError, auditError],
      "Konto usunięto, ale nie udało się usunąć wszystkich prywatnych plików ani zapisać audytu.",
    );
  }
  if (storageCleanupError) {
    throw new AggregateError(
      [storageCleanupError],
      "Konto usunięto, ale nie udało się usunąć wszystkich prywatnych plików prognoz.",
    );
  }
  if (auditError) {
    throw auditError;
  }

  redirect("/admin?notice=user-deleted");
}

export async function sendAdminPasswordReset(formData: FormData) {
  const { user } = await requireAdmin();
  const userId = getUserId(formData);
  const { admin, target } = await getManagedUser(userId, user.id);
  const email = target.email;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  if (!email || !siteUrl || !process.env.RESEND_API_KEY) {
    redirect("/admin?error=email-configuration");
  }

  const { data: settings, error: settingsError } = await admin
    .from("app_settings")
    .select("sender_email")
    .eq("id", true)
    .single();
  if (settingsError) {
    throw settingsError;
  }
  if (!settings.sender_email) {
    redirect("/admin?error=email-configuration");
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: {
      redirectTo: new URL("/auth/callback?next=/reset-password", siteUrl).toString(),
    },
  });
  if (error) {
    throw error;
  }

  const resetUrl = new URL("/auth/callback", siteUrl);
  resetUrl.searchParams.set("token_hash", data.properties.hashed_token);
  resetUrl.searchParams.set("type", "recovery");
  resetUrl.searchParams.set("next", "/reset-password");
  await sendPasswordResetEmail({
    from: settings.sender_email,
    resetUrl: resetUrl.toString(),
    to: email,
  });
  await writeAudit(admin, user.id, userId, "user.password_reset_sent", { email });
  redirect("/admin?notice=password-reset-sent");
}

export async function saveAdminSettings(formData: FormData) {
  const { user } = await requireAdmin();
  const trialDays = getDays(formData, "trial_days");
  const subscriptionTrialDays = getDays(formData, "subscription_trial_days");
  const manualAccessDays = getDays(formData, "manual_access_days");
  const senderEmail = getText(formData, "sender_email", 320).toLowerCase();

  if (
    trialDays > 90 ||
    subscriptionTrialDays > 180 ||
    manualAccessDays > 3650 ||
    (senderEmail !== "" &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail))
  ) {
    redirect("/admin?error=invalid-settings");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("app_settings")
    .update({
      trial_days: trialDays,
      subscription_trial_days: subscriptionTrialDays,
      manual_access_days: manualAccessDays,
      sender_email: senderEmail,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", true);
  if (error) {
    throw error;
  }

  await writeAudit(admin, user.id, null, "settings.updated", {
    trial_days: trialDays,
    subscription_trial_days: subscriptionTrialDays,
    manual_access_days: manualAccessDays,
    sender_email: senderEmail,
  });
  redirect("/admin?notice=settings-saved");
}

export async function importCompanyCatalog(formData: FormData) {
  const { user } = await requireAdmin();
  const upload = formData.get("catalog_file");

  if (typeof File === "undefined" || !(upload instanceof File) || upload.size === 0) {
    redirect("/admin?error=catalog-import-file");
  }
  if (upload.size > MAX_CATALOG_IMPORT_BYTES) {
    redirect("/admin?error=catalog-import-size");
  }
  if (!isAdminClientConfigured()) {
    throw new Error("Brakuje serwerowej konfiguracji administracyjnej Supabase.");
  }

  let rows: CatalogImportRow[];
  try {
    rows = await parseCatalogImport(
      Buffer.from(await upload.arrayBuffer()),
      upload.name,
    );
  } catch (error) {
    if (error instanceof CatalogImportError) {
      redirect("/admin?error=catalog-import-invalid");
    }
    throw error;
  }

  const admin = createAdminClient();
  const needsExistingMetadata = rows.some(
    (row) =>
      row.investor_relations_url === undefined ||
      row.investor_relations_url === null ||
      row.next_reporting_date === undefined ||
      row.next_reporting_date === null ||
      row.next_reporting_source_url === undefined ||
      row.next_reporting_source_url === null ||
      row.next_reporting_verified_at === undefined ||
      row.next_reporting_verified_at === null,
  );
  const { data: existingRows, error: existingRowsError } = needsExistingMetadata
    ? await admin
        .from("instrument_catalog")
        .select(
          "isin, investor_relations_url, next_reporting_date, next_reporting_source_url, next_reporting_verified_at",
        )
        .eq("market", "gpw_main")
        .in("isin", rows.map(({ isin }) => isin))
    : { data: [], error: null };
  if (existingRowsError) {
    throw existingRowsError;
  }
  const existingMetadata = new Map(
    (existingRows ?? []).map((row) => [row.isin, row]),
  );
  const { error } = await admin
    .from("instrument_catalog")
    .upsert(
      rows.map((row) => {
        const existing = existingMetadata.get(row.isin);
        return {
          ...row,
          investor_relations_url:
            row.investor_relations_url ?? existing?.investor_relations_url ?? null,
          next_reporting_date:
            row.next_reporting_date ?? existing?.next_reporting_date ?? null,
          next_reporting_source_url:
            row.next_reporting_source_url ?? existing?.next_reporting_source_url ?? null,
          next_reporting_verified_at:
            row.next_reporting_verified_at ?? existing?.next_reporting_verified_at ?? null,
          updated_at: new Date().toISOString(),
        };
      }),
      { onConflict: "isin,market" },
    );

  if (error) {
    throw error;
  }

  await writeAudit(admin, user.id, null, "catalog.imported", {
    rows: rows.length,
    market: "gpw_main",
  });
  revalidatePath("/admin");
  revalidatePath("/dashboard");
  redirect("/admin?notice=catalog-imported");
}

export async function bootstrapInitialAdmin() {
  const { user } = await requireCurrentUser();
  const initialAdminEmail = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();

  if (
    !initialAdminEmail ||
    !user.email ||
    user.email.toLowerCase() !== initialAdminEmail ||
    !user.email_confirmed_at
  ) {
    redirect("/admin/setup?error=not-authorized");
  }

  if (!isAdminClientConfigured()) {
    redirect("/admin/setup?error=configuration");
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("bootstrap_initial_admin", {
    target_user_id: user.id,
    target_email: user.email,
  });

  if (error) {
    throw error;
  }
  if (data !== true) {
    redirect("/admin/setup?error=already-bootstrapped");
  }

  redirect("/admin");
}
