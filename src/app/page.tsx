import { Suspense } from "react";
import { redirect } from "next/navigation";
import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export default function Home() {
  if (!isSupabaseConfigured()) {
    return (
      <main className="setup-screen">
        <div className="setup-card">
          <span className="eyebrow">GPW · ANALIZA OPARTA NA ŹRÓDŁACH</span>
          <h1>Witaj w analizie spółek GPW</h1>
          <p>
            Aplikacja jest gotowa do połączenia z Supabase. Uzupełnij wymagane
            zmienne w pliku <code>.env.local</code>, aby włączyć konta i
            bezpieczne dane użytkowników.
          </p>
          <a className="button button-primary" href="/login">
            Przejdź do logowania
          </a>
          <p className="setup-footnote">
            Nie pokazujemy kursów ani wartości indeksów. Każda liczba w analizie
            będzie powiązana ze źródłem.
          </p>
        </div>
      </main>
    );
  }

  return (
    <Suspense
      fallback={
        <main className="setup-screen">
          <div className="setup-card" role="status">Sprawdzam sesję…</div>
        </main>
      }
    >
      <AuthenticatedHome />
    </Suspense>
  );
}

async function AuthenticatedHome(): Promise<never> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error && !isAuthSessionMissingError(error)) {
    throw error;
  }

  redirect(user ? "/dashboard" : "/login");
}
