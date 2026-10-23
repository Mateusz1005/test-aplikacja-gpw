import "server-only";

import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireActiveAccess } from "@/lib/auth/guards";
import { extractPdfText, PdfTextExtractionError } from "@/lib/documents/pdf-text";
import {
  comparePrivateForecast,
  hasPublicAnalystExcerpt,
} from "@/lib/research/analyst-comparison";
import {
  isRelevantCompanyTitle,
  searchRecentGoogleNews,
} from "@/lib/research/google-news";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const analystMaterialPattern =
  /anality|prognoz|rekomend|rating|domu maklersk|broker|target price|szacunk/i;

export default function AnalystForecastPage({
  params,
}: {
  params: Promise<{ forecastId: string }>;
}) {
  return (
    <main className="dashboard-screen">
      <Suspense fallback={<p className="dashboard-empty">Ładowanie prywatnej prognozy…</p>}>
        <ForecastContent params={params} />
      </Suspense>
    </main>
  );
}

async function ForecastContent({
  params,
}: {
  params: Promise<{ forecastId: string }>;
}) {
  await connection();
  const { forecastId } = await params;
  if (!uuidPattern.test(forecastId)) {
    notFound();
  }

  const { supabase, user } = await requireActiveAccess();
  const { data: forecast, error: forecastError } = await supabase
    .from("user_analyst_forecasts")
    .select(
      "id, owner_id, instrument_id, title, analyst_name, forecast_period, document_date, source_url, storage_path",
    )
    .eq("id", forecastId)
    .maybeSingle();

  if (forecastError) {
    throw forecastError;
  }
  if (!forecast) {
    notFound();
  }

  const { data: role, error: roleError } = await supabase
    .from("user_roles")
    .select("access_role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (roleError) {
    throw roleError;
  }
  if (role?.access_role === "admin" && forecast.owner_id !== user.id) {
    const { error: auditError } = await createAdminClient()
      .from("admin_audit_log")
      .insert({
        actor_id: user.id,
        target_user_id: forecast.owner_id,
        action: "private_forecast.read",
        details: { forecast_id: forecast.id },
      });
    if (auditError) {
      throw auditError;
    }
  }

  const { data: instrument, error: instrumentError } = await supabase
    .from("instrument_catalog")
    .select("company_name, ticker")
    .eq("id", forecast.instrument_id)
    .single();

  if (instrumentError) {
    throw instrumentError;
  }

  const { data: file, error: downloadError } = await createAdminClient()
    .storage
    .from("analyst-forecasts")
    .download(forecast.storage_path);

  if (downloadError) {
    throw downloadError;
  }

  let extractedText: string | null = null;
  let extractionMessage: string | null = null;
  try {
    const extracted = await extractPdfText(new Uint8Array(await file.arrayBuffer()));
    extractedText = extracted.text;
  } catch (error) {
    if (error instanceof PdfTextExtractionError) {
      extractionMessage = error.reason === "no-text"
        ? "PDF nie zawiera odczytywalnej warstwy tekstowej. Skan wymaga OCR, którego aplikacja obecnie nie wykonuje."
        : "PDF przekracza limity odczytu aplikacji.";
    } else {
      console.error("Nie udało się odczytać prywatnej prognozy PDF.", error);
      extractionMessage = "Nie udało się odczytać PDF. Plik może być uszkodzony, zaszyfrowany lub używać nieobsługiwanego formatu.";
    }
  }

  const publicFeed = await searchRecentGoogleNews(
    `"${instrument.company_name}" ${instrument.ticker} (prognoza OR analitycy OR szacunki OR rekomendacja)`,
    new Date(),
  );
  const publicItems = publicFeed.items
    .filter((item) =>
      isRelevantCompanyTitle(item.title, instrument.company_name, instrument.ticker) &&
      analystMaterialPattern.test(`${item.title} ${item.source}`) &&
      hasPublicAnalystExcerpt(item),
    )
    .slice(0, 12);
  const comparison = extractedText
    ? comparePrivateForecast(extractedText, publicItems)
    : null;

  return (
    <div className="pdf-text-reader">
      <Link href="/dashboard">← Wróć do wyszukiwarki spółek</Link>
      <p className="eyebrow">Prywatna prognoza · {instrument.ticker}</p>
      <h1>{forecast.title}</h1>
      <span className="certainty-badge certainty-uncertain">
        Załącznik użytkownika · Niepewne
      </span>
      <p className="pdf-reader-meta">
        {instrument.company_name}
        {forecast.analyst_name ? ` · ${forecast.analyst_name}` : ""}
        {forecast.forecast_period ? ` · okres ${forecast.forecast_period}` : ""}
        {forecast.document_date ? ` · dokument z ${forecast.document_date}` : ""}
      </p>
      {forecast.source_url && (
        <p>
          <a href={forecast.source_url} rel="noreferrer" target="_blank">
            Otwórz podane źródło
          </a>
        </p>
      )}
      <p className="pdf-reader-notice">
        Załącznik jest prywatny: dostęp ma jego właściciel oraz administratorzy.
        Tekst jest odczytywany na żądanie, nie jest zapisywany w bazie ani
        przekazywany do zewnętrznej wyszukiwarki. Wgrywający odpowiada za prawo
        do udostępnienia dokumentu.
      </p>

      {extractionMessage ? (
        <p className="notice notice-error" role="alert">{extractionMessage}</p>
      ) : extractedText && comparison ? (
        <>
          <section aria-label="Porównanie tematów prognozy" className="pdf-analysis">
            <h2>Porównanie widocznych tematów</h2>
            <p className="pdf-reader-notice">
              Zestawiamy tematy rozpoznane w prywatnym PDF z publicznie
              widocznymi zajawkami RSS. To nie jest porównanie liczb ani modeli
              i nie wyjaśnia przyczyn różnic. Treść pełnych publikacji nie jest
              pobierana; pozycje sygnalizujące płatny dostęp są pomijane.
            </p>
            {comparison.hasComparableEvidence ? (
              <ul className="analyst-difference-list">
                {comparison.sharedThemes.length > 0 && (
                  <li>
                    <strong>Tematy wspólne</strong>
                    <span>{comparison.sharedThemes.join(", ")}</span>
                  </li>
                )}
                {comparison.privateOnlyThemes.length > 0 && (
                  <li>
                    <strong>Widoczne w prywatnym załączniku</strong>
                    <span>{comparison.privateOnlyThemes.join(", ")}</span>
                  </li>
                )}
                {comparison.publicOnlyThemes.length > 0 && (
                  <li>
                    <strong>Widoczne w publicznych zajawkach</strong>
                    <span>{comparison.publicOnlyThemes.join(", ")}</span>
                  </li>
                )}
              </ul>
            ) : (
              <p className="search-hint">
                Brak pokrycia analitycznego do porównania: załącznik lub
                publiczne zajawki nie zawierają wystarczających, rozpoznanych
                tematów. Nie dopowiadamy powodów różnic.
              </p>
            )}
            {publicItems.length > 0 ? (
              <ul className="analyst-evidence-list">
                {comparison.evidence.map(({ item, excerpt, themes }) => (
                  <li key={`${item.url}-${item.publishedAt}`}>
                    <a href={item.url} rel="noreferrer" target="_blank">{item.title}</a>
                    <span>
                      {item.source} · {item.publishedAt.slice(0, 10)} · Niepewne
                    </span>
                    {excerpt && <blockquote>{excerpt}</blockquote>}
                    {themes.length > 0 && (
                      <span>Tematy z publicznej zajawki: {themes.join(", ")}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="search-hint">
                Brak pokrycia analitycznego w publicznych zajawkach RSS dla tej
                spółki. Nie używamy nagłówków bez treści do porównania.
              </p>
            )}
          </section>
          <section aria-label="Treść prywatnego dokumentu" className="pdf-extracted-text">
            <h2>Tekst załącznika</h2>
            <pre>{extractedText}</pre>
          </section>
        </>
      ) : (
        <p className="dashboard-empty">Nie udało się odczytać tekstu dokumentu.</p>
      )}
    </div>
  );
}
