import Link from "next/link";
import { Suspense } from "react";
import { signIn } from "@/app/actions/auth";
import { AuthCard } from "@/components/auth-card";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const errorMessages: Record<string, string> = {
  configuration: "Logowanie nie jest skonfigurowane. Uzupełnij ustawienia Supabase.",
  service: "Logowanie działa, ale zapis historii logowania nie powiódł się. Spróbuj ponownie.",
  "invalid-input": "Wpisz poprawny adres e-mail i hasło.",
  credentials: "Nie udało się zalogować. Sprawdź e-mail i hasło.",
  "auth-callback": "Nie udało się potwierdzić adresu e-mail. Spróbuj ponownie.",
};

const statusMessages: Record<string, string> = {
  "check-email": "Konto utworzone. Sprawdź pocztę, aby potwierdzić adres e-mail.",
  "signed-out": "Wylogowano.",
  "password-updated": "Hasło zmieniono i wylogowano aktywne sesje. Zaloguj się ponownie.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  return (
    <AuthCard
      eyebrow="BEZPIECZNY DOSTĘP"
      title="Zaloguj się"
      description="Twoje dokumenty i portfel są prywatne i przypisane do Twojego konta."
      configured={isSupabaseConfigured()}
      footer={
        <>
          Nie masz jeszcze konta? <Link href="/register">Utwórz konto</Link>
        </>
      }
    >
      <Suspense fallback={<p className="auth-status" role="status">Przygotowuję formularz…</p>}>
        <LoginStatus searchParams={searchParams} />
      </Suspense>
      <form action={signIn} className="auth-form">
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
            autoComplete="current-password"
            name="password"
            placeholder="Wpisz hasło"
            required
            type="password"
          />
        </label>
        <Link className="forgot-link" href="/forgot-password">
          Nie pamiętam hasła
        </Link>
        <button className="button button-primary" disabled={!isSupabaseConfigured()}>
          Zaloguj się
        </button>
      </form>
    </AuthCard>
  );
}

async function LoginStatus({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const params = await searchParams;
  const error = params.error ? errorMessages[params.error] : undefined;
  const message = params.message ? statusMessages[params.message] : undefined;

  return (
    <>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {message && <p className="notice notice-success" role="status">{message}</p>}
    </>
  );
}
