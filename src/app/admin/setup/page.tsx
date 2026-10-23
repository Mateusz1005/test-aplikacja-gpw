import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { bootstrapInitialAdmin } from "@/app/admin/actions";
import { requireCurrentUser } from "@/lib/auth/guards";
import { isAdminClientConfigured, createAdminClient } from "@/lib/supabase/admin";

export default function AdminSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <Suspense
      fallback={
        <main className="setup-screen">
          <section className="setup-card" role="status">Weryfikuję konfigurację…</section>
        </main>
      }
    >
      <AdminSetupContent searchParams={searchParams} />
    </Suspense>
  );
}

async function AdminSetupContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await connection();
  const { user } = await requireCurrentUser();
  const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const params = await searchParams;

  if (
    !email ||
    !user.email ||
    user.email.toLowerCase() !== email ||
    !user.email_confirmed_at
  ) {
    redirect("/dashboard");
  }

  if (!isAdminClientConfigured()) {
    throw new Error("Brakuje serwerowego klucza administracyjnego Supabase.");
  }

  const admin = createAdminClient();
  const { data: admins, error } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("access_role", "admin")
    .limit(1);

  if (error) {
    throw error;
  }
  if (admins.length > 0) {
    redirect("/admin");
  }

  const errorText =
    params.error === "configuration"
      ? "Brakuje wymaganej konfiguracji Supabase."
      : params.error === "already-bootstrapped"
        ? "Konto administratora zostało już utworzone."
        : params.error === "not-authorized"
          ? "To konto nie jest uprawnione do pierwszej konfiguracji."
          : undefined;

  return (
    <main className="setup-screen">
      <section className="setup-card">
        <Link aria-label="GPW Analiza — strona główna" className="brand" href="/dashboard">
          <span className="brand-mark">G</span>
          <span>GPW <strong>Analiza</strong></span>
        </Link>
        <span className="eyebrow">JEDNORAZOWA KONFIGURACJA</span>
        <h1>Aktywuj konto administratora</h1>
        <p>
          Zalogowane i potwierdzone konto <strong>{user.email}</strong> wskazano
          jako właściciela aplikacji. Po aktywacji ten ekran zostanie wyłączony,
          a dalsze zarządzanie będzie dostępne w panelu <code>/admin</code>.
        </p>
        {errorText && <p className="notice notice-error" role="alert">{errorText}</p>}
        <form action={bootstrapInitialAdmin}>
          <button className="button button-primary" type="submit">
            Aktywuj konto administratora
          </button>
        </form>
      </section>
    </main>
  );
}
