export type ResearchItem = {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  description: string | null;
};

export type ResearchFeed = {
  items: ResearchItem[];
  available: boolean;
  checkedAt: string | null;
};

function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pl-PL");
}

export function isRelevantCompanyTitle(
  title: string,
  companyName: string,
  ticker: string,
): boolean {
  const normalizedTitle = normalizeText(title);
  const titleWords = new Set(normalizedTitle.split(/[^a-z0-9]+/).filter(Boolean));
  const companyWords = normalizeText(companyName)
    .split(/[^a-z0-9]+/)
    .filter((word) =>
      word.length >= 2 &&
      !["spolka", "akcyjna", "grupa", "holding", "holdings", "group", "sa", "the"].includes(word),
    );
  if (titleWords.has(normalizeText(ticker))) {
    return true;
  }

  const matchingCompanyWords = companyWords.filter((word) => titleWords.has(word));
  if (companyWords.length > 1) {
    return matchingCompanyWords.length === companyWords.length;
  }
  if (matchingCompanyWords.length === 0) {
    return false;
  }

  return [
    "akcj", "raport", "wynik", "spolk", "emitent", "dywidend", "inwest",
    "finans", "gpw", "windyk", "portfel", "dlug", "wplat", "zadluz",
    "rekomend", "anality", "kontrakt", "strateg", "emisj", "przejec",
    "prognoz", "zysk", "strat",
  ].some((word) => normalizedTitle.includes(word));
}

const googleNewsRss = "https://news.google.com/rss/search";
const maxFeedBytes = 1_000_000;
const feedTimeoutMs = 8_000;

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function readTag(xml: string, tagName: string): string | null {
  const match = xml.match(
    new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i"),
  );
  return match ? decodeXml(match[1]).trim() : null;
}

export function getResearchCutoff(referenceDate: Date): Date {
  const cutoff = new Date(referenceDate);
  const day = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 6);
  const lastDayOfMonth = new Date(
    Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0),
  ).getUTCDate();
  cutoff.setUTCDate(Math.min(day, lastDayOfMonth));
  return cutoff;
}

export async function searchRecentGoogleNews(
  query: string,
  referenceDate = new Date(),
): Promise<ResearchFeed> {
  const cutoff = getResearchCutoff(referenceDate);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const url = new URL(googleNewsRss);
  url.searchParams.set("q", `${query} after:${cutoffDate}`);
  url.searchParams.set("hl", "pl");
  url.searchParams.set("gl", "PL");
  url.searchParams.set("ceid", "PL:pl");

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/rss+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(feedTimeoutMs),
    });
    if (!response.ok) {
      return { items: [], available: false, checkedAt: null };
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxFeedBytes) {
      return { items: [], available: false, checkedAt: null };
    }

    const xml = await response.text();
    if (xml.length > maxFeedBytes || !xml.includes("<rss")) {
      return { items: [], available: false, checkedAt: null };
    }

    const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
      .flatMap(([, itemXml]) => {
        const title = readTag(itemXml, "title");
        const link = readTag(itemXml, "link");
        const source = readTag(itemXml, "source");
        const publishedAt = readTag(itemXml, "pubDate");
        const rawDescription = readTag(itemXml, "description");
        if (!title || !link || !publishedAt) {
          return [];
        }

        const parsedUrl = new URL(link);
        const publishedDate = new Date(publishedAt);
        if (
          parsedUrl.protocol !== "https:" ||
          parsedUrl.hostname !== "news.google.com" ||
          parsedUrl.username ||
          parsedUrl.password ||
          !Number.isFinite(publishedDate.getTime()) ||
          publishedDate < cutoff ||
          publishedDate > referenceDate
        ) {
          return [];
        }

        return [{
          title,
          url: parsedUrl.toString(),
          source: source || parsedUrl.hostname,
          publishedAt: publishedDate.toISOString(),
          description: rawDescription
            ? rawDescription.replace(/\s+/g, " ").trim().slice(0, 500) || null
            : null,
        }];
      })
      .slice(0, 30);

    return { items, available: true, checkedAt: new Date().toISOString() };
  } catch {
    return { items: [], available: false, checkedAt: null };
  }
}

export async function searchRecentGoogleNewsVariants(
  queries: string[],
  referenceDate = new Date(),
): Promise<ResearchFeed> {
  const feeds = await Promise.all(
    [...new Set(queries.map((query) => query.trim()).filter(Boolean))]
      .map((query) => searchRecentGoogleNews(query, referenceDate)),
  );
  const availableFeeds = feeds.filter((feed) => feed.available);
  if (availableFeeds.length === 0) {
    return { items: [], available: false, checkedAt: null };
  }

  const byUrl = new Map<string, ResearchItem>();
  for (const feed of availableFeeds) {
    for (const item of feed.items) {
      const existing = byUrl.get(item.url);
      if (!existing || (existing.description === null && item.description !== null)) {
        byUrl.set(item.url, item);
      }
    }
  }

  return {
    items: [...byUrl.values()]
      .sort((left, right) =>
        new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime(),
      )
      .slice(0, 60),
    available: true,
    checkedAt: availableFeeds
      .map((feed) => feed.checkedAt)
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null,
  };
}
