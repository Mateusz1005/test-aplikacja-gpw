import Link from "next/link";
import { Suspense } from "react";
import { requestPasswordReset } from "@/app/actions/auth";
import { AuthCard } from "@/components/auth-card";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  return (
    <AuthCard
      eyebrow="ODZYSKIWANIE DOSTĘPU"
      title="Nie pamiętasz hasła?"
      description="Podaj adres e-mail. Jeśli jest powiązany z kontem, wyślemy jednorazowy link do ustawienia nowego hasła."
      configured={isSupabaseConfigured()}
      footer={
        <>
          Pamiętasz hasło? <Link href="/login">Wróć do logowania</Link>
        </>
      }
    >
      <Suspense fallback={<p className="auth-status" role="status">Ładuję formularz…</p>}>
        <ResetRequestStatus searchParams={searchParams} />
      </Suspense>
      <form action={requestPasswordReset} className="auth-form">
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
        <button className="button button-primary" type="submit">
          Wyślij link do zmiany hasła
        </button>
      </form>
    </AuthCard>
  );
}

async function ResetRequestStatus({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const params = await searchParams;
  if (params.message === "expired") {
    return (
      <p className="notice notice-error" role="alert">
        Link jest nieprawidłowy albo wygasł. Poproś o nowy link do zmiany hasła.
      </p>
    );
  }
  if (params.message !== "requested") return null;
  return (
    <p className="notice notice-success" role="status">
      Jeśli konto istnieje, link do zmiany hasła został wysłany. Sprawdź pocztę,
      również folder ze spamem. Jeśli wiadomość nie dotrze, skontaktuj się z
      administratorem.
    </p>
  );
}
