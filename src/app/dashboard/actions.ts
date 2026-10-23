"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActiveAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REPORT_BYTES = 25 * 1024 * 1024;
const documentTypes = [
  "annual_report",
  "interim_report",
  "current_report",
  "presentation",
  "other",
] as const;
const portfolioEntryTypes = ["investment", "dividend"] as const;
const portfolioAssetTypes = ["stock", "etf"] as const;

type DocumentType = (typeof documentTypes)[number];

function isOneOf<const Values extends readonly string[]>(
  values: Values,
  value: string,
): value is Values[number] {
  return values.includes(value);
}

function getDocumentType(formData: FormData): DocumentType {
  const value = formData.get("document_type");
  if (typeof value !== "string" || !documentTypes.includes(value as DocumentType)) {
    redirect("/dashboard?error=upload-invalid");
  }
  return value as DocumentType;
}

function getInstrumentId(formData: FormData): string {
  const instrumentId = formData.get("instrument_id");
  if (typeof instrumentId !== "string" || !uuidPattern.test(instrumentId)) {
    redirect("/dashboard?error=invalid-input");
  }
  return instrumentId;
}

function getOptionalText(formData: FormData, name: string, maxLength: number): string | null {
  const value = formData.get(name);
  if (value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || value.length > maxLength) {
    redirect("/dashboard?error=upload-invalid");
  }
  const normalized = value.trim();
  return normalized || null;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function getPortfolioValue(
  formData: FormData,
  name: string,
  maxValue: number,
  decimals: number,
): number {
  const value = formData.get(name);
  if (typeof value !== "string" || value === "") {
    redirect("/dashboard?error=portfolio-invalid");
  }
  const normalized = value.trim().replace(",", ".");
  const pattern = decimals === 0
    ? /^\d+$/
    : new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`);
  const parsed = Number(normalized);
  if (!pattern.test(normalized) || !Number.isFinite(parsed) || parsed > maxValue) {
    redirect("/dashboard?error=portfolio-invalid");
  }
  return parsed;
}

function safeFilename(value: string): string {
  return value
    .replace(/[\\/\u0000-\u001f\u007f]/g, "_")
    .trim()
    .slice(0, 255);
}

export async function addPortfolioEntry(formData: FormData) {
  const { supabase, user } = await requireActiveAccess();
  const tickerValue = formData.get("ticker");
  const entryTypeValue = formData.get("entry_type");
  const assetTypeValue = formData.get("asset_type");
  const eventDateValue = formData.get("event_date");

  if (
    typeof tickerValue !== "string" ||
    typeof entryTypeValue !== "string" ||
    !isOneOf(portfolioEntryTypes, entryTypeValue) ||
    typeof assetTypeValue !== "string" ||
    !isOneOf(portfolioAssetTypes, assetTypeValue) ||
    typeof eventDateValue !== "string" ||
    !isIsoDate(eventDateValue) ||
    eventDateValue > new Date().toISOString().slice(0, 10)
  ) {
    redirect("/dashboard?error=portfolio-invalid");
  }

  const ticker = tickerValue.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(ticker)) {
    redirect("/dashboard?error=portfolio-invalid");
  }

  const base = {
    user_id: user.id,
    ticker,
    asset_type: assetTypeValue,
    entry_type: entryTypeValue,
    event_date: eventDateValue,
  };

  if (entryTypeValue === "investment") {
    const units = getPortfolioValue(formData, "units", 99999999999999, 6);
    const investmentAmount = getPortfolioValue(
      formData,
      "investment_amount",
      999999999999.99,
      2,
    );
    const commissionAmount = getPortfolioValue(
      formData,
      "commission_amount",
      999999999999.99,
      2,
    );
    if (units <= 0 || investmentAmount <= 0 || commissionAmount < 0) {
      redirect("/dashboard?error=portfolio-invalid");
    }

    const { error } = await supabase.from("portfolio_entries").insert({
      ...base,
      entry_type: "investment",
      units,
      investment_amount: investmentAmount,
      commission_amount: commissionAmount,
      dividend_amount: null,
    });
    if (error) throw error;
  } else {
    const dividendAmount = getPortfolioValue(
      formData,
      "dividend_amount",
      999999999999.99,
      2,
    );
    if (dividendAmount <= 0) {
      redirect("/dashboard?error=portfolio-invalid");
    }

    const { error } = await supabase.from("portfolio_entries").insert({
      ...base,
      entry_type: "dividend",
      units: null,
      investment_amount: null,
      commission_amount: null,
      dividend_amount: dividendAmount,
    });
    if (error) throw error;
  }

  revalidatePath("/dashboard");
}

export async function removePortfolioEntry(formData: FormData) {
  const { supabase, user } = await requireActiveAccess();
  const entryId = formData.get("entry_id");
  if (typeof entryId !== "string" || !uuidPattern.test(entryId)) {
    redirect("/dashboard?error=portfolio-invalid");
  }

  const { error } = await supabase
    .from("portfolio_entries")
    .delete()
    .eq("id", entryId)
    .eq("user_id", user.id);

  if (error) {
    throw error;
  }
  revalidatePath("/dashboard");
}

export async function saveWatchlistItem(formData: FormData) {
  const { supabase, user } = await requireActiveAccess();
  const instrumentId = getInstrumentId(formData);
  const note = formData.get("note");

  if (typeof note !== "string" || note.length > 2000) {
    redirect("/dashboard?error=invalid-note");
  }

  const { error } = await supabase.from("user_watchlist").upsert(
    {
      user_id: user.id,
      instrument_id: instrumentId,
      note: note.trim(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,instrument_id" },
  );

  if (error) {
    throw error;
  }

  revalidatePath("/dashboard");
}

export async function uploadCompanyDocument(formData: FormData) {
  const { supabase, user } = await requireActiveAccess();
  const instrumentId = getInstrumentId(formData);
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    redirect("/dashboard?error=upload-invalid");
  }
  if (file.size > MAX_REPORT_BYTES) {
    redirect("/dashboard?error=upload-too-large");
  }
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    redirect("/dashboard?error=upload-invalid");
  }

  const titleValue = getOptionalText(formData, "title", 300);
  const reportingPeriod = getOptionalText(formData, "reporting_period", 32);
  const publicationDate = getOptionalText(formData, "publication_date", 10);
  const sourceUrlValue = getOptionalText(formData, "source_url", 2000);
  const documentType = getDocumentType(formData);

  if (publicationDate && !isIsoDate(publicationDate)) {
    redirect("/dashboard?error=upload-invalid");
  }

  let sourceUrl: string | null = null;
  if (sourceUrlValue) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(sourceUrlValue);
    } catch {
      redirect("/dashboard?error=upload-invalid");
    }
    if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) {
      redirect("/dashboard?error=upload-invalid");
    }
    sourceUrl = parsedUrl.toString();
  }

  const { data: instrument, error: instrumentError } = await supabase
    .from("instrument_catalog")
    .select("id")
    .eq("id", instrumentId)
    .maybeSingle();

  if (instrumentError) {
    throw instrumentError;
  }
  if (!instrument) {
    redirect("/dashboard?error=upload-invalid");
  }

  const safeOriginalFilename = safeFilename(file.name);
  if (!safeOriginalFilename) {
    redirect("/dashboard?error=upload-invalid");
  }

  const contents = Buffer.from(await file.arrayBuffer());
  if (contents.subarray(0, 5).toString("ascii") !== "%PDF-") {
    redirect("/dashboard?error=upload-invalid");
  }

  const sha256 = createHash("sha256").update(contents).digest("hex");
  const admin = createAdminClient();
  const { data: existingDocument, error: duplicateCheckError } = await admin
    .from("company_documents")
    .select("id")
    .eq("instrument_id", instrumentId)
    .eq("sha256", sha256)
    .maybeSingle();

  if (duplicateCheckError) {
    throw duplicateCheckError;
  }
  if (existingDocument) {
    redirect("/dashboard?error=upload-duplicate");
  }

  const documentId = randomUUID();
  const storagePath = `${user.id}/${documentId}.pdf`;
  const uploadedTitle =
    titleValue ?? safeOriginalFilename.replace(/\.pdf$/i, "").trim().slice(0, 300);
  const { error: storageError } = await admin.storage
    .from("company-reports")
    .upload(storagePath, contents, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (storageError) {
    throw storageError;
  }

  const { error: insertError } = await admin.from("company_documents").insert({
    id: documentId,
    instrument_id: instrumentId,
    source_kind: "user_upload",
    document_type: documentType,
    title: uploadedTitle || safeOriginalFilename,
    reporting_period: reportingPeriod,
    publication_date: publicationDate,
    source_url: sourceUrl,
    storage_path: storagePath,
    original_file_name: safeOriginalFilename,
    mime_type: "application/pdf",
    file_size_bytes: contents.byteLength,
    sha256,
    uploaded_by: user.id,
    status: "ready",
  });

  if (insertError) {
    const { error: cleanupError } = await admin.storage
      .from("company-reports")
      .remove([storagePath]);
    if (cleanupError) {
      throw new AggregateError(
        [insertError, cleanupError],
        "Nie udało się zapisać metadanych raportu ani usunąć przesłanego pliku.",
      );
    }
    if (insertError.code === "23505") {
      redirect("/dashboard?error=upload-duplicate");
    }
    throw insertError;
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard/documents/${documentId}/text`);
}

export async function uploadAnalystForecast(formData: FormData) {
  const { supabase, user } = await requireActiveAccess();
  const instrumentId = getInstrumentId(formData);
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0 || !file.name.toLowerCase().endsWith(".pdf")) {
    redirect("/dashboard?error=forecast-invalid");
  }
  if (file.size > MAX_REPORT_BYTES) {
    redirect("/dashboard?error=forecast-too-large");
  }

  const titleValue = getOptionalText(formData, "title", 300);
  const analystName = getOptionalText(formData, "analyst_name", 200);
  const forecastPeriod = getOptionalText(formData, "forecast_period", 100);
  const documentDate = getOptionalText(formData, "document_date", 10);
  const sourceUrlValue = getOptionalText(formData, "source_url", 2000);

  if (documentDate && !isIsoDate(documentDate)) {
    redirect("/dashboard?error=forecast-invalid");
  }

  let sourceUrl: string | null = null;
  if (sourceUrlValue) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(sourceUrlValue);
    } catch {
      redirect("/dashboard?error=forecast-invalid");
    }
    if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) {
      redirect("/dashboard?error=forecast-invalid");
    }
    sourceUrl = parsedUrl.toString();
  }

  const { data: instrument, error: instrumentError } = await supabase
    .from("instrument_catalog")
    .select("id")
    .eq("id", instrumentId)
    .maybeSingle();

  if (instrumentError) {
    throw instrumentError;
  }
  if (!instrument) {
    redirect("/dashboard?error=forecast-invalid");
  }

  const originalFilename = safeFilename(file.name);
  if (!originalFilename) {
    redirect("/dashboard?error=forecast-invalid");
  }

  const contents = Buffer.from(await file.arrayBuffer());
  if (contents.subarray(0, 5).toString("ascii") !== "%PDF-") {
    redirect("/dashboard?error=forecast-invalid");
  }

  const sha256 = createHash("sha256").update(contents).digest("hex");
  const documentId = randomUUID();
  const storagePath = `${user.id}/${documentId}.pdf`;
  const uploadedTitle =
    titleValue ?? originalFilename.replace(/\.pdf$/i, "").trim().slice(0, 300);
  const admin = createAdminClient();
  const { error: storageError } = await admin.storage
    .from("analyst-forecasts")
    .upload(storagePath, contents, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (storageError) {
    throw storageError;
  }

  const { error: insertError } = await admin.from("user_analyst_forecasts").insert({
    id: documentId,
    owner_id: user.id,
    instrument_id: instrumentId,
    title: uploadedTitle || originalFilename,
    analyst_name: analystName,
    forecast_period: forecastPeriod,
    document_date: documentDate,
    source_url: sourceUrl,
    storage_path: storagePath,
    original_file_name: originalFilename,
    mime_type: "application/pdf",
    file_size_bytes: contents.byteLength,
    sha256,
  });

  if (insertError) {
    const { error: cleanupError } = await admin.storage
      .from("analyst-forecasts")
      .remove([storagePath]);
    if (cleanupError) {
      throw new AggregateError(
        [insertError, cleanupError],
        "Nie udało się zapisać prognozy ani usunąć przesłanego pliku.",
      );
    }
    if (insertError.code === "23505") {
      redirect("/dashboard?error=forecast-duplicate");
    }
    throw insertError;
  }

  revalidatePath("/dashboard");
}

export async function removeWatchlistItem(formData: FormData) {
  const { supabase, user } = await requireActiveAccess();
  const instrumentId = getInstrumentId(formData);
  const { error } = await supabase
    .from("user_watchlist")
    .delete()
    .eq("user_id", user.id)
    .eq("instrument_id", instrumentId);

  if (error) {
    throw error;
  }

  revalidatePath("/dashboard");
}
