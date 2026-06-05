import { logger } from "./logger.js";

const MAX_PAGES_PER_SEA = 5;
const PAGE_DELAY_MS_NO_COOKIE = 10_000;
const PAGE_DELAY_MS_WITH_COOKIE = 3_000;

const BACKOFF_DELAYS_MS = [90_000, 180_000, 270_000];

export interface RobloxServer {
  id: string;
  maxPlayers: number;
  playing: number;
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json",
  };
  const cookie = process.env["ROBLOX_COOKIE"]?.trim();
  if (cookie) {
    headers["Cookie"] = `.ROBLOSECURITY=${cookie}`;
  } else {
    logger.warn(
      "ROBLOX_COOKIE not set — running unauthenticated (higher rate limit risk)",
    );
  }
  return headers;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPageWithRetry(
  url: string,
  attempt: number = 0,
): Promise<Response> {
  const res = await fetch(url, { headers: buildHeaders() });

  if (res.status === 429) {
    if (attempt >= BACKOFF_DELAYS_MS.length) {
      throw new Error(`Roblox API 429 after ${attempt + 1} attempts — giving up`);
    }
    const delay = BACKOFF_DELAYS_MS[attempt]!;
    logger.warn(
      { attempt, delayMs: delay },
      `Roblox 429 — backing off ${delay / 1000}s`,
    );
    await sleep(delay);
    return fetchPageWithRetry(url, attempt + 1);
  }

  return res;
}

export async function fetchAllServers(placeId: string): Promise<RobloxServer[]> {
  const hasCookie = !!process.env["ROBLOX_COOKIE"]?.trim();
  const pageDelay = hasCookie ? PAGE_DELAY_MS_WITH_COOKIE : PAGE_DELAY_MS_NO_COOKIE;

  const servers: RobloxServer[] = [];
  let cursor: string | null = null;
  let pagesFetched = 0;

  while (pagesFetched < MAX_PAGES_PER_SEA) {
    const url = cursor
      ? `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100&cursor=${encodeURIComponent(cursor)}`
      : `https://games.roblox.com/v1/games/${placeId}/servers/Public?limit=100`;

    let res: Response;
    try {
      res = await fetchPageWithRetry(url);
    } catch (err) {
      logger.error({ err, placeId, page: pagesFetched }, "Failed to fetch Roblox page");
      break;
    }

    if (!res.ok) {
      logger.error(
        { status: res.status, placeId, page: pagesFetched },
        "Roblox API returned non-ok status",
      );
      break;
    }

    const data = (await res.json()) as {
      data: { id: string; maxPlayers: number; playing: number }[];
      nextPageCursor?: string | null;
    };

    for (const s of data.data ?? []) {
      servers.push({ id: s.id, maxPlayers: s.maxPlayers, playing: s.playing });
    }

    pagesFetched++;
    cursor = data.nextPageCursor ?? null;

    if (!cursor) break;

    if (pagesFetched < MAX_PAGES_PER_SEA) {
      await sleep(pageDelay);
    }
  }

  logger.info({ placeId, pages: pagesFetched, total: servers.length }, "Fetched servers");
  return servers;
}
