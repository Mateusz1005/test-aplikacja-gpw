"use server";

import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { sendPasswordResetEmail } from "@/lib/integrations/email";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

type Credentials = {
  email: string;
  password: string;
};

function getCredentials(formData: FormData): Credentials | null {
  const email = formData.get("email");
  const password = formData.get("password");

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.trim().length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
    password.length === 0 ||
    password.length > 128
  ) {
    return null;
  }

  return { email: email.trim().toLowerCase(), password };
}

export async function signIn(formData: FormData) {
  if (!isSupabaseConfigured()) {
    redirect("/login?error=configuration");
  }

  const credentials = getCredentials(formData);
  if (!credentials) {
    redirect("/login?error=invalid-input");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(credentials);

  if (error) {
    redirect("/login?error=credentials");
  }

  const { error: historyError } = await supabase.rpc("record_login_event");
  if (historyError) {
    throw historyError;
  }

  redirect("/dashboard");
}

export async function signUp(formData: FormData) {
  if (!isSupabaseConfigured()) {
    redirect("/register?error=configuration");
  }

  const credentials = getCredentials(formData);
  if (!credentials || credentials.password.length < 8) {
    redirect("/register?error=invalid-input");
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    redirect("/register?error=configuration");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...credentials,
    options: {
      emailRedirectTo: new URL("/auth/callback", siteUrl).toString(),
    },
  });

  if (error) {
    redirect("/register?error=signup");
  }

  if (!data.session) {
    redirect("/login?message=check-email");
  }

  redirect("/dashboard");
}

export async function requestPasswordReset(formData: FormData) {
  const emailValue = formData.get("email");

  if (
    isSupabaseConfigured() &&
    isAdminClientConfigured() &&
    typeof emailValue === "string" &&
    emailValue.trim().length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue.trim()) &&
    process.env.RESEND_API_KEY
  ) {
    const email = emailValue.trim().toLowerCase();
    const admin = createAdminClient();
    const { data: settings, error: settingsError } = await admin
      .from("app_settings")
      .select("sender_email")
      .eq("id", true)
      .maybeSingle();

    if (settingsError) {
      console.error("Nie udało się odczytać ustawień wysyłki resetu hasła.", settingsError);
    } else if (settings?.sender_email) {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

      if (!siteUrl) {
        console.error("Brak publicznego adresu aplikacji do resetu hasła.");
      } else {
        const { data, error } = await admin.auth.admin.generateLink({
          type: "recovery",
          email,
          options: {
            redirectTo: new URL("/auth/callback?next=/reset-password", siteUrl).toString(),
          },
        });

        if (error) {
          console.error("Nie udało się utworzyć linku resetu hasła.", error.message);
        } else {
          const resetUrl = new URL("/auth/callback", siteUrl);
          resetUrl.searchParams.set("token_hash", data.properties.hashed_token);
          resetUrl.searchParams.set("type", "recovery");
          resetUrl.searchParams.set("next", "/reset-password");

          try {
            await sendPasswordResetEmail({
              from: settings.sender_email,
              resetUrl: resetUrl.toString(),
              to: email,
            });
          } catch (error) {
            console.error(
              "Wysyłka linku resetu hasła nie powiodła się.",
              error instanceof Error ? error.message : "Nieznany błąd dostawcy poczty.",
            );
          }
        }
      }
    } else if (!settings) {
      console.error("Nie znaleziono ustawień aplikacji dla resetu hasła.");
    }
  } else {
    console.error("Reset hasła nie jest skonfigurowany lub otrzymał niepoprawny adres e-mail.");
  }

  redirect("/forgot-password?message=requested");
}

export async function updatePassword(formData: FormData) {
  if (!isSupabaseConfigured()) {
    redirect("/forgot-password?error=configuration");
  }

  const password = formData.get("password");
  const confirmation = formData.get("password_confirmation");

  if (
    typeof password !== "string" ||
    typeof confirmation !== "string" ||
    password.length < 8 ||
    password.length > 128 ||
    password !== confirmation
  ) {
    redirect("/reset-password?error=invalid-input");
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError && !isAuthSessionMissingError(userError)) {
    throw userError;
  }

  if (!user) {
    redirect("/forgot-password?error=invalid-link");
  }

  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) {
    redirect("/reset-password?error=update-failed");
  }

  const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
  if (signOutError) {
    throw signOutError;
  }

  redirect("/login?message=password-updated");
}

export async function signOut() {
  if (!isSupabaseConfigured()) {
    redirect("/login?error=configuration");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    redirect("/dashboard?error=sign-out");
  }

  redirect("/login?message=signed-out");
}
