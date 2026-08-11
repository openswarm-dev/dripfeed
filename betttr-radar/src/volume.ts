/** DexScreener volume / txn metrics for trend decay. */

export interface VolumeMetrics {
  volumeUsd24h?: number;
  volumeUsd1h?: number;
  volumeUsd6h?: number;
  txns24h?: number;
  buys24h?: number;
  sells24h?: number;
  priceChange1h?: number;
  volumeUpdatedAt: number;
}

const cache = new Map<string, { at: number; metrics: VolumeMetrics }>();
const history = new Map<string, Array<{ at: number; volumeUsd24h: number; volumeUsd1h: number }>>();
const CACHE_MS = 45_000;

export async function fetchVolumeMetrics(mint: string): Promise<VolumeMetrics | null> {
  const cached = cache.get(mint);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.metrics;

  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return cached?.metrics ?? null;

    const data = (await res.json()) as { pairs?: Array<any> };
    const pair = data.pairs?.find((p) => p.chainId === 'solana') ?? data.pairs?.[0];
    if (!pair) return cached?.metrics ?? null;

    const now = Math.floor(Date.now() / 1000);
    const metrics: VolumeMetrics = {
      volumeUsd24h: pair.volume?.h24 ?? pair.volume?.h6,
      volumeUsd1h: pair.volume?.h1,
      volumeUsd6h: pair.volume?.h6,
      txns24h: (pair.txns?.h24?.buys ?? 0) + (pair.txns?.h24?.sells ?? 0),
      buys24h: pair.txns?.h24?.buys,
      sells24h: pair.txns?.h24?.sells,
      priceChange1h: pair.priceChange?.h1,
      volumeUpdatedAt: now,
    };

    cache.set(mint, { at: Date.now(), metrics });
    recordVolumeHistory(mint, metrics);
    return metrics;
  } catch {
    return cached?.metrics ?? null;
  }
}

function recordVolumeHistory(mint: string, m: VolumeMetrics) {
  const vol24 = m.volumeUsd24h ?? 0;
  const vol1 = m.volumeUsd1h ?? 0;
  const list = history.get(mint) ?? [];
  const last = list[list.length - 1];
  if (last && last.volumeUsd24h === vol24 && last.volumeUsd1h === vol1) return;

  list.push({ at: m.volumeUpdatedAt, volumeUsd24h: vol24, volumeUsd1h: vol1 });
  if (list.length > 24) list.shift();
  history.set(mint, list);
}

/** Volume decay 0 (hot) → 1 (dead) from 1h vs 24h hourly average. */
export function volumeDecayScore(volumeUsd24h: number, volumeUsd1h: number): number {
  if (volumeUsd24h <= 0) return volumeUsd1h > 0 ? 0 : 0.5;
  const avgHourly = volumeUsd24h / 24;
  if (avgHourly <= 0) return 0.5;
  const ratio = volumeUsd1h / avgHourly;
  return Math.max(0, Math.min(1, 1 - ratio));
}

export async function refreshVolumesForMints(
  mints: string[],
  concurrency = 4,
): Promise<Map<string, VolumeMetrics>> {
  const out = new Map<string, VolumeMetrics>();
  for (let i = 0; i < mints.length; i += concurrency) {
    const batch = mints.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (mint) => {
        const m = await fetchVolumeMetrics(mint);
        return m ? ([mint, m] as const) : null;
      }),
    );
    for (const r of results) {
      if (r) out.set(r[0], r[1]);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return out;
}
