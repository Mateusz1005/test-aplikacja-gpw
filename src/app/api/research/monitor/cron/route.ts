import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { monitorInstrument } from "@/lib/research/monitoring";

const monitoringIntervalMs = 6 * 60 * 60 * 1000;
const batchSize = 6;
const concurrency = 3;

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.RESEARCH_MONITOR_CRON_SECRET;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || expected.length < 32 || !provided) {
    return false;
  }

  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return (
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}

export async function POST(request: NextRequest) {
  if (!process.env.RESEARCH_MONITOR_CRON_SECRET) {
    return NextResponse.json(
      { error: "Harmonogram monitorowania nie jest skonfigurowany." },
      { status: 503 },
    );
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const { data: watchlist, error: watchlistError } = await admin
      .from("user_watchlist")
      .select("user_id, instrument_id, created_at")
      .order("created_at", { ascending: true });
    if (watchlistError) {
      throw watchlistError;
    }
    if (!watchlist.length) {
      return NextResponse.json({ checked: 0, saved: 0, failed: 0, deferred: 0 });
    }

    const userIds = [...new Set(watchlist.map((entry) => entry.user_id))];
    const [
      { data: accesses, error: accessError },
      { data: roles, error: rolesError },
    ] = await Promise.all([
      admin
        .from("user_access")
        .select("user_id, access_status, access_starts_at, access_expires_at")
        .in("user_id", userIds)
        .eq("access_status", "active"),
      admin
        .from("user_roles")
        .select("user_id")
        .in("user_id", userIds)
        .eq("access_role", "admin"),
    ]);
    if (accessError) {
      throw accessError;
    }
    if (rolesError) {
      throw rolesError;
    }

    const now = Date.now();
    const activeUserIds = new Set(
      accesses
        .filter((access) =>
          (!access.access_starts_at || Date.parse(access.access_starts_at) <= now) &&
          (!access.access_expires_at || Date.parse(access.access_expires_at) > now),
        )
        .map((access) => access.user_id),
    );
    for (const role of roles) {
      activeUserIds.add(role.user_id);
    }

    const eligibleWatchlist = watchlist.filter((entry) =>
      activeUserIds.has(entry.user_id),
    );
    const instrumentIds = [...new Set(
      eligibleWatchlist.map((entry) => entry.instrument_id),
    )];
    if (instrumentIds.length === 0) {
      return NextResponse.json({ checked: 0, saved: 0, failed: 0, deferred: 0 });
    }

    const [
      { data: instruments, error: instrumentsError },
      { data: states, error: statesError },
    ] = await Promise.all([
      admin
        .from("instrument_catalog")
        .select("id, ticker, company_name")
        .in("id", instrumentIds),
      admin
        .from("research_monitor_state")
        .select("instrument_id, last_checked_at")
        .in("instrument_id", instrumentIds),
    ]);
    if (instrumentsError) {
      throw instrumentsError;
    }
    if (statesError) {
      throw statesError;
    }

    const stateByInstrument = new Map(
      states.map((state) => [state.instrument_id, state.last_checked_at]),
    );
    const threshold = now - monitoringIntervalMs;
    const dueInstruments = instruments
      .filter((instrument) => {
        const lastChecked = stateByInstrument.get(instrument.id);
        return !lastChecked || Date.parse(lastChecked) <= threshold;
      })
      .sort((left, right) => {
        const leftChecked = stateByInstrument.get(left.id);
        const rightChecked = stateByInstrument.get(right.id);
        return (
          (leftChecked ? Date.parse(leftChecked) : 0) -
          (rightChecked ? Date.parse(rightChecked) : 0)
        );
      });

    const batch = dueInstruments.slice(0, batchSize);
    const results: Array<{
      ticker: string;
      status: "checked" | "unavailable" | "failed";
      found: number;
      saved: number;
    }> = [];

    for (let index = 0; index < batch.length; index += concurrency) {
      const group = batch.slice(index, index + concurrency);
      const groupResults = await Promise.all(
        group.map(async (instrument) => {
          try {
            const result = await monitorInstrument(instrument);
            return result.available
              ? {
                  ticker: instrument.ticker,
                  status: "checked" as const,
                  found: result.found,
                  saved: result.saved,
                }
              : {
                  ticker: instrument.ticker,
                  status: "unavailable" as const,
                  found: 0,
                  saved: 0,
                };
          } catch (error) {
            console.error(`Błąd monitorowania ${instrument.ticker}:`, error);
            return {
              ticker: instrument.ticker,
              status: "failed" as const,
              found: 0,
              saved: 0,
            };
          }
        }),
      );
      results.push(...groupResults);
    }

    return NextResponse.json({
      checked: results.filter((result) => result.status === "checked").length,
      saved: results.reduce((total, result) => total + result.saved, 0),
      failed: results.filter((result) => result.status !== "checked").length,
      deferred: dueInstruments.length - batch.length,
      items: results,
    });
  } catch (error) {
    console.error("Błąd harmonogramu monitorowania:", error);
    return NextResponse.json(
      { error: "Nie udało się wykonać monitorowania." },
      { status: 500 },
    );
  }
}
