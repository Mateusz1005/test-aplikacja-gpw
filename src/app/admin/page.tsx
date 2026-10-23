import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { getAccessTimeInfo } from "@/lib/auth/access-time";
import { isAdminClientConfigured, createAdminClient } from "@/lib/supabase/admin";
import {
  activateSubscription,
  blockUser,
  deleteUser,
  extendAccess,
  grantManualAccess,
  grantSubscriptionTrial,
  importCompanyCatalog,
  saveAdminSettings,
  sendAdminPasswordReset,
} from "./actions";

export const metadata = {
  title: "Panel administratora — GPW Analiza",
};

type SearchParams = Promise<{ error?: string; notice?: string }>;

const errorMessages: Record<string, string> = {
  "invalid-user": "Nie znaleziono wybranego konta.",
  "invalid-input": "Sprawdź wprowadzone dane.",
  "invalid-days": "Liczba dni musi mieścić się w zakresie 1–3650.",
  "self-action": "Nie można zablokować ani usunąć własnego konta administratora.",
  "protected-account": "Zmiana kont administratorów nie jest dostępna w tym panelu.",
  "blocked-account": "Najpierw nadaj użytkownikowi ponowny dostęp ręczny.",
  "indefinite-access": "Dostęp bezterminowy nie wymaga przedłużenia.",
  "invalid-date": "Termin subskrypcji musi być datą z przyszłości.",
  "invalid-settings": "Sprawdź długość okresów i adres nadawcy.",
  "email-configuration": "Skonfiguruj klucz Resend i zweryfikowany adres nadawcy.",
  "delete-confirmation": "Aby usunąć konto, wpisz dokładny adres e-mail użytkownika.",
  "catalog-import-file": "Wybierz plik CSV lub XLSX do importu.",
  "catalog-import-size": "Plik importu może mieć maksymalnie 750 KB.",
  "catalog-import-invalid": "Plik jest nieprawidłowy. Sprawdź nagłówki i wartości; nie zapisano żadnych rekordów.",
};

const noticeMessages: Record<string, string> = {
  "manual-granted": "Nadano dostęp ręczny.",
  "access-extended": "Przedłużono dostęp.",
  "subscription-trial-granted": "Nadano 30-dniowy trial subskrypcyjny.",
  "subscription-activated": "Zapisano aktywną subskrypcję.",
  "user-blocked": "Zablokowano dostęp do aplikacji.",
  "user-deleted": "Usunięto konto użytkownika.",
  "password-reset-sent": "Wysłano e-mail z linkiem do zmiany hasła.",
  "settings-saved": "Zapisano ustawienia.",
  "catalog-imported": "Import katalogu GPW zakończył się pomyślnie.",
};

export default function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense
      fallback={
        <main className="admin-screen">
          <div className="admin-content" role="status">Ładuję panel administratora…</div>
        </main>
      }
    >
      <AdminContent searchParams={searchParams} />
    </Suspense>
  );
}

async function AdminContent({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const { user } = await requireAdmin();

  if (!isAdminClientConfigured()) {
    throw new Error("Brakuje serwerowego klucza administracyjnego Supabase.");
  }

  const admin = createAdminClient();
  const [
    { data: authUsers, error: usersError },
    { data: settings, error: settingsError },
    { data: loginEvents, error: loginsError },
    { data: auditLog, error: auditError },
    { data: forecastDocuments, error: forecastsError },
  ] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    admin.from("app_settings").select("*").eq("id", true).single(),
    admin
      .from("login_events")
      .select("id, email, user_id, occurred_at")
      .order("occurred_at", { ascending: false })
      .limit(50),
    admin
      .from("admin_audit_log")
      .select("id, actor_id, target_user_id, action, details, occurred_at")
      .order("occurred_at", { ascending: false })
      .limit(50),
    admin
      .from("user_analyst_forecasts")
      .select("id, owner_id, instrument_id, title, analyst_name, forecast_period, document_date, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (usersError) throw usersError;
  if (settingsError) throw settingsError;
  if (loginsError) throw loginsError;
  if (auditError) throw auditError;
  if (forecastsError) throw forecastsError;

  const { error: forecastAuditError } = await admin.from("admin_audit_log").insert({
    actor_id: user.id,
    target_user_id: null,
    action: "private_forecasts.listed",
    details: { count: forecastDocuments.length },
  });
  if (forecastAuditError) throw forecastAuditError;

  const users = authUsers.users;
  const userIds = users.map(({ id }) => id);
  const forecastInstrumentIds = [...new Set(forecastDocuments.map(({ instrument_id }) => instrument_id))];
  const { data: forecastInstruments, error: forecastInstrumentsError } =
    forecastInstrumentIds.length > 0
      ? await admin
          .from("instrument_catalog")
          .select("id, company_name, ticker")
          .in("id", forecastInstrumentIds)
      : { data: [], error: null };

  if (forecastInstrumentsError) throw forecastInstrumentsError;
  const emailByUser = new Map(users.map(({ id, email }) => [id, email ?? "Konto bez e-maila"]));
  const instrumentById = new Map((forecastInstruments ?? []).map((instrument) => [instrument.id, instrument]));
  const [{ data: accessRows, error: accessError }, { data: roleRows, error: rolesError }] =
    userIds.length > 0
      ? await Promise.all([
          admin.from("user_access").select("*").in("user_id", userIds),
          admin.from("user_roles").select("user_id, access_role").in("user_id", userIds),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];

  if (accessError) throw accessError;
  if (rolesError) throw rolesError;

  const accessByUser = new Map((accessRows ?? []).map((row) => [row.user_id, row]));
  const roleByUser = new Map((roleRows ?? []).map((row) => [row.user_id, row.access_role]));
  const params = await searchParams;

  return (
    <main className="admin-screen">
      <header className="admin-header">
        <Link aria-label="GPW Analiza — strona główna" className="brand" href="/dashboard">
          <span className="brand-mark">G</span>
          <span>GPW <strong>Analiza</strong></span>
        </Link>
        <div className="account-actions">
          <span className="account-email">Administrator · {user.email}</span>
          <Link className="button button-quiet" href="/dashboard">Do aplikacji</Link>
        </div>
      </header>

      <section className="admin-content">
        <span className="eyebrow">ZARZĄDZANIE APLIKACJĄ</span>
        <h1>Panel administratora</h1>
        <p className="admin-lead">
          Konta, dostęp, okresy próbne, reset haseł oraz dziennik zdarzeń.
          Zmiany wykonują się po stronie serwera i są rejestrowane.
        </p>

        {params.error && errorMessages[params.error] && (
          <p className="notice notice-error" role="alert">{errorMessages[params.error]}</p>
        )}
        {params.notice && noticeMessages[params.notice] && (
          <p className="notice notice-success" role="status">{noticeMessages[params.notice]}</p>
        )}

        <section aria-labelledby="catalog-import-title" className="admin-section">
          <div className="admin-section-heading">
            <div>
              <span className="eyebrow">DANE SPÓŁEK</span>
              <h2 id="catalog-import-title">Import katalogu GPW</h2>
            </div>
          </div>
          <p className="muted-text">
            Importuj listę spółek rynku głównego. Cały plik jest sprawdzany przed
            zapisem; błędny rekord blokuje import. Istniejące pozycje z tym samym
            ISIN-em są aktualizowane, a nieusunięte wpisy pozostają w katalogu.
          </p>
          <p className="muted-text">
            CSV (UTF-8, separator przecinek lub średnik) albo XLSX z jednym arkuszem.
            Maksymalnie 750 KB i 1000 rekordów. Wymagane kolumny:
            {" "}<code>company_name, ticker, isin, market, source_url, source_date, confidence</code>.
            Rynek musi mieć wartość <code>gpw_main</code>, data format
            <code> YYYY-MM-DD</code>, pewność <code>certain</code> lub
            <code> uncertain</code>, a źródło adres HTTPS w domenie GPW.
            Opcjonalnie można podać <code>investor_relations_url</code> oraz
            komplet <code>next_reporting_date, next_reporting_source_url,
            next_reporting_verified_at</code>. Każdy adres musi używać HTTPS;
            termin raportu wymaga źródła i daty weryfikacji. Puste pola nie
            usuwają wcześniej zaimportowanych danych.
          </p>
          <form action={importCompanyCatalog} className="admin-action-form">
            <label>
              Plik CSV lub XLSX
              <input
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                name="catalog_file"
                required
                type="file"
              />
            </label>
            <button className="button button-primary" type="submit">Sprawdź i importuj</button>
          </form>
        </section>

        <section aria-labelledby="users-title" className="admin-section">
          <div className="admin-section-heading">
            <div>
              <span className="eyebrow">KONTA I UPRAWNIENIA</span>
              <h2 id="users-title">Użytkownicy <span className="count-badge">{authUsers.total}</span></h2>
            </div>
            {authUsers.total > users.length && (
              <span className="muted-text">
                Wyświetlono pierwsze {users.length} kont. W bazie jest ich więcej.
              </span>
            )}
          </div>

          {users.length === 0 ? (
            <div className="admin-empty">Brak zarejestrowanych kont.</div>
          ) : (
            <div className="user-list">
              {users.map((account) => {
                const access = accessByUser.get(account.id);
                const role = roleByUser.get(account.id);
                const isAdmin = role === "admin";
                const isBlocked = access?.access_status === "blocked";
                const accessTime = getAccessTimeInfo(
                  access?.access_starts_at ?? null,
                  access?.access_expires_at ?? null,
                );
                const isExpired =
                  access?.access_status === "active" &&
                  accessTime.expired;
                const statusText = isAdmin
                  ? "Administrator"
                  : isBlocked
                    ? "Zablokowany"
                    : accessTime.notStarted
                      ? "Zaplanowany"
                    : isExpired
                      ? "Wygasł"
                      : access?.access_status === "active"
                        ? "Aktywny"
                        : "Brak dostępu";
                const accessTypeText = isAdmin
                  ? "Pełny dostęp administratora"
                  : access?.access_type === "trial"
                    ? "Trial · bez subskrypcji"
                    : access?.access_type === "subscription_trial"
                      ? "Trial · subskrypcja"
                      : access?.access_type === "subscription"
                        ? "Subskrypcja"
                        : access?.access_type === "manual"
                          ? "Ręcznie nadany"
                          : "Nieprzyznany";

                return (
                  <article className="user-card" key={account.id}>
                    <div className="user-card-top">
                      <div className="user-heading">
                        <h3>{account.email ?? "Konto bez adresu e-mail"}</h3>
                        <p>Zarejestrowano: {formatDate(account.created_at)}</p>
                      </div>
                      <div className="user-badges">
                        <span className={`status-badge ${isBlocked ? "status-danger" : isExpired || accessTime.notStarted ? "status-muted" : "status-active"}`}>
                          {statusText}
                        </span>
                        <span className="access-type">{accessTypeText}</span>
                      </div>
                    </div>
                    <div className="user-meta">
                      <span>
                        Wygaśnięcie: <strong>{formatDate(access?.access_expires_at ?? null)}</strong>
                      </span>
                      <span>
                        Ostatnia aktualizacja: <strong>{formatDate(access?.updated_at ?? null)}</strong>
                      </span>
                      {access?.note && <span>Notatka: {access.note}</span>}
                    </div>

                    {!isAdmin && account.email && (
                      <details className="user-actions">
                        <summary>Zarządzaj kontem</summary>
                        <div className="action-grid">
                          <form action={grantManualAccess} className="admin-action-form">
                            <input name="user_id" type="hidden" value={account.id} />
                            <strong>Dostęp ręczny</strong>
                            <label>
                              Liczba dni
                              <input
                                defaultValue={settings.manual_access_days}
                                max={3650}
                                min={1}
                                name="days"
                                type="number"
                              />
                            </label>
                            <label className="checkbox-label">
                              <input name="indefinite" type="checkbox" />
                              Bezterminowo
                            </label>
                            <label>
                              Notatka
                              <input maxLength={500} name="note" placeholder="Powód / ustalenia" />
                            </label>
                            <button className="button button-primary" type="submit">Nadaj dostęp</button>
                          </form>

                          <form action={extendAccess} className="admin-action-form">
                            <input name="user_id" type="hidden" value={account.id} />
                            <strong>Przedłużenie</strong>
                            <label>
                              Dni do dodania
                              <input defaultValue={30} max={3650} min={1} name="days" type="number" />
                            </label>
                            <button className="button button-quiet" type="submit">Przedłuż dostęp</button>
                          </form>

                          <form action={grantSubscriptionTrial} className="admin-action-form">
                            <input name="user_id" type="hidden" value={account.id} />
                            <strong>Trial subskrypcyjny</strong>
                            <p className="muted-text">{settings.subscription_trial_days} dni, bez integracji płatności.</p>
                            <label>
                              Notatka
                              <input maxLength={500} name="note" placeholder="Opcjonalnie" />
                            </label>
                            <button className="button button-quiet" type="submit">Nadaj trial</button>
                          </form>

                          <form action={activateSubscription} className="admin-action-form">
                            <input name="user_id" type="hidden" value={account.id} />
                            <strong>Aktywna subskrypcja</strong>
                            <label>
                              Aktywna do
                              <input
                                defaultValue={defaultSubscriptionExpiry()}
                                name="expires_at"
                                required
                                type="datetime-local"
                              />
                            </label>
                            <label>
                              Notatka
                              <input maxLength={500} name="note" placeholder="Źródło / umowa" />
                            </label>
                            <button className="button button-quiet" type="submit">Aktywuj</button>
                          </form>

                          <form action={sendAdminPasswordReset} className="admin-action-form">
                            <input name="user_id" type="hidden" value={account.id} />
                            <strong>Reset hasła</strong>
                            <p className="muted-text">Wyślij jednorazowy link na {account.email}.</p>
                            <button className="button button-quiet" type="submit">Wyślij link</button>
                          </form>

                          <form action={blockUser} className="admin-action-form">
                            <input name="user_id" type="hidden" value={account.id} />
                            <strong>{isBlocked ? "Konto zablokowane" : "Natychmiastowy odbiór dostępu"}</strong>
                            <label>
                              Notatka
                              <input maxLength={500} name="note" placeholder="Powód blokady" />
                            </label>
                            <button className="button button-danger" disabled={isBlocked} type="submit">
                              Zablokuj konto
                            </button>
                          </form>

                          <form action={deleteUser} className="admin-action-form admin-action-destructive">
                            <input name="user_id" type="hidden" value={account.id} />
                            <strong>Usuń konto i powiązane dane</strong>
                            <label>
                              Potwierdź, wpisując adres e-mail
                              <input
                                autoComplete="off"
                                name="confirm_email"
                                required
                                type="email"
                              />
                            </label>
                            <button className="button button-danger" type="submit">Usuń konto</button>
                          </form>
                        </div>
                      </details>
                    )}
                    {isAdmin && <p className="muted-text">Zarządzanie innymi administratorami jest celowo zablokowane.</p>}
                    {account.id === user.id && <p className="muted-text">To Twoje konto administratora.</p>}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section aria-labelledby="private-forecasts-title" className="admin-section">
          <div className="admin-section-heading">
            <div>
              <span className="eyebrow">PRYWATNE ZAŁĄCZNIKI</span>
              <h2 id="private-forecasts-title">
                Prognozy użytkowników <span className="count-badge">{forecastDocuments.length}</span>
              </h2>
            </div>
          </div>
          <p className="muted-text">
            Dostęp administratora jest ograniczony do tego panelu i chronionego
            czytnika. Załączniki nie są widoczne innym użytkownikom ani w
            publicznej bibliotece. Wyświetlono do 100 najnowszych plików.
          </p>
          {forecastDocuments.length === 0 ? (
            <div className="admin-empty">Nie dodano prywatnych prognoz.</div>
          ) : (
            <ul className="company-document-list">
              {forecastDocuments.map((forecast) => {
                const instrument = instrumentById.get(forecast.instrument_id);
                return (
                  <li key={forecast.id}>
                    <div>
                      <strong>{forecast.title}</strong>
                      <p>
                        {emailByUser.get(forecast.owner_id) ?? "Nieznany użytkownik"}
                        {" · "}
                        {instrument ? `${instrument.ticker} · ${instrument.company_name}` : "Spółka nieznana"}
                        {forecast.analyst_name ? ` · ${forecast.analyst_name}` : ""}
                        {forecast.forecast_period ? ` · okres ${forecast.forecast_period}` : ""}
                        {forecast.document_date ? ` · ${forecast.document_date}` : ""}
                      </p>
                    </div>
                    <div className="company-document-links">
                      <Link href={`/dashboard/analyst-forecasts/${forecast.id}`}>Odczytaj PDF</Link>
                      <a href={`/dashboard/analyst-forecasts/${forecast.id}/download`}>Pobierz PDF</a>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="settings-title" className="admin-section">
          <div className="admin-section-heading">
            <div>
              <span className="eyebrow">DOSTĘP I POCZTA</span>
              <h2 id="settings-title">Ustawienia</h2>
            </div>
          </div>
          <form action={saveAdminSettings} className="settings-form">
            <label>
              Trial bez subskrypcji (dni)
              <input defaultValue={settings.trial_days} max={90} min={1} name="trial_days" required type="number" />
            </label>
            <label>
              Trial subskrypcyjny (dni)
              <input
                defaultValue={settings.subscription_trial_days}
                max={180}
                min={1}
                name="subscription_trial_days"
                required
                type="number"
              />
            </label>
            <label>
              Domyślny dostęp ręczny (dni)
              <input
                defaultValue={settings.manual_access_days}
                max={3650}
                min={1}
                name="manual_access_days"
                required
                type="number"
              />
            </label>
            <label className="settings-email">
              Adres nadawcy e-mail
              <input
                autoComplete="email"
                defaultValue={settings.sender_email}
                maxLength={320}
                name="sender_email"
                placeholder="noreply@zweryfikowana-domena.pl"
                type="email"
              />
              <span className="muted-text">Domena musi być zweryfikowana w Resend. Klucz Resend ustawiasz wyłącznie po stronie serwera.</span>
            </label>
            <button className="button button-primary" type="submit">Zapisz ustawienia</button>
          </form>
        </section>

        <section aria-labelledby="login-history-title" className="admin-section">
          <div className="admin-section-heading">
            <div>
              <span className="eyebrow">BEZPIECZEŃSTWO</span>
              <h2 id="login-history-title">Ostatnie logowania</h2>
            </div>
            <span className="muted-text">Ostatnie {loginEvents.length} udanych logowań</span>
          </div>
          {loginEvents.length === 0 ? (
            <div className="admin-empty">Nie zapisano jeszcze udanych logowań.</div>
          ) : (
            <div className="event-list">
              {loginEvents.map((event) => (
                <div className="event-row" key={event.id}>
                  <span className="event-dot" />
                  <span className="event-primary">{event.email}</span>
                  <span className="event-secondary">Logowanie udane</span>
                  <time dateTime={event.occurred_at}>{formatDate(event.occurred_at)}</time>
                </div>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="audit-title" className="admin-section">
          <div className="admin-section-heading">
            <div>
              <span className="eyebrow">ŚLAD ZMIAN</span>
              <h2 id="audit-title">Historia działań administratora</h2>
            </div>
            <span className="muted-text">Ostatnie {auditLog.length} zmian</span>
          </div>
          {auditLog.length === 0 ? (
            <div className="admin-empty">Nie wykonano jeszcze zmian administracyjnych.</div>
          ) : (
            <div className="event-list">
              {auditLog.map((event) => (
                <div className="event-row" key={event.id}>
                  <span className="event-dot event-dot-admin" />
                  <span className="event-primary">{event.action}</span>
                  <span className="event-secondary">
                    {formatAuditDetails(event.details)}
                  </span>
                  <time dateTime={event.occurred_at}>{formatDate(event.occurred_at)}</time>
                </div>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "Bezterminowo / brak";
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Warsaw",
  }).format(new Date(value));
}

function defaultSubscriptionExpiry(): string {
  const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const local = new Date(expiry.getTime() - expiry.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatAuditDetails(details: unknown): string {
  if (!details || typeof details !== "object" || Array.isArray(details)) return "";
  const entries = Object.entries(details as Record<string, unknown>)
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`);
  return entries.join(" · ");
}
