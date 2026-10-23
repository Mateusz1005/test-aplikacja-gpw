import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { searchRecentGoogleNewsVariants } from "@/lib/research/google-news";

export type MonitoredInstrument = {
  id: string;
  ticker: string;
  company_name: string;
};

export type InstrumentMonitoringResult =
  | { available: false }
  | { available: true; found: number; saved: number; processed: number };

export async function monitorInstrument(
  instrument: MonitoredInstrument,
  limit = 50,
): Promise<InstrumentMonitoringResult> {
  const feed = await searchRecentGoogleNewsVariants([
    instrument.ticker,
    instrument.company_name,
  ]);
  const admin = createAdminClient();
  const checkedAt = new Date().toISOString();

  if (!feed.available) {
    const { error } = await admin.from("research_monitor_state").upsert({
      instrument_id: instrument.id,
      last_checked_at: checkedAt,
      check_error: "Google News RSS jest obecnie niedostępny.",
    });
    if (error) {
      throw error;
    }
    return { available: false };
  }

  const items = feed.items.slice(0, limit);
  const rows = items.map((item) => {
    const url = new URL(item.url);
    const source = item.source.trim() || "Google News";
    if (
      url.protocol !== "https:" ||
      !item.title.trim() ||
      item.title.length > 500 ||
      source.length > 200 ||
      (item.description?.length ?? 0) > 500
    ) {
      throw new Error("RSS zwrócił pozycję o nieprawidłowym formacie.");
    }

    return {
      instrument_id: instrument.id,
      title: item.title,
      url: item.url,
      source,
      description: item.description,
      published_at: new Date(item.publishedAt).toISOString().slice(0, 10),
      content_kind: "news",
      is_reviewed: false,
    };
  });

  const { data: savedItems, error: itemsError } =
    rows.length === 0
      ? { data: [], error: null }
      : await admin
          .from("monitored_research_items")
          .upsert(rows, {
            onConflict: "url,instrument_id",
            ignoreDuplicates: true,
          })
          .select("id");
  if (itemsError) {
    throw itemsError;
  }

  const { error: stateError } = await admin
    .from("research_monitor_state")
    .upsert({
      instrument_id: instrument.id,
      last_checked_at: checkedAt,
      last_successful_check_at: checkedAt,
      check_error: null,
      news_checked_at: checkedAt,
    });
  if (stateError) {
    throw stateError;
  }

  return {
    available: true,
    found: feed.items.length,
    saved: savedItems?.length ?? 0,
    processed: items.length,
  };
}
