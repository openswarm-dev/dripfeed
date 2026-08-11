/** Live pump.fun market metrics (polled — Geyser only streams creates, not ongoing trades). */

export interface PumpCoinData {
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
  marketCapUsd?: number;
  bonded?: boolean;
  holderCount?: number;
  replyCount?: number;
  bondingProgressPct?: number;
  updatedAt: number;
}

/** Identity-only recent create (for gap-fill — not metrics). */
export interface PumpRecentCreate {
  mint: string;
  name?: string;
  symbol?: string;
  image?: string;
  metadataUri?: string;
  creator?: string;
  createdAt: number;
}

const GRADUATION_MCAP_USD = 69_000;
const cache = new Map<string, { at: number; data: PumpCoinData }>();
const CACHE_MS = 3_000;

export async function fetchPumpCoin(mint: string): Promise<PumpCoinData | null> {
  const cached = cache.get(mint);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.data;

  try {
    const res = await fetch(`https://frontend-api-v3.pump.fun/coins/${mint}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; BetttrRadar/1.0)',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return cached?.data ?? null;

    const data = (await res.json()) as {
      name?: string;
      symbol?: string;
      description?: string;
      image_uri?: string;
      usd_market_cap?: number;
      market_cap_usd?: number;
      complete?: boolean;
      reply_count?: number;
      holder_count?: number;
      holders_count?: number;
      holderCount?: number;
    };

    const marketCapUsd = data.market_cap_usd ?? data.usd_market_cap;
    const bonded = data.complete === true;
    const bondingProgressPct = bonded
      ? 100
      : marketCapUsd != null
        ? Math.min(99, Math.round((marketCapUsd / GRADUATION_MCAP_USD) * 100))
        : undefined;

    const coin: PumpCoinData = {
      name: data.name,
      symbol: data.symbol,
      description: data.description,
      image: data.image_uri,
      marketCapUsd,
      bonded,
      holderCount: data.holder_count ?? data.holders_count ?? data.holderCount,
      replyCount: data.reply_count,
      bondingProgressPct,
      updatedAt: Math.floor(Date.now() / 1000),
    };

    cache.set(mint, { at: Date.now(), data: coin });
    return coin;
  } catch {
    return cached?.data ?? null;
  }
}

export async function refreshPumpCoinsForMints(
  mints: string[],
  concurrency = 6,
): Promise<Map<string, PumpCoinData>> {
  const out = new Map<string, PumpCoinData>();
  for (let i = 0; i < mints.length; i += concurrency) {
    const batch = mints.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (mint) => {
        const m = await fetchPumpCoin(mint);
        return m ? ([mint, m] as const) : null;
      }),
    );
    for (const r of results) {
      if (r) out.set(r[0], r[1]);
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  return out;
}

/**
 * One list call for newest creates — identity only (name/symbol/image).
 * Used to gap-fill ERPC misses without per-mint metrics hammering.
 */
export async function fetchRecentPumpCreates(limit = 50): Promise<PumpRecentCreate[]> {
  try {
    const url =
      `https://frontend-api-v3.pump.fun/coins?offset=0&limit=${limit}` +
      `&sort=created_timestamp&order=DESC&includeNsfw=true`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; BetttrRadar/1.0)',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{
      mint?: string;
      name?: string;
      symbol?: string;
      image_uri?: string;
      metadata_uri?: string;
      creator?: string;
      created_timestamp?: number;
    }>;
    if (!Array.isArray(data)) return [];
    return data
      .filter((c) => typeof c.mint === 'string' && c.mint.length >= 32)
      .map((c) => {
        let createdAt = Number(c.created_timestamp ?? 0);
        if (createdAt > 1e12) createdAt = Math.floor(createdAt / 1000);
        return {
          mint: c.mint!,
          name: c.name,
          symbol: c.symbol,
          image: c.image_uri,
          metadataUri: c.metadata_uri,
          creator: c.creator,
          createdAt,
        };
      });
  } catch {
    return [];
  }
}
