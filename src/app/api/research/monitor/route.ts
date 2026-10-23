import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { monitorInstrument } from "@/lib/research/monitoring";

const contentKinds = ["news", "report", "analyst", "video", "schedule"] as const;
type ContentKind = (typeof contentKinds)[number];

async function getAuthorizedClient() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError && !isAuthSessionMissingError(authError)) {
    throw authError;
  }
  if (!user) {
    return {
      supabase,
      response: NextResponse.json({ error: "Wymagane logowanie." }, { status: 401 }),
    };
  }

  const { data: hasActiveAccess, error: accessError } = await supabase.rpc(
    "has_active_access",
  );
  if (accessError) {
    throw accessError;
  }
  if (!hasActiveAccess) {
    return {
      supabase,
      response: NextResponse.json({ error: "Brak aktywnego dostępu." }, { status: 403 }),
    };
  }

  return { supabase, response: null };
}

function isContentKind(value: string): value is ContentKind {
  return contentKinds.includes(value as ContentKind);
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorizedClient();
    if (auth.response) {
      return auth.response;
    }

    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Nieprawidłowe dane żądania." }, { status: 400 });
    }

    const { ticker, companyName, limit: requestedLimit } = body as {
      ticker?: unknown;
      companyName?: unknown;
      limit?: unknown;
    };
    const normalizedTicker =
      typeof ticker === "string" && ticker.trim() ? ticker.trim().toUpperCase() : null;
    const normalizedCompanyName =
      typeof companyName === "string" && companyName.trim()
        ? companyName.trim()
        : null;
    const limit = requestedLimit === undefined ? 50 : requestedLimit;

    if (!normalizedTicker && !normalizedCompanyName) {
      return NextResponse.json(
        { error: "Wymagany ticker lub nazwa spółki." },
        { status: 400 },
      );
    }
    if (
      (normalizedTicker !== null && normalizedTicker.length > 20) ||
      (normalizedCompanyName !== null && normalizedCompanyName.length > 200) ||
      typeof limit !== "number" ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 60
    ) {
      return NextResponse.json({ error: "Nieprawidłowe parametry żądania." }, { status: 400 });
    }

    let instrumentQuery = auth.supabase
      .from("instrument_catalog")
      .select("id, ticker, company_name");
    if (normalizedTicker) {
      instrumentQuery = instrumentQuery.eq("ticker", normalizedTicker);
    } else {
      instrumentQuery = instrumentQuery.eq("company_name", normalizedCompanyName!);
    }
    const { data: instrument, error: instrumentError } =
      await instrumentQuery.maybeSingle();
    if (instrumentError) {
      throw instrumentError;
    }
    if (!instrument) {
      return NextResponse.json({ error: "Spółka nie została znaleziona." }, { status: 404 });
    }

    const result = await monitorInstrument(instrument, limit);
    if (!result.available) {
      return NextResponse.json(
        { error: "Nie udało się pobrać Google News RSS. Spróbuj ponownie później." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ...result,
      ticker: instrument.ticker,
    });
  } catch (error) {
    console.error("Błąd monitorowania RSS:", error);
    return NextResponse.json(
      { error: "Nie udało się przeprowadzić monitorowania." },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthorizedClient();
    if (auth.response) {
      return auth.response;
    }

    const searchParams = request.nextUrl.searchParams;
    const ticker = searchParams.get("ticker")?.trim().toUpperCase();
    const kind = searchParams.get("kind") ?? "news";
    const rawLimit = searchParams.get("limit") ?? "20";
    const limit = Number(rawLimit);

    if (!ticker || ticker.length > 20 || !isContentKind(kind)) {
      return NextResponse.json({ error: "Nieprawidłowy ticker lub rodzaj treści." }, { status: 400 });
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return NextResponse.json({ error: "Limit musi być liczbą całkowitą od 1 do 100." }, { status: 400 });
    }

    const { data: instrument, error: instrumentError } = await auth.supabase
      .from("instrument_catalog")
      .select("id, ticker")
      .eq("ticker", ticker)
      .maybeSingle();
    if (instrumentError) {
      throw instrumentError;
    }
    if (!instrument) {
      return NextResponse.json({ error: "Spółka nie została znaleziona." }, { status: 404 });
    }

    const [{ data: items, error: itemsError }, { data: state, error: stateError }] =
      await Promise.all([
        auth.supabase
          .from("monitored_research_items")
          .select("id, title, url, source, description, published_at, discovered_at, content_kind, is_reviewed")
          .eq("instrument_id", instrument.id)
          .eq("content_kind", kind)
          .order("published_at", { ascending: false })
          .order("discovered_at", { ascending: false })
          .limit(limit),
        auth.supabase
          .from("research_monitor_state")
          .select("last_checked_at, last_successful_check_at")
          .eq("instrument_id", instrument.id)
          .maybeSingle(),
      ]);
    if (itemsError) {
      throw itemsError;
    }
    if (stateError) {
      throw stateError;
    }

    return NextResponse.json({
      ticker: instrument.ticker,
      items,
      unreviewed: items.filter((item) => !item.is_reviewed).length,
      total: items.length,
      state,
    });
  } catch (error) {
    console.error("Błąd pobierania monitorowanych artykułów:", error);
    return NextResponse.json(
      { error: "Nie udało się pobrać monitorowanych artykułów." },
      { status: 500 },
    );
  }
}
