import Link from "next/link";
import { Suspense } from "react";
import { signUp } from "@/app/actions/auth";
import { AuthCard } from "@/components/auth-card";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const errorMessages: Record<string, string> = {
  configuration: "Rejestracja nie jest skonfigurowana. Uzupełnij ustawienia Supabase.",
  "invalid-input": "Wpisz poprawny adres e-mail i hasło zawierające co najmniej 8 znaków.",
  signup: "Nie udało się utworzyć konta. Sprawdź adres e-mail i spróbuj ponownie.",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <AuthCard
      eyebrow="TWOJE PRYWATNE DANE"
      title="Utwórz konto"
      description="Konto oddziela Twoje dokumenty, ustawienia i portfel od danych innych użytkowników."
      configured={isSupabaseConfigured()}
      footer={
        <>
          Masz już konto? <Link href="/login">Zaloguj się</Link>
        </>
      }
    >
      <Suspense fallback={<p className="auth-status" role="status">Przygotowuję formularz…</p>}>
        <RegisterStatus searchParams={searchParams} />
      </Suspense>
      <form action={signUp} className="auth-form">
        <label>
          Adres e-mail
          <input
            autoComplete="email"
            name="email"
            placeholder="adres@przyklad.pl"
            required
            type="email"
          />
        </label>
        <label>
          Hasło
          <input
            autoComplete="new-password"
            minLength={8}
            name="password"
            placeholder="Co najmniej 8 znaków"
            required
            type="password"
          />
        </label>
        <button className="button button-primary" disabled={!isSupabaseConfigured()}>
          Utwórz konto
        </button>
      </form>
    </AuthCard>
  );
}

async function RegisterStatus({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const error = params.error ? errorMessages[params.error] : undefined;
  return error ? <p className="notice notice-error" role="alert">{error}</p> : null;
}
