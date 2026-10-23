import { Suspense } from "react";
import { updatePassword } from "@/app/actions/auth";
import { AuthCard } from "@/components/auth-card";
import { requireCurrentUser } from "@/lib/auth/guards";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const errorMessages: Record<string, string> = {
  "invalid-input": "Hasła muszą być takie same i zawierać co najmniej 8 znaków.",
  "update-failed": "Nie udało się zmienić hasła. Link mógł wygasnąć; poproś o nowy.",
};

export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <Suspense
      fallback={
        <main className="auth-screen">
          <div className="auth-card" role="status">Sprawdzam jednorazowy link…</div>
        </main>
      }
    >
      <ResetPasswordContent searchParams={searchParams} />
    </Suspense>
  );
}

async function ResetPasswordContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { user } = await requireCurrentUser();
  const params = await searchParams;

  return (
    <AuthCard
      eyebrow="JEDNORAZOWY LINK"
      title="Ustaw nowe hasło"
      description={`Zmieniasz hasło do konta ${user.email ?? ""}. Po zmianie wylogujemy wszystkie aktywne sesje.`}
      configured={isSupabaseConfigured()}
      error={params.error ? errorMessages[params.error] : undefined}
      footer={<>Link do resetu można wykorzystać tylko raz.</>}
    >
      <form action={updatePassword} className="auth-form">
        <label>
          Nowe hasło
          <input
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            name="password"
            placeholder="Co najmniej 8 znaków"
            required
            type="password"
          />
        </label>
        <label>
          Powtórz nowe hasło
          <input
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            name="password_confirmation"
            placeholder="Wpisz hasło ponownie"
            required
            type="password"
          />
        </label>
        <button className="button button-primary" type="submit">
          Zmień hasło i wyloguj sesje
        </button>
      </form>
    </AuthCard>
  );
}
