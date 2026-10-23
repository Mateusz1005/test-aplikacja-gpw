import { Suspense } from "react";
import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default function AccessPendingPage() {
  return (
    <Suspense
      fallback={
        <main className="setup-screen">
          <section className="setup-card" role="status">Sprawdzam status konta…</section>
        </main>
      }
    >
      <AccessPendingContent />
    </Suspense>
  );
}

async function AccessPendingContent() {
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

  if (role.access_role !== "pending") {
    redirect("/dashboard");
  }

  return (
    <main className="setup-screen">
      <section className="setup-card">
        <Link aria-label="GPW Analiza — strona główna" className="brand" href="/">
          <span className="brand-mark">G</span>
          <span>GPW <strong>Analiza</strong></span>
        </Link>
        <span className="eyebrow">DOSTĘP DO APLIKACJI</span>
        <h1>Konto czeka na zatwierdzenie</h1>
        <p>
          Konto <strong>{user.email}</strong> zostało utworzone. Administrator
          musi przyznać dostęp, zanim otworzy się przestrzeń analityczna.
        </p>
        <form action={signOut}>
          <button className="button button-primary" type="submit">
            Wyloguj się
          </button>
        </form>
      </section>
    </main>
  );
}
