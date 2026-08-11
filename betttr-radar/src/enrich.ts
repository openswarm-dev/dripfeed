import type { ParsedLaunch } from './parseCreate.js';
import { classifyNarratives } from './classify.js';
import type { LaunchRecord } from './fetchLaunches.js';
import { fetchVolumeMetrics } from './volume.js';
import { normalizeMediaUrl } from './imageKey.js';

const cache = new Map<string, Partial<LaunchRecord>>();
const RETRY_MS = [300, 600, 1200, 2000, 3500];

async function fetchJsonMetadata(uri?: string): Promise<Partial<LaunchRecord>> {
  const url = normalizeMediaUrl(uri);
  if (!url) return {};
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return {};
    const data = (await res.json()) as { name?: string; symbol?: string; image?: string };
    return {
      name: data.name,
      symbol: data.symbol,
      image: normalizeMediaUrl(data.image),
    };
  } catch {
    return {};
  }
}

async function fetchPumpFun(mint: string): Promise<Partial<LaunchRecord>> {
  try {
    const res = await fetch(`https://frontend-api.pump.fun/coins/${mint}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return {};
    const data = (await res.json()) as {
      name?: string;
      symbol?: string;
      description?: string;
      image_uri?: string;
      usd_market_cap?: number;
    };
    return {
      name: data.name,
      symbol: data.symbol,
      description: data.description,
      image: normalizeMediaUrl(data.image_uri),
      marketCapUsd: data.usd_market_cap,
    };
  } catch {
    return {};
  }
}

async function fetchDexScreener(mint: string): Promise<Partial<LaunchRecord>> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return {};
    const data = (await res.json()) as { pairs?: Array<any> };
    const pair = data.pairs?.find((p) => p.chainId === 'solana') ?? data.pairs?.[0];
    if (!pair) return {};

    return {
      name: pair.baseToken?.name,
      symbol: pair.baseToken?.symbol,
      description: pair.info?.socials ? undefined : pair.info?.description,
      image: normalizeMediaUrl(pair.info?.imageUrl),
      marketCapUsd: pair.marketCap ?? pair.fdv,
      volumeUsd24h: pair.volume?.h24,
      volumeUsd1h: pair.volume?.h1,
      txns24h: (pair.txns?.h24?.buys ?? 0) + (pair.txns?.h24?.sells ?? 0),
      volumeUpdatedAt: Math.floor(Date.now() / 1000),
    };
  } catch {
    return {};
  }
}

function needsEnrichment(m: Partial<LaunchRecord>): boolean {
  return !m.image || !(m.name || m.symbol);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Live path: pump.fun + metadata URI first, with retries until name/image land. */
export async function enrichLaunchLive(launch: ParsedLaunch): Promise<LaunchRecord> {
  let merged: Partial<LaunchRecord> = {
    name: launch.name,
    symbol: launch.symbol,
    image: launch.image,
  };

  if (launch.metadataUri) {
    merged = { ...merged, ...(await fetchJsonMetadata(launch.metadataUri)) };
  }

  for (let i = 0; i < RETRY_MS.length; i++) {
    if (!needsEnrichment(merged)) break;

    const pump = await fetchPumpFun(launch.mint);
    merged = {
      ...merged,
      ...pump,
      name: merged.name ?? pump.name,
      symbol: merged.symbol ?? pump.symbol,
      image: merged.image ?? pump.image,
    };

    if (!merged.image && launch.metadataUri) {
      const meta = await fetchJsonMetadata(launch.metadataUri);
      merged = {
        ...merged,
        ...meta,
        name: merged.name ?? meta.name,
        symbol: merged.symbol ?? meta.symbol,
        image: merged.image ?? meta.image,
      };
    }

    if (!needsEnrichment(merged)) break;
    await sleep(RETRY_MS[i]!);
  }

  if (!merged.image || !merged.name) {
    const dex = await fetchDexScreener(launch.mint);
    merged = { ...dex, ...merged, image: merged.image ?? dex.image };
  }

  const vol = await fetchVolumeMetrics(launch.mint);
  if (vol) {
    merged = {
      ...merged,
      volumeUsd24h: vol.volumeUsd24h ?? merged.volumeUsd24h,
      volumeUsd1h: vol.volumeUsd1h ?? merged.volumeUsd1h,
      txns24h: vol.txns24h ?? merged.txns24h,
      volumeUpdatedAt: vol.volumeUpdatedAt,
    };
  }

  const classification = classifyNarratives({
    name: merged.name ?? launch.name,
    symbol: merged.symbol ?? launch.symbol,
    description: merged.description,
    mint: launch.mint,
  });

  const record: LaunchRecord = {
    ...launch,
    ...merged,
    name: merged.name ?? launch.name,
    symbol: merged.symbol ?? launch.symbol,
    image: merged.image ?? launch.image,
    narratives: classification.narratives,
    primaryNarrative: classification.primaryNarrative,
    narrativeScore: classification.narrativeScore,
  };

  cache.set(launch.mint, record);
  return record;
}

export async function enrichLaunch(launch: ParsedLaunch): Promise<LaunchRecord> {
  const cached = cache.get(launch.mint);
  if (cached?.name && cached?.image) {
    return { ...launch, ...cached } as LaunchRecord;
  }

  return enrichLaunchLive(launch);
}

export async function enrichLaunches(
  launches: ParsedLaunch[],
  concurrency: number,
  onProgress?: (done: number, total: number) => void,
): Promise<LaunchRecord[]> {
  const out: LaunchRecord[] = [];
  let done = 0;

  for (let i = 0; i < launches.length; i += concurrency) {
    const batch = launches.slice(i, i + concurrency);
    const enriched = await Promise.all(
      batch.map(async (l) => {
        const r = await enrichLaunch(l);
        done++;
        onProgress?.(done, launches.length);
        return r;
      }),
    );
    out.push(...enriched);
    await new Promise((r) => setTimeout(r, 250));
  }

  return out;
}
