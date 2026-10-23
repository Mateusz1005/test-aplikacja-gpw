import { Suspense } from "react";
import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import { requireCurrentUser } from "@/lib/auth/guards";

export default function AccessRequiredPage() {
  return (
    <Suspense
      fallback={
        <main className="setup-screen">
          <section className="setup-card" role="status">Sprawdzam status konta…</section>
        </main>
      }
    >
      <AccessRequiredContent />
    </Suspense>
  );
}

async function AccessRequiredContent() {
  const { user } = await requireCurrentUser();

  return (
    <main className="setup-screen">
      <section className="setup-card">
        <Link aria-label="GPW Analiza — strona główna" className="brand" href="/">
          <span className="brand-mark">G</span>
          <span>GPW <strong>Analiza</strong></span>
        </Link>
        <span className="eyebrow">DOSTĘP DO APLIKACJI</span>
        <h1>Okres dostępu nie jest aktywny</h1>
        <p>
          Konto <strong>{user.email}</strong> może się zalogować, ale wymaga
          aktywnego okresu próbnego, subskrypcji lub ręcznego dostępu.
          Skontaktuj się z administratorem.
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
