import {
  getResearchCutoff,
  type ResearchFeed,
  type ResearchItem,
} from "@/lib/research/google-news";

const youtubeSearchUrl = "https://www.googleapis.com/youtube/v3/search";
const requestTimeoutMs = 8_000;
const maxResponseBytes = 1_000_000;

type YouTubeSearchResponse = {
  items?: {
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      channelTitle?: string;
      publishedAt?: string;
    };
  }[];
};

export function isYouTubeConfigured(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY?.trim());
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export async function searchRecentYouTubeVideos(
  companyName: string,
  ticker: string,
  referenceDate = new Date(),
): Promise<ResearchFeed> {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    return { items: [], available: false, checkedAt: null };
  }

  const cutoff = getResearchCutoff(referenceDate);
  const url = new URL(youtubeSearchUrl);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "25");
  url.searchParams.set("order", "date");
  url.searchParams.set("regionCode", "PL");
  url.searchParams.set("relevanceLanguage", "pl");
  url.searchParams.set("publishedAfter", cutoff.toISOString());
  url.searchParams.set(
    "q",
    `"${companyName}" | "${ticker}" (raport | wyniki | omówienie | wiadomości)`,
  );

  try {
    const response = await fetch(url, {
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(requestTimeoutMs),
      next: { revalidate: 6 * 60 * 60 },
    });
    if (!response.ok) {
      console.error("YouTube search failed with status", response.status);
      return { items: [], available: false, checkedAt: null };
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
      return { items: [], available: false, checkedAt: null };
    }

    const data = (await response.json()) as YouTubeSearchResponse;
    const items = (data.items ?? []).flatMap((entry): ResearchItem[] => {
      const videoId = entry.id?.videoId;
      const title = entry.snippet?.title;
      const publishedAt = entry.snippet?.publishedAt;
      if (!videoId || !/^[\w-]{6,20}$/.test(videoId) || !title || !publishedAt) {
        return [];
      }
      const publishedDate = new Date(publishedAt);
      if (
        !Number.isFinite(publishedDate.getTime()) ||
        publishedDate < cutoff ||
        publishedDate > referenceDate
      ) {
        return [];
      }

      return [{
        title: decodeHtmlEntities(title),
        url: `https://www.youtube.com/watch?v=${videoId}`,
        source: `YouTube · ${decodeHtmlEntities(entry.snippet?.channelTitle ?? "kanał nieznany")}`,
        publishedAt: publishedDate.toISOString(),
        description: null,
      }];
    });

    return { items, available: true, checkedAt: new Date().toISOString() };
  } catch {
    return { items: [], available: false, checkedAt: null };
  }
}
