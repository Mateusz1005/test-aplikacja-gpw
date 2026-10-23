import "server-only";

import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireActiveAccess } from "@/lib/auth/guards";
import { extractPdfText, PdfTextExtractionError } from "@/lib/documents/pdf-text";
import {
  compareFinancialLines,
  summarizeFinancialDocument,
  type FinancialDocumentSummary,
} from "@/lib/documents/financial-summary";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function extractionErrorMessage(error: PdfTextExtractionError): string {
  switch (error.reason) {
    case "no-text":
      return "Ten PDF nie zawiera możliwej do odczytania warstwy tekstowej. Może być skanem; do odczytu potrzebne będzie OCR.";
    case "too-many-pages":
      return "Dokument przekracza limit 500 stron dla odczytu w aplikacji.";
    case "too-much-text":
      return "Dokument przekracza limit tekstu możliwego do bezpiecznego wyświetlenia.";
  }
}

function splitExtractedPages(text: string): Array<{ pageNumber: number; text: string }> {
  const matches = [...text.matchAll(/--- Strona (\d+) ---\s*([\s\S]*?)(?=--- Strona \d+ ---|$)/g)];
  if (matches.length === 0) {
    return [{ pageNumber: 1, text }];
  }
  return matches.map((match) => ({
    pageNumber: Number(match[1]),
    text: match[2],
  }));
}

function financialLineCountLabel(count: number): string {
  if (count === 1) {
    return "wiersz";
  }
  return count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)
    ? "wiersze"
    : "wierszy";
}

export default function PdfTextPage({
  params,
  searchParams,
}: {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<{ compare?: string | string[] }>;
}) {
  return (
    <Suspense
      fallback={
        <main className="dashboard-screen">
          <div className="pdf-text-reader" role="status">Odczytuję dokument…</div>
        </main>
      }
    >
      <PdfTextContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function PdfTextContent({
  params,
  searchParams,
}: {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<{ compare?: string | string[] }>;
}) {
  await connection();
  const [{ documentId }, query] = await Promise.all([params, searchParams]);
  if (!uuidPattern.test(documentId)) {
    notFound();
  }

  const { supabase } = await requireActiveAccess();
  const { data: document, error: documentError } = await supabase
    .from("company_documents")
    .select("title, publication_date, source_url, storage_path, instrument_id, document_type, reporting_period")
    .eq("id", documentId)
    .maybeSingle();

  if (documentError) {
    throw documentError;
  }
  if (!document?.storage_path) {
    notFound();
  }

  const compareId = typeof query.compare === "string" ? query.compare : "";
  const canCompare =
    document.document_type === "annual_report" || document.document_type === "interim_report";
  const { data: availableComparisons, error: comparisonsError } = canCompare
    ? await supabase
        .from("company_documents")
        .select("id, title, publication_date, reporting_period, storage_path")
        .eq("instrument_id", document.instrument_id)
        .eq("document_type", document.document_type)
        .eq("status", "ready")
        .not("storage_path", "is", null)
        .neq("id", documentId)
        .order("publication_date", { ascending: false, nullsFirst: false })
        .limit(12)
    : { data: [], error: null };

  if (comparisonsError) {
    throw comparisonsError;
  }

  const comparison = availableComparisons.find(
    (candidate) => candidate.id === compareId && candidate.storage_path,
  );
  const { data: file, error: downloadError } = await createAdminClient()
    .storage
    .from("company-reports")
    .download(document.storage_path);

  if (downloadError) {
    throw downloadError;
  }

  let pageCount: number | null = null;
  let text: string | null = null;
  let message: string | null = null;
  let summary: FinancialDocumentSummary | null = null;
  let comparisonSummary: FinancialDocumentSummary | null = null;
  let comparisonError: string | null = null;

  try {
    const extracted = await extractPdfText(new Uint8Array(await file.arrayBuffer()));
    pageCount = extracted.pageCount;
    text = extracted.text;
    summary = summarizeFinancialDocument(extracted.text);
  } catch (error) {
    if (error instanceof PdfTextExtractionError) {
      message = extractionErrorMessage(error);
    } else {
      console.error("Nie udało się odczytać tekstu dokumentu PDF.", error);
      message = "Nie udało się odczytać PDF. Plik może być uszkodzony, zaszyfrowany lub używać nieobsługiwanego formatu.";
    }
  }

  if (comparison?.storage_path) {
    try {
      const { data: comparisonFile, error: comparisonDownloadError } =
        await createAdminClient()
          .storage
          .from("company-reports")
          .download(comparison.storage_path);
      if (comparisonDownloadError) {
        throw comparisonDownloadError;
      }
      const comparisonExtracted = await extractPdfText(
        new Uint8Array(await comparisonFile.arrayBuffer()),
      );
      comparisonSummary = summarizeFinancialDocument(comparisonExtracted.text);
    } catch (error) {
      if (error instanceof PdfTextExtractionError) {
        comparisonError = error.reason === "no-text"
          ? "Wybrany dokument nie zawiera odczytywalnej warstwy tekstowej."
          : "Wybrany dokument przekracza limity automatycznego odczytu.";
      } else {
        console.error("Nie udało się odczytać dokumentu do porównania.", error);
        comparisonError = "Nie udało się odczytać drugiego dokumentu.";
      }
    }
  }

  const comparedLines = summary && comparisonSummary
    ? compareFinancialLines(summary, comparisonSummary)
    : [];
  const extractedPages = text ? splitExtractedPages(text) : [];

  return (
    <main className="dashboard-screen">
      <div className="pdf-text-reader">
        <Link href="/dashboard">← Wróć do wyszukiwarki spółek</Link>
        <p className="eyebrow">Czytnik dokumentów</p>
        <h1>{document.title}</h1>
        {document.publication_date && (
          <p className="pdf-reader-meta">
            Data publikacji:{" "}
            {new Intl.DateTimeFormat("pl-PL", {
              dateStyle: "long",
              timeZone: "Europe/Warsaw",
            }).format(new Date(document.publication_date))}
          </p>
        )}
        {document.reporting_period && (
          <p className="pdf-reader-meta">Okres raportowy: {document.reporting_period}</p>
        )}
        {document.source_url && (
          <p className="pdf-reader-meta">
            <a href={document.source_url} rel="noreferrer" target="_blank">
              Otwórz źródło dokumentu u wydawcy
            </a>
          </p>
        )}
        <p className="pdf-reader-notice">
          Tekst jest odczytywany z PDF na żądanie i nie jest zapisywany w bazie.
          Odczyt obejmuje warstwę tekstową dokumentu. OCR skanów nie jest
          dostępny; jeśli brak tekstu, otwórz oryginalny PDF lub źródło wydawcy.
        </p>
        {canCompare && (
          <form className="pdf-comparison-form" method="get">
            <label htmlFor="compare-report">Zestaw z innym raportem tej spółki i tego samego rodzaju</label>
            <div>
              <select defaultValue={comparison?.id ?? ""} id="compare-report" name="compare">
                <option value="">Nie wybieraj raportu</option>
                {availableComparisons.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.title}
                    {candidate.reporting_period ? ` · ${candidate.reporting_period}` : ""}
                    {candidate.publication_date ? ` · ${candidate.publication_date}` : ""}
                  </option>
                ))}
              </select>
              <button className="button button-primary" type="submit">Porównaj wiersze</button>
            </div>
            <p className="search-hint">
              Zestawiamy surowe fragmenty wierszy przypisanych do tej samej
              kategorii. Nie obliczamy zmian ani nie zakładamy, że okresy są
              porównywalne.
            </p>
            {availableComparisons.length === 0 && (
              <p className="search-hint">
                Brak innego gotowego raportu tego samego rodzaju dla tej spółki.
              </p>
            )}
          </form>
        )}
        {message ? (
          <p className="notice notice-error" role="alert">
            {message}{" "}
            <a href={`/dashboard/documents/${documentId}/download`}>
              Pobierz oryginalny PDF
            </a>
          </p>
        ) : (
          <>
            <p className="pdf-reader-meta">
              Odczytano {pageCount} {pageCount === 1 ? "stronę" : "stron"}.
              Wartości i układ tabel mogą wymagać weryfikacji z oryginalnym PDF.
            </p>
            {summary && (
              <section aria-label="Rozpoznanie dokumentu i danych" className="pdf-analysis">
                <span className="certainty-badge certainty-uncertain">
                  {summary.documentLabel} · Niepewne
                </span>
                <h2>Rozpoznane informacje</h2>
                <dl className="pdf-analysis-meta">
                  {summary.companyName && (
                    <div>
                      <dt>Spółka lub grupa</dt>
                      <dd>{summary.companyName}</dd>
                    </div>
                  )}
                  {summary.reportingPeriod && (
                    <div>
                      <dt>Okres wskazany w dokumencie</dt>
                      <dd>{summary.reportingPeriod}</dd>
                    </div>
                  )}
                </dl>
                <p className="pdf-reader-notice">{summary.limitation}</p>
                {summary.documentKind === "financial-statements" && (
                  <>
                    <div className="pdf-analysis-note">
                      <strong>Szybki przegląd zakresu</strong>
                      {summary.lines.length > 0 ? (
                        <p>
                          Rozpoznano {summary.lines.length}{" "}
                          {financialLineCountLabel(summary.lines.length)} w kategoriach:{" "}
                          {summary.categoryCoverage
                            .filter(({ labels }) => labels.length > 0)
                            .map(({ category }) => category)
                            .join(", ")}.
                          {" "}Nierozpoznane pozycje mogły występować w raporcie,
                          ale nie zostały pewnie odczytane z wybranych stron tabel.
                        </p>
                      ) : (
                        <p>
                          Nie rozpoznano wiarygodnych wierszy liczbowych. Nie
                          oznacza to, że sprawozdanie nie zawiera tych danych.
                        </p>
                      )}
                    </div>
                    <p className="pdf-analysis-note">
                      Automatyczne zestawienie obejmuje wyłącznie rozpoznane pozycje
                      z podsumowania lub głównych tabel. Różne waluty, jednostki,
                      zakresy konsolidacji i okresy nie są przeliczane ani
                      uzgadniane.
                    </p>
                  </>
                )}
                {summary.auditorConclusion && (
                  <blockquote className="pdf-analysis-conclusion">
                    <strong>
                      {summary.auditorConclusion.label} · strona{" "}
                      {summary.auditorConclusion.pageNumber}
                    </strong>
                    <p>{summary.auditorConclusion.excerpt}</p>
                  </blockquote>
                )}
                {comparison && comparisonSummary && (
                  <section aria-label="Porównanie raportów" className="pdf-report-comparison">
                    <h3>Zestawienie wierszy z dwóch dokumentów</h3>
                    <p className="search-hint">
                      Bieżący: {document.title}
                      {document.reporting_period ? ` · ${document.reporting_period}` : ""}
                      {" · "}
                      Porównawczy: {comparison.title}
                      {comparison.reporting_period ? ` · ${comparison.reporting_period}` : ""}
                    </p>
                    <p className="pdf-reader-notice">
                      Zestawiamy tylko jednoznaczne wiersze o tej samej kategorii
                      i etykiecie. To surowe fragmenty, nie obliczenie dynamiki;
                      powtarzające się lub niejednoznaczne pozycje pomijamy.
                      Wartości, jednostki i porównywalność okresów sprawdź na
                      wskazanych stronach oryginalnych PDF-ów.
                    </p>
                    {comparedLines.length > 0 ? (
                      <ul className="pdf-comparison-lines">
                        {comparedLines.map(({ label, current, comparison: prior }) => (
                          <li key={`${label}-${current.pageNumber}-${prior.pageNumber}`}>
                            <strong>{label}</strong>
                            <div>
                              <span>
                                <b>
                                  {document.reporting_period ?? document.title} · strona{" "}
                                  <a href={`#pdf-page-${current.pageNumber}`}>{current.pageNumber}</a>
                                </b>
                                {current.excerpt}
                              </span>
                              <span>
                                <b>
                                  {comparison.reporting_period ?? comparison.title} · strona{" "}
                                  {prior.pageNumber}
                                </b>
                                {prior.excerpt}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="dashboard-empty">
                        Nie znaleziono wspólnych, rozpoznanych wierszy finansowych.
                        Porównanie nie jest dostępne dla raportu z przeglądu.
                      </p>
                    )}
                  </section>
                )}
                {comparisonError && (
                  <p className="notice notice-error" role="alert">{comparisonError}</p>
                )}
                {summary.lines.length > 0 ? (
                  <>
                    {(["Wyniki", "Bilans", "Przepływy pieniężne"] as const).map((category) => {
                      const categoryLines = summary.lines.filter((line) => line.category === category);
                      if (categoryLines.length === 0) {
                        return null;
                      }
                      return (
                        <section aria-label={category} className="pdf-financial-category" key={category}>
                          <h3>{category} · rozpoznane wiersze</h3>
                          <ul className="pdf-analysis-lines">
                            {categoryLines.map((line) => (
                              <li key={`${line.pageNumber}-${line.label}-${line.excerpt}`}>
                                <strong>
                                  {line.label} · strona{" "}
                                  <a href={`#pdf-page-${line.pageNumber}`}>{line.pageNumber}</a>
                                </strong>
                                <span>{line.excerpt}</span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      );
                    })}
                  </>
                ) : summary.documentKind === "auditor-review" ? (
                  <p className="dashboard-empty">
                    Ten dokument opisuje zakres i wniosek biegłego rewidenta.
                    Nie zawiera tabel z wynikami, które pozwoliłyby porównać
                    przychody, zyski lub przepływy pieniężne.
                  </p>
                ) : (
                  <p className="dashboard-empty">
                    Brak wiarygodnie rozpoznanych wierszy finansowych.
                  </p>
                )}
                <p className="search-hint">
                  Rozpoznanie automatyczne nie jest pełną analizą ani
                  rekomendacją. Wartości nie są ujednolicane ani przeliczane;
                  opinie analityków należy oceniać osobno według wydawcy, daty
                  i zakresu prognozy.
                </p>
              </section>
            )}
            <section aria-label="Pełny tekst PDF" className="pdf-extracted-pages">
              <h2>Pełny tekst dokumentu</h2>
              <p className="search-hint">
                Odnośniki do numerów stron w rozpoznanych pozycjach przewijają
                do odpowiadającego im tekstu poniżej.
              </p>
              {extractedPages.map(({ pageNumber, text: pageText }) => (
                <section
                  aria-label={`Tekst strony ${pageNumber}`}
                  className="pdf-extracted-page"
                  id={`pdf-page-${pageNumber}`}
                  key={pageNumber}
                >
                  <h3>Strona {pageNumber}</h3>
                  <pre className="pdf-reader-text">{pageText}</pre>
                </section>
              ))}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
