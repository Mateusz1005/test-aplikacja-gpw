import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { signOut } from "@/app/actions/auth";
import {
  removeWatchlistItem,
  saveWatchlistItem,
  uploadAnalystForecast,
  uploadCompanyDocument,
} from "./actions";
import { getAccessTimeInfo } from "@/lib/auth/access-time";
import { requireActiveAccess } from "@/lib/auth/guards";
import CompanyResearchPanel from "@/components/company-research-panel";
import { MonitoredResearch } from "@/components/monitored-research";
import PortfolioSection from "./portfolio-section";

export const metadata = {
  title: "Spółki — GPW Analiza",
};

type SearchParams = Promise<{
  error?: string | string[];
  q?: string | string[];
}>;

type Instrument = {
  id: string;
  company_name: string;
  ticker: string;
  isin: string;
  market: string;
  source_url: string;
  source_date: string;
  confidence: string;
  investor_relations_url: string | null;
  next_reporting_date: string | null;
  next_reporting_source_url: string | null;
  next_reporting_verified_at: string | null;
};

type CompanyDocument = {
  id: string;
  instrument_id: string;
  title: string;
  document_type: string;
  reporting_period: string | null;
  publication_date: string | null;
  file_size_bytes: number | null;
  source_url: string | null;
  storage_path: string | null;
  status: string;
};

type AnalystForecastDocument = {
  id: string;
  instrument_id: string;
  title: string;
  analyst_name: string | null;
  forecast_period: string | null;
  document_date: string | null;
  source_url: string | null;
  file_size_bytes: number;
  created_at: string;
};

const documentTypeNames: Record<string, string> = {
  annual_report: "Raport roczny",
  interim_report: "Raport okresowy",
  current_report: "Raport bieżący",
  presentation: "Prezentacja",
  other: "Inny dokument",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "long",
    timeZone: "Europe/Warsaw",
  }).format(new Date(value));
}

function formatFileSize(value: number | null): string {
  if (value === null) {
    return "Link zewnętrzny";
  }
  return `${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 1 }).format(value / (1024 * 1024))} MB`;
}

function CompanyDocumentSection({
  instrumentId,
  documents,
  forecasts,
}: {
  instrumentId: string;
  documents: CompanyDocument[];
  forecasts: AnalystForecastDocument[];
}) {
  return (
    <section aria-label="Raporty spółki" className="company-documents">
      <h4>Wspólna biblioteka raportów</h4>
      {documents.length === 0 ? (
        <p className="search-hint">Nie dodano jeszcze raportów tej spółki.</p>
      ) : (
        <ul className="company-document-list">
          {documents.map((document) => (
            <li key={document.id}>
              <div>
                <strong>{document.title}</strong>
                <p>
                  {documentTypeNames[document.document_type] ?? "Dokument"}
                  {document.reporting_period ? ` · okres ${document.reporting_period}` : ""}
                  {document.publication_date ? ` · ${formatDate(document.publication_date)}` : ""}
                  {` · ${formatFileSize(document.file_size_bytes)}`}
                </p>
                {document.status !== "ready" && (
                  <span className="document-status">
                    {document.status === "needs_review" ? "Wymaga sprawdzenia" : "Przetwarzanie"}
                  </span>
                )}
              </div>
              <div className="company-document-links">
                {document.storage_path && (
                  <>
                    <Link href={`/dashboard/documents/${document.id}/text`}>
                      Czytaj tekst PDF
                    </Link>
                    <a href={`/dashboard/documents/${document.id}/download`}>Pobierz PDF</a>
                  </>
                )}
                {document.source_url && (
                  <a href={document.source_url} rel="noreferrer" target="_blank">
                    Otwórz źródło
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="search-hint">
        Czytnik rozpoznaje rodzaj dokumentu i wybrane wiersze finansowe z
        numerami stron. Każdą liczbę zweryfikuj w oryginalnym PDF.
      </p>
      <form action={uploadCompanyDocument} className="document-upload-form">
        <input name="instrument_id" type="hidden" value={instrumentId} />
        <label>
          Plik PDF (maks. 25 MiB)
          <input accept="application/pdf,.pdf" name="file" required type="file" />
        </label>
        <div className="document-upload-fields">
          <label>
            Nazwa dokumentu (opcjonalnie)
            <input maxLength={300} name="title" placeholder="np. Raport roczny 2025" />
          </label>
          <label>
            Rodzaj dokumentu
            <select defaultValue="annual_report" name="document_type">
              <option value="annual_report">Raport roczny</option>
              <option value="interim_report">Raport okresowy</option>
              <option value="current_report">Raport bieżący</option>
              <option value="presentation">Prezentacja</option>
              <option value="other">Inny dokument</option>
            </select>
          </label>
          <label>
            Okres raportowy (opcjonalnie)
            <input maxLength={32} name="reporting_period" placeholder="np. 2025 lub 2026-Q2" />
          </label>
          <label>
            Data publikacji (opcjonalnie)
            <input name="publication_date" type="date" />
          </label>
          <label className="document-upload-source">
            Oficjalna strona źródłowa (opcjonalnie)
            <input
              maxLength={2000}
              name="source_url"
              placeholder="https://..."
              type="url"
            />
          </label>
        </div>
        <p className="search-hint">
          Raport trafi do wspólnej biblioteki spółki. Tekst PDF można odczytać
          na żądanie; skany bez warstwy tekstowej wymagają OCR.
        </p>
        <button className="button button-primary" type="submit">Wgraj i zachowaj raport</button>
      </form>
      <section aria-label="Prywatne prognozy analityków" className="private-forecast-section">
        <h4>Twoje prywatne prognozy analityków</h4>
        <p className="search-hint">
          Pliki są widoczne wyłącznie dla Ciebie i administratorów. Nie trafiają
          do wspólnej biblioteki. Wgrywaj tylko materiały, które masz prawo
          udostępnić aplikacji.
        </p>
        {forecasts.length === 0 ? (
          <p className="search-hint">Nie dodano prywatnych prognoz dla tej spółki.</p>
        ) : (
          <ul className="company-document-list">
            {forecasts.map((forecast) => (
              <li key={forecast.id}>
                <div>
                  <strong>{forecast.title}</strong>
                  <p>
                    {forecast.analyst_name ?? "Źródło niepodane"}
                    {forecast.forecast_period ? ` · okres ${forecast.forecast_period}` : ""}
                    {forecast.document_date ? ` · ${formatDate(forecast.document_date)}` : ""}
                    {` · ${formatFileSize(forecast.file_size_bytes)}`}
                  </p>
                </div>
                <div className="company-document-links">
                  <Link href={`/dashboard/analyst-forecasts/${forecast.id}`}>
                    Odczytaj i porównaj
                  </Link>
                  <a href={`/dashboard/analyst-forecasts/${forecast.id}/download`}>Pobierz PDF</a>
                  {forecast.source_url && (
                    <a href={forecast.source_url} rel="noreferrer" target="_blank">
                      Otwórz źródło
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <form action={uploadAnalystForecast} className="document-upload-form">
          <input name="instrument_id" type="hidden" value={instrumentId} />
          <label>
            Prywatny plik prognozy PDF (maks. 25 MiB)
            <input accept="application/pdf,.pdf" name="file" required type="file" />
          </label>
          <div className="document-upload-fields">
            <label>
              Tytuł dokumentu (opcjonalnie)
              <input maxLength={300} name="title" placeholder="np. Prognoza wyników 2026" />
            </label>
            <label>
              Dom maklerski / analityk (opcjonalnie)
              <input maxLength={200} name="analyst_name" />
            </label>
            <label>
              Okres prognozy (opcjonalnie)
              <input maxLength={100} name="forecast_period" placeholder="np. 2026–2027" />
            </label>
            <label>
              Data dokumentu (opcjonalnie)
              <input name="document_date" type="date" />
            </label>
            <label className="document-upload-source">
              Źródło lub strona publikacji (opcjonalnie)
              <input maxLength={2000} name="source_url" placeholder="https://..." type="url" />
            </label>
          </div>
          <p className="search-hint">
            Tekst PDF jest odczytywany na żądanie i nie jest zapisywany w bazie.
            Pliki skanowane bez warstwy tekstowej nie zostaną odczytane.
          </p>
          <button className="button button-primary" type="submit">Wgraj prywatną prognozę</button>
        </form>
      </section>
    </section>
  );
}

function escapeLikePattern(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

function marketName(market: string): string {
  return market === "newconnect" ? "NewConnect" : "Rynek główny GPW";
}

function confidenceName(confidence: string): string {
  return confidence === "certain" ? "Pewne" : "Niepewne";
}

export default function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense
      fallback={
        <main className="dashboard-screen">
          <div className="dashboard-content" role="status">Ładuję Twoją przestrzeń…</div>
        </main>
      }
    >
      <DashboardContent searchParams={searchParams} />
    </Suspense>
  );
}

async function DashboardContent({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const { supabase, user, access } = await requireActiveAccess();
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const pageError = typeof params.error === "string" ? params.error : "";
  const invalidSearch = query.length > 80;
  const accessTime = access
    ? getAccessTimeInfo(access.access_starts_at, access.access_expires_at)
    : null;

  const { data: watchRows, error: watchlistError } = await supabase
    .from("user_watchlist")
    .select("instrument_id, note")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (watchlistError) {
    throw watchlistError;
  }

  const { data: portfolioEntries, error: portfolioError } = await supabase
    .from("portfolio_entries")
    .select(
      "id, ticker, asset_type, entry_type, event_date, units, investment_amount, commission_amount, dividend_amount",
    )
    .eq("user_id", user.id)
    .order("event_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (portfolioError) {
    throw portfolioError;
  }

  const watchedItems: Instrument[] = [];
  if (watchRows.length > 0) {
    const { data, error } = await supabase
      .from("instrument_catalog")
      .select("id, company_name, ticker, isin, market, source_url, source_date, confidence, investor_relations_url, next_reporting_date, next_reporting_source_url, next_reporting_verified_at")
      .in("id", watchRows.map(({ instrument_id }) => instrument_id));

    if (error) {
      throw error;
    }
    watchedItems.push(...data);
  }

  const notesByInstrument = new Map(
    watchRows.map(({ instrument_id, note }) => [instrument_id, note]),
  );
  const watchedIds = new Set(watchRows.map(({ instrument_id }) => instrument_id));
  let searchResults: Instrument[] = [];

  if (query && !invalidSearch) {
    const pattern = `%${escapeLikePattern(query)}%`;
    const normalizedQuery = query.toLocaleUpperCase("pl-PL");
    const isIsinSearch = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i.test(query);
    const [byName, byTicker, byIsin] = await Promise.all([
      supabase
        .from("instrument_catalog")
        .select("id, company_name, ticker, isin, market, source_url, source_date, confidence, investor_relations_url, next_reporting_date, next_reporting_source_url, next_reporting_verified_at")
        .ilike("company_name", pattern)
        .limit(50),
      supabase
        .from("instrument_catalog")
        .select("id, company_name, ticker, isin, market, source_url, source_date, confidence, investor_relations_url, next_reporting_date, next_reporting_source_url, next_reporting_verified_at")
        .ilike("ticker", pattern)
        .limit(50),
      supabase
        .from("instrument_catalog")
        .select("id, company_name, ticker, isin, market, source_url, source_date, confidence, investor_relations_url, next_reporting_date, next_reporting_source_url, next_reporting_verified_at")
        .ilike("isin", pattern)
        .limit(50),
    ]);

    if (byName.error) throw byName.error;
    if (byTicker.error) throw byTicker.error;
    if (byIsin.error) throw byIsin.error;

    const tickerPriority = (instrument: Instrument): number => {
      const ticker = instrument.ticker.toLocaleUpperCase("pl-PL");
      const isin = instrument.isin.toLocaleUpperCase("pl-PL");
      if (isIsinSearch && isin === normalizedQuery) return 0;
      if (ticker === normalizedQuery) return 0;
      if (ticker.startsWith(normalizedQuery)) return 1;
      if (isin === normalizedQuery) return 2;
      if (ticker.includes(normalizedQuery)) return 3;
      if (instrument.company_name.toLocaleUpperCase("pl-PL").startsWith(normalizedQuery)) return 4;
      return 5;
    };

    searchResults = [...new Map(
      [...byTicker.data, ...byName.data, ...byIsin.data].map((item) => [item.id, item]),
    ).values()].sort((a, b) =>
      tickerPriority(a) - tickerPriority(b) ||
      a.ticker.localeCompare(b.ticker, "pl") ||
      a.company_name.localeCompare(b.company_name, "pl"),
    );
  }

  const visibleInstruments = [...new Map(
    [...watchedItems, ...searchResults].map((instrument) => [instrument.id, instrument]),
  ).values()];
  let documentsByInstrument = new Map<string, CompanyDocument[]>();
  let forecastsByInstrument = new Map<string, AnalystForecastDocument[]>();

  if (visibleInstruments.length > 0) {
    const [
      { data: documents, error: documentsError },
      { data: forecasts, error: forecastsError },
    ] = await Promise.all([
      supabase
        .from("company_documents")
        .select(
          "id, instrument_id, title, document_type, reporting_period, publication_date, file_size_bytes, source_url, storage_path, status",
        )
        .in("instrument_id", visibleInstruments.map(({ id }) => id))
        .order("publication_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("user_analyst_forecasts")
        .select(
          "id, instrument_id, title, analyst_name, forecast_period, document_date, source_url, file_size_bytes, created_at",
        )
        .eq("owner_id", user.id)
        .in("instrument_id", visibleInstruments.map(({ id }) => id))
        .order("document_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }),
    ]);

    if (documentsError) {
      throw documentsError;
    }
    if (forecastsError) {
      throw forecastsError;
    }

    documentsByInstrument = new Map(
      documents.reduce<Map<string, CompanyDocument[]>>((grouped, document) => {
        const current = grouped.get(document.instrument_id) ?? [];
        current.push(document);
        grouped.set(document.instrument_id, current);
        return grouped;
      }, new Map()),
    );
    forecastsByInstrument = new Map(
      forecasts.reduce<Map<string, AnalystForecastDocument[]>>((grouped, forecast) => {
        const current = grouped.get(forecast.instrument_id) ?? [];
        current.push(forecast);
        grouped.set(forecast.instrument_id, current);
        return grouped;
      }, new Map()),
    );
  }

  return (
    <main className="dashboard-screen">
      <header className="dashboard-header">
        <Link aria-label="GPW Analiza — strona główna" className="brand" href="/dashboard">
          <span className="brand-mark">G</span>
          <span>GPW <strong>Analiza</strong></span>
        </Link>
        <nav aria-label="Nawigacja dashboardu" className="dashboard-nav">
          <a href="#search">Wyszukiwarka</a>
          <a href="#watchlist">Obserwowane</a>
          <a href="#portfolio">Portfel</a>
          <a href="#guide">Jak korzystać</a>
        </nav>
        <div className="account-actions">
          <span className="account-email">{user.email}</span>
          {access === null && <Link className="button button-quiet" href="/admin">Panel admina</Link>}
          <form action={signOut}>
            <button className="button button-quiet" type="submit">Wyloguj się</button>
          </form>
        </div>
      </header>

      <section className="dashboard-content">
        <aside aria-label="Sekcje dashboardu" className="dashboard-sidebar">
          <span className="eyebrow">MENU</span>
          <nav>
            <a className="dashboard-sidebar-active" href="#search">Wyszukaj spółkę</a>
            <a href="#watchlist">Moje obserwowane</a>
            <a href="#portfolio">Portfel</a>
            <a href="#guide">Źródła i zasady</a>
          </nav>
          <div className="dashboard-sidebar-note">
            <span className="status-dot" />
            <p>Katalog GPW<br /><strong>Dane identyfikacyjne</strong></p>
          </div>
        </aside>

        <div className="dashboard-main">
          <section className="dashboard-intro">
            <span className="eyebrow">KATALOG SPÓŁEK · GPW</span>
            <h1>Znajdź spółkę po tickerze</h1>
            <p className="dashboard-lead">
              Wpisz ticker, aby szybko znaleźć spółkę. Możesz też wyszukać po nazwie
              albo numerze ISIN, a wybrane pozycje zapisać na prywatnej liście.
            </p>
          </section>

          {access?.access_expires_at && accessTime && accessTime.daysRemaining !== null && (
            <p className="trial-banner">
              {access.access_type === "subscription_trial"
                ? "Trial subskrypcyjny"
                : access.access_type === "trial"
                  ? "Okres próbny"
                  : "Dostęp"}
              {" "}aktywny — koniec za {accessTime.daysRemaining} dni (
              {formatDate(access.access_expires_at)})
            </p>
          )}

          {user.email &&
            user.email_confirmed_at &&
            user.email.toLowerCase() === process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase() && (
              <p className="trial-banner">
                Pierwsza konfiguracja właściciela:{" "}
                <Link href="/admin/setup">aktywuj konto administratora</Link>
              </p>
            )}

          {pageError === "sign-out" && (
            <p className="notice notice-error" role="alert">
              Nie udało się wylogować. Odśwież stronę i spróbuj ponownie.
            </p>
          )}
          {pageError === "invalid-note" && (
            <p className="notice notice-error" role="alert">
              Notatka może mieć maksymalnie 2000 znaków.
            </p>
          )}
          {pageError === "invalid-input" && (
            <p className="notice notice-error" role="alert">
              Nieprawidłowe dane formularza. Odśwież stronę i spróbuj ponownie.
            </p>
          )}
          {pageError === "upload-invalid" && (
            <p className="notice notice-error" role="alert">
              Nieprawidłowy formularz lub plik. Wybierz poprawny PDF i sprawdź wprowadzone dane.
            </p>
          )}
          {pageError === "upload-too-large" && (
            <p className="notice notice-error" role="alert">
              Plik przekracza limit 25 MiB.
            </p>
          )}
          {pageError === "upload-duplicate" && (
            <p className="notice notice-error" role="alert">
              Ten sam raport jest już zapisany we wspólnej bibliotece tej spółki.
            </p>
          )}
          {pageError === "forecast-invalid" && (
            <p className="notice notice-error" role="alert">
              Nieprawidłowy formularz lub plik prognozy. Wybierz poprawny PDF i sprawdź wprowadzone dane.
            </p>
          )}
          {pageError === "forecast-too-large" && (
            <p className="notice notice-error" role="alert">
              Plik prognozy przekracza limit 25 MiB.
            </p>
          )}
          {pageError === "forecast-duplicate" && (
            <p className="notice notice-error" role="alert">
              Ten sam plik prognozy został już dodany do tej spółki na Twoim koncie.
            </p>
          )}
          {invalidSearch && (
            <p className="notice notice-error" role="alert">
              Wyszukiwana fraza może mieć maksymalnie 80 znaków.
            </p>
          )}

          <section aria-labelledby="search-title" className="dashboard-section search-section" id="search">
            <div className="dashboard-section-heading">
              <div>
                <span className="eyebrow">01 · KATALOG</span>
                <h2 id="search-title">Wyszukiwarka spółek</h2>
              </div>
            </div>
            <form action="/dashboard" className="company-search" method="get">
              <label className="sr-only" htmlFor="company-search">Ticker, nazwa spółki lub ISIN</label>
              <input
                autoComplete="off"
                id="company-search"
                maxLength={80}
                name="q"
                placeholder="Wpisz ticker, np. KGHM"
                type="search"
                defaultValue={query}
              />
              <button className="button button-primary" type="submit">Szukaj spółki</button>
            </form>
            <p className="search-hint">Ticker jest głównym kryterium. Możesz też wpisać nazwę spółki lub ISIN.</p>

            {query && !invalidSearch && (
              <div className="instrument-list" aria-live="polite">
                {searchResults.length === 0 ? (
                  <p className="dashboard-empty">
                    Nie znaleziono „{query}” w katalogu. Sprawdź ticker lub spróbuj wyszukać po nazwie albo ISIN.
                  </p>
                ) : (
                  <>
                    {searchResults.map((instrument) => (
                      <article className="instrument-card" key={instrument.id}>
                        <div className="instrument-heading">
                          <div className="instrument-identity">
                            <span aria-label={`Ticker ${instrument.ticker}`} className="ticker-symbol">
                              {instrument.ticker}
                            </span>
                            <div>
                              <h3>{instrument.company_name}</h3>
                              <p>{marketName(instrument.market)} · ISIN {instrument.isin}</p>
                            </div>
                          </div>
                          <span className={`certainty-badge ${instrument.confidence === "certain" ? "certainty-certain" : "certainty-uncertain"}`}>
                            {confidenceName(instrument.confidence)}
                          </span>
                        </div>
                        <p className="instrument-source">
                          Źródło: <a href={instrument.source_url} rel="noreferrer" target="_blank">GPW — lista spółek</a>
                          {" · "}data: {formatDate(instrument.source_date)}
                        </p>
                        <CompanyDocumentSection
                          documents={documentsByInstrument.get(instrument.id) ?? []}
                          forecasts={forecastsByInstrument.get(instrument.id) ?? []}
                          instrumentId={instrument.id}
                        />
                        {instrument.id === searchResults[0]?.id && (
                          <>
                            <CompanyResearchPanel
                              companyName={instrument.company_name}
                              investorRelationsUrl={instrument.investor_relations_url}
                              nextReportingDate={instrument.next_reporting_date}
                              nextReportingSourceUrl={instrument.next_reporting_source_url}
                              nextReportingVerifiedAt={instrument.next_reporting_verified_at}
                              officialSourceUrl={instrument.source_url}
                              ticker={instrument.ticker}
                            />
                            <MonitoredResearch ticker={instrument.ticker} />
                          </>
                        )}
                        <form action={saveWatchlistItem} className="watchlist-form">
                          <input name="instrument_id" type="hidden" value={instrument.id} />
                          <label>
                            Twoja notatka
                            <textarea
                              defaultValue={notesByInstrument.get(instrument.id) ?? ""}
                              maxLength={2000}
                              name="note"
                              placeholder="Opcjonalne prywatne ustalenia"
                              rows={2}
                            />
                          </label>
                          <div className="watchlist-actions">
                            <button className="button button-primary" type="submit">
                              {watchedIds.has(instrument.id) ? "Zapisz w obserwowanych" : "Dodaj do obserwowanych"}
                            </button>
                            {watchedIds.has(instrument.id) && (
                              <button
                                className="button button-quiet"
                                formAction={removeWatchlistItem}
                                type="submit"
                              >
                                Usuń z obserwowanych
                              </button>
                            )}
                          </div>
                        </form>
                      </article>
                    ))}
                    <p className="dashboard-data-note" role="note">
                      Informacje katalogowe i materiały zewnętrzne są wyraźnie
                      oznaczone źródłem oraz datą. Sprawdź je u pierwotnego wydawcy.
                    </p>
                  </>
                )}
              </div>
            )}
            {!query && (
              <p className="dashboard-empty">
                Wpisz ticker, aby znaleźć spółkę. Wyszukiwanie po nazwie i ISIN również jest dostępne.
              </p>
            )}
          </section>

          <PortfolioSection
            entries={portfolioEntries}
            error={pageError}
            today={new Date().toISOString().slice(0, 10)}
          />

          <section aria-labelledby="watchlist-title" className="dashboard-section" id="watchlist">
            <div className="dashboard-section-heading">
              <div>
                <span className="eyebrow">02 · TWOJA LISTA</span>
                <h2 id="watchlist-title">Obserwowane spółki <span className="count-badge">{watchedItems.length}</span></h2>
              </div>
              <span className="section-caption">Prywatne notatki</span>
            </div>
            {watchedItems.length === 0 ? (
              <p className="dashboard-empty">
                Nie masz jeszcze obserwowanych spółek. Wyszukaj ticker powyżej,
                a następnie dodaj spółkę do swojej prywatnej listy.
              </p>
            ) : (
              <div className="instrument-list">
                {watchedItems.map((instrument) => (
                  <article className="instrument-card" key={instrument.id}>
                    <div className="instrument-heading">
                      <div className="instrument-identity">
                        <span aria-label={`Ticker ${instrument.ticker}`} className="ticker-symbol">
                          {instrument.ticker}
                        </span>
                        <div>
                          <h3>{instrument.company_name}</h3>
                          <p>{marketName(instrument.market)} · ISIN {instrument.isin}</p>
                        </div>
                      </div>
                      <span className={`certainty-badge ${instrument.confidence === "certain" ? "certainty-certain" : "certainty-uncertain"}`}>
                        {confidenceName(instrument.confidence)}
                      </span>
                    </div>
                    <p className="instrument-source">
                      Źródło: <a href={instrument.source_url} rel="noreferrer" target="_blank">GPW — lista spółek</a>
                      {" · "}data: {formatDate(instrument.source_date)}
                    </p>
                    <CompanyDocumentSection
                      documents={documentsByInstrument.get(instrument.id) ?? []}
                      forecasts={forecastsByInstrument.get(instrument.id) ?? []}
                      instrumentId={instrument.id}
                    />
                    <form action={saveWatchlistItem} className="watchlist-form">
                      <input name="instrument_id" type="hidden" value={instrument.id} />
                      <label>
                        Prywatna notatka
                        <textarea
                          defaultValue={notesByInstrument.get(instrument.id) ?? ""}
                          maxLength={2000}
                          name="note"
                          placeholder="Zapisz własne ustalenia"
                          rows={2}
                        />
                      </label>
                      <div className="watchlist-actions">
                        <button className="button button-primary" type="submit">Zapisz notatkę</button>
                        <button
                          className="button button-quiet"
                          formAction={removeWatchlistItem}
                          type="submit"
                        >
                          Usuń z obserwowanych
                        </button>
                      </div>
                    </form>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="guide-title" className="dashboard-section guide-section" id="guide">
            <div className="dashboard-section-heading">
              <div>
                <span className="eyebrow">03 · INFORMACJE</span>
                <h2 id="guide-title">Jak korzystać z katalogu</h2>
              </div>
            </div>
            <div className="guide-grid">
              <article className="guide-card">
                <span className="guide-number">01</span>
                <h3>Wyszukaj ticker</h3>
                <p>Ticker jest głównym kryterium. W razie potrzeby wyszukaj także po nazwie lub ISIN.</p>
              </article>
              <article className="guide-card">
                <span className="guide-number">02</span>
                <h3>Sprawdź źródło</h3>
                <p>Każdy wpis zawiera odnośnik i datę źródła oraz etykietę pewności informacji.</p>
              </article>
              <article className="guide-card">
                <span className="guide-number">03</span>
                <h3>Zapisz własną notatkę</h3>
                <p>Obserwowane spółki i notatki są prywatne dla Twojego konta.</p>
              </article>
            </div>
          </section>

          <p className="dashboard-disclaimer">
            Katalog zawiera dane identyfikacyjne, nie ceny ani wyceny rynkowe.
            Nie ma tu jeszcze analiz finansowych. Aplikacja nie formułuje
            rekomendacji kupna ani sprzedaży.
          </p>
        </div>
      </section>
    </main>
  );
}
