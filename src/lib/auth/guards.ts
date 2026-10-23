import "server-only";

import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export async function requireCurrentUser() {
  if (!isSupabaseConfigured()) {
    redirect("/login?error=configuration");
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error && !isAuthSessionMissingError(error)) {
    throw error;
  }

  if (!user) {
    redirect("/login");
  }

  return { supabase, user };
}

export async function requireAdmin() {
  const { supabase, user } = await requireCurrentUser();
  const { data: role, error } = await supabase
    .from("user_roles")
    .select("access_role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!role) {
    throw new Error("Nie znaleziono roli użytkownika w bazie danych.");
  }

  if (role.access_role !== "admin") {
    redirect("/dashboard");
  }

  return { supabase, user };
}

export async function requireActiveAccess() {
  const { supabase, user } = await requireCurrentUser();
  const { data: role, error: roleError } = await supabase
    .from("user_roles")
    .select("access_role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleError) {
    throw roleError;
  }

  if (!role) {
    throw new Error("Nie znaleziono roli użytkownika w bazie danych.");
  }

  if (role.access_role === "admin") {
    return { supabase, user, access: null };
  }

  const { data: access, error: accessError } = await supabase
    .from("user_access")
    .select("access_status, access_type, access_starts_at, access_expires_at, note")
    .eq("user_id", user.id)
    .maybeSingle();

  if (accessError) {
    throw accessError;
  }

  if (!access) {
    throw new Error("Nie znaleziono stanu dostępu użytkownika w bazie danych.");
  }

  if (access.access_status !== "active") {
    redirect("/access-required");
  }

  if (
    (access.access_starts_at &&
      new Date(access.access_starts_at).getTime() > Date.now()) ||
    access.access_expires_at &&
    new Date(access.access_expires_at).getTime() <= Date.now()
  ) {
    redirect("/access-required");
  }

  return { supabase, user, access };
}
