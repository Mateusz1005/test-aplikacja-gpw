import "server-only";

import { Readable } from "node:stream";
import { Workbook, type Cell, type Row, type Worksheet } from "exceljs";

export const MAX_CATALOG_IMPORT_BYTES = 750 * 1024;

const MAX_CATALOG_IMPORT_ROWS = 1000;
const REQUIRED_HEADERS = [
  "company_name",
  "ticker",
  "isin",
  "market",
  "source_url",
  "source_date",
  "confidence",
] as const;

const OPTIONAL_HEADERS = [
  "investor_relations_url",
  "next_reporting_date",
  "next_reporting_source_url",
  "next_reporting_verified_at",
] as const;

const REPORTING_HEADERS = [
  "next_reporting_date",
  "next_reporting_source_url",
  "next_reporting_verified_at",
] as const;

const ALL_HEADERS = [...REQUIRED_HEADERS, ...OPTIONAL_HEADERS] as const;

export type CatalogImportRow = {
  company_name: string;
  ticker: string;
  isin: string;
  market: "gpw_main";
  source_url: string;
  source_date: string;
  confidence: "certain" | "uncertain";
  investor_relations_url?: string | null;
  next_reporting_date?: string | null;
  next_reporting_source_url?: string | null;
  next_reporting_verified_at?: string | null;
};

export class CatalogImportError extends Error {
  constructor() {
    super("Plik katalogu ma nieprawidłowy format lub zawiera niepoprawne dane.");
    this.name = "CatalogImportError";
  }
}

export async function parseCatalogImport(
  buffer: Buffer,
  filename: string,
): Promise<CatalogImportRow[]> {
  const extension = filename.toLowerCase().split(".").pop();
  const workbook = new Workbook();
  let worksheet: Worksheet;

  try {
    if (extension === "csv") {
      const delimiter = detectCsvDelimiter(buffer);
      worksheet = await workbook.csv.read(Readable.from([buffer]), {
        parserOptions: { delimiter, trim: true },
      });
    } else if (extension === "xlsx" && buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
      const xlsxBuffer = new ArrayBuffer(buffer.byteLength);
      new Uint8Array(xlsxBuffer).set(buffer);
      await workbook.xlsx.load(xlsxBuffer);
      if (workbook.worksheets.length !== 1) {
        throw new CatalogImportError();
      }
      worksheet = workbook.worksheets[0];
    } else {
      throw new CatalogImportError();
    }
  } catch (error) {
    if (error instanceof CatalogImportError) {
      throw error;
    }
    throw new CatalogImportError();
  }

  return readCatalogRows(worksheet);
}

function detectCsvDelimiter(buffer: Buffer): "," | ";" {
  const firstLine = buffer.toString("utf8").split(/\r?\n/, 1)[0];
  let commas = 0;
  let semicolons = 0;
  let quoted = false;

  for (let index = 0; index < firstLine.length; index += 1) {
    if (firstLine[index] === '"') {
      if (quoted && firstLine[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && firstLine[index] === ",") {
      commas += 1;
    } else if (!quoted && firstLine[index] === ";") {
      semicolons += 1;
    }
  }

  return semicolons > commas ? ";" : ",";
}

function readCatalogRows(worksheet: Worksheet): CatalogImportRow[] {
  if (worksheet.actualRowCount < 2 || worksheet.actualRowCount > MAX_CATALOG_IMPORT_ROWS + 1) {
    throw new CatalogImportError();
  }

  const headerRow = worksheet.getRow(1);
  const headers = Array.from({ length: headerRow.cellCount }, (_, index) =>
    cellText(headerRow.getCell(index + 1), true)
      .replace(/^\uFEFF/, "")
      .toLowerCase(),
  );

  if (
    headers.length < REQUIRED_HEADERS.length ||
    headers.length > ALL_HEADERS.length ||
    new Set(headers).size !== headers.length ||
    headers.some((header) => !ALL_HEADERS.includes(header as (typeof ALL_HEADERS)[number])) ||
    REQUIRED_HEADERS.some((header) => !headers.includes(header))
  ) {
    throw new CatalogImportError();
  }
  const reportingHeadersPresent = REPORTING_HEADERS.filter((header) => headers.includes(header));
  if (
    reportingHeadersPresent.length !== 0 &&
    reportingHeadersPresent.length !== REPORTING_HEADERS.length
  ) {
    throw new CatalogImportError();
  }

  const columnByHeader = new Map(headers.map((header, index) => [header, index + 1]));
  const rows: CatalogImportRow[] = [];
  const seenIsins = new Set<string>();

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1 || isEmptyRow(row)) {
      return;
    }

    const values: Record<(typeof ALL_HEADERS)[number], string> = {
      company_name: "",
      ticker: "",
      isin: "",
      market: "",
      source_url: "",
      source_date: "",
      confidence: "",
      investor_relations_url: "",
      next_reporting_date: "",
      next_reporting_source_url: "",
      next_reporting_verified_at: "",
    };
    for (const header of headers as (typeof ALL_HEADERS)[number][]) {
      values[header] = cellText(
        row.getCell(columnByHeader.get(header)!),
        header.endsWith("_date") || header === "next_reporting_verified_at",
      );
    }
    for (let column = headers.length + 1; column <= row.cellCount; column += 1) {
      if (!isEmptyCell(row.getCell(column))) {
        throw new CatalogImportError();
      }
    }
    const normalized = validateCatalogRow(values, headers);
    if (seenIsins.has(normalized.isin)) {
      throw new CatalogImportError();
    }
    seenIsins.add(normalized.isin);
    rows.push(normalized);
  });

  if (rows.length === 0 || rows.length > MAX_CATALOG_IMPORT_ROWS) {
    throw new CatalogImportError();
  }

  return rows;
}

function isEmptyRow(row: Row): boolean {
  return Array.from({ length: row.cellCount }, (_, index) => row.getCell(index + 1))
    .every(isEmptyCell);
}

function isEmptyCell(cell: Cell): boolean {
  return cell.value === null || cell.value === undefined || cell.value === "";
}

function cellText(cell: Cell, allowDate: boolean): string {
  const value = cell.value;
  if (value === null || value === undefined) {
    return "";
  }
  if (allowDate && value instanceof Date && Number.isFinite(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  throw new CatalogImportError();
}

function validateCatalogRow(
  values: Record<(typeof ALL_HEADERS)[number], string>,
  headers: string[],
): CatalogImportRow {
  const companyName = values.company_name.trim();
  const ticker = values.ticker.trim().toUpperCase();
  const isin = values.isin.trim().toUpperCase();
  const market = values.market.trim();
  const sourceUrl = values.source_url.trim();
  const sourceDate = values.source_date.trim();
  const confidence = values.confidence.trim();
  const investorRelationsUrl = validateHttpsUrl(values.investor_relations_url);
  const nextReportingDate = validateOptionalDate(values.next_reporting_date);
  const nextReportingSourceUrl = validateHttpsUrl(values.next_reporting_source_url);
  const nextReportingVerifiedAt = validateOptionalDate(values.next_reporting_verified_at);

  if (
    companyName.length < 1 ||
    companyName.length > 200 ||
    ticker.length < 1 ||
    ticker.length > 32 ||
    /\s/.test(ticker) ||
    !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin) ||
    market !== "gpw_main" ||
    confidence !== "certain" && confidence !== "uncertain" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(sourceDate)
  ) {
    throw new CatalogImportError();
  }

  const parsedDate = new Date(`${sourceDate}T00:00:00.000Z`);
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== sourceDate) {
    throw new CatalogImportError();
  }

  const parsedSourceDate = validateHttpsUrl(sourceUrl, ["gpw.pl"]);
  if (!parsedSourceDate) {
    throw new CatalogImportError();
  }
  const hasAnyReportingData =
    nextReportingDate !== null ||
    nextReportingSourceUrl !== null ||
    nextReportingVerifiedAt !== null;
  const hasCompleteReportingData =
    nextReportingDate !== null &&
    nextReportingSourceUrl !== null &&
    nextReportingVerifiedAt !== null;
  if (hasAnyReportingData && !hasCompleteReportingData) {
    throw new CatalogImportError();
  }

  return {
    company_name: companyName,
    ticker,
    isin,
    market,
    source_url: parsedSourceDate,
    source_date: sourceDate,
    confidence,
    ...(headers.includes("investor_relations_url")
      ? { investor_relations_url: investorRelationsUrl }
      : {}),
    ...(REPORTING_HEADERS.every((header) => headers.includes(header))
      ? {
          next_reporting_date: nextReportingDate,
          next_reporting_source_url: nextReportingSourceUrl,
          next_reporting_verified_at: nextReportingVerifiedAt,
        }
      : {}),
  };
}

function validateOptionalDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new CatalogImportError();
  }
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
    throw new CatalogImportError();
  }
  return trimmed;
}

function validateHttpsUrl(value: string, allowedHosts?: string[]): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new CatalogImportError();
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (allowedHosts &&
      !allowedHosts.some((allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`)))
  ) {
    throw new CatalogImportError();
  }
  return url.toString();
}
