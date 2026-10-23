import type { ReactNode } from "react";
import Link from "next/link";

type AuthCardProps = {
  children: ReactNode;
  configured: boolean;
  description: string;
  error?: string;
  eyebrow: string;
  footer: ReactNode;
  message?: string;
  title: string;
};

export function AuthCard({
  children,
  configured,
  description,
  error,
  eyebrow,
  footer,
  message,
  title,
}: AuthCardProps) {
  return (
    <main className="auth-screen">
      <div className="auth-decoration" aria-hidden="true">
        <span className="orb orb-one" />
        <span className="orb orb-two" />
        <span className="grid-glow" />
      </div>
      <section aria-labelledby="auth-title" className="auth-card">
        <Link aria-label="GPW Analiza — strona główna" className="brand" href="/">
          <span className="brand-mark">G</span>
          <span>GPW <strong>Analiza</strong></span>
        </Link>
        <div className="auth-heading">
          <span className="eyebrow">{eyebrow}</span>
          <h1 id="auth-title">{title}</h1>
          <p>{description}</p>
        </div>

        {!configured && (
          <p className="notice notice-warning" role="status">
            Uzupełnij NEXT_PUBLIC_SUPABASE_URL i NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
            w pliku .env.local, aby włączyć logowanie.
          </p>
        )}
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        {message && <p className="notice notice-success" role="status">{message}</p>}

        {children}
        <p className="auth-footer">{footer}</p>
        <p className="auth-legal">
          Dane finansowe wyłącznie ze źródeł. Aplikacja nie udziela porad inwestycyjnych.
        </p>
      </section>
      <footer className="auth-bottom">GPW ANALIZA <span>·</span> FAKTY, ŹRÓDŁA, KONTEKST</footer>
    </main>
  );
}
