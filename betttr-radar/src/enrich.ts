import type { ParsedLaunch } from './parseCreate.js';
import { classifyNarratives } from './classify.js';
import type { LaunchRecord } from './fetchLaunches.js';
import { fetchVolumeMetrics } from './volume.js';
import { normalizeMediaUrl } from './imageKey.js';
import { fetchPumpCoin } from './market.js';

const cache = new Map<string, Partial<LaunchRecord>>();
const RETRY_MS = [200, 450, 900, 1600, 2800];

export type EnrichProgress = (partial: LaunchRecord) => void;

async function fetchJsonMetadata(uri?: string): Promise<Partial<LaunchRecord>> {
  const url = normalizeMediaUrl(uri);
  if (!url) return {};
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3500),
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
  const data = await fetchPumpCoin(mint);
  if (!data) return {};
  return {
    name: data.name,
    symbol: data.symbol,
    description: data.description,
    image: normalizeMediaUrl(data.image),
    marketCapUsd: data.marketCapUsd,
    bonded: data.bonded,
    holderCount: data.holderCount,
    bondingProgressPct: data.bondingProgressPct,
    marketUpdatedAt: data.updatedAt,
  };
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
      txns24h:
        pair.txns?.h24?.buys != null || pair.txns?.h24?.sells != null
          ? (pair.txns?.h24?.buys ?? 0) + (pair.txns?.h24?.sells ?? 0)
          : undefined,
      volumeUpdatedAt: Math.floor(Date.now() / 1000),
    };
  } catch {
    return {};
  }
}

function needsEnrichment(m: Partial<LaunchRecord>): boolean {
  return !m.image || !(m.name || m.symbol) || m.marketCapUsd == null || m.holderCount == null;
}

function hasUsefulVisual(m: Partial<LaunchRecord>): boolean {
  return !!(m.image && (m.name || m.symbol));
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function toRecord(launch: ParsedLaunch, merged: Partial<LaunchRecord>): LaunchRecord {
  const classification = classifyNarratives({
    name: merged.name ?? launch.name,
    symbol: merged.symbol ?? launch.symbol,
    description: merged.description,
    mint: launch.mint,
  });

  return {
    ...launch,
    ...merged,
    name: merged.name ?? launch.name,
    symbol: merged.symbol ?? launch.symbol,
    image: merged.image ?? launch.image,
    narratives: classification.narratives,
    primaryNarrative: classification.primaryNarrative,
    narrativeScore: classification.narrativeScore,
  };
}

function mergePreferExisting(
  base: Partial<LaunchRecord>,
  next: Partial<LaunchRecord>,
): Partial<LaunchRecord> {
  return {
    ...base,
    ...next,
    name: base.name ?? next.name,
    symbol: base.symbol ?? next.symbol,
    image: base.image ?? next.image,
    description: base.description ?? next.description,
    marketCapUsd: next.marketCapUsd ?? base.marketCapUsd,
    volumeUsd1h: next.volumeUsd1h ?? base.volumeUsd1h,
    volumeUsd24h: next.volumeUsd24h ?? base.volumeUsd24h,
    txns24h: next.txns24h ?? base.txns24h,
    holderCount: next.holderCount ?? base.holderCount,
    bonded: next.bonded ?? base.bonded,
    bondingProgressPct: next.bondingProgressPct ?? base.bondingProgressPct,
    marketUpdatedAt: next.marketUpdatedAt ?? base.marketUpdatedAt,
    volumeUpdatedAt: next.volumeUpdatedAt ?? base.volumeUpdatedAt,
  };
}

/** Live path: pump.fun + metadata URI in parallel, progressive updates as soon as image lands. */
export async function enrichLaunchLive(
  launch: ParsedLaunch,
  onProgress?: EnrichProgress,
): Promise<LaunchRecord> {
  let merged: Partial<LaunchRecord> = {
    name: launch.name,
    symbol: launch.symbol,
    image: launch.image,
  };

  const emit = () => {
    if (!onProgress) return;
    if (!merged.image && !(merged.name || merged.symbol) && merged.marketCapUsd == null) return;
    onProgress(toRecord(launch, merged));
  };

  // First wave: metadata URI + pump.fun API in parallel (don't wait serially).
  const [metaFirst, pumpFirst] = await Promise.all([
    launch.metadataUri ? fetchJsonMetadata(launch.metadataUri) : Promise.resolve({}),
    fetchPumpFun(launch.mint),
  ]);
  merged = mergePreferExisting(merged, metaFirst);
  merged = mergePreferExisting(merged, pumpFirst);
  emit();

  for (let i = 0; i < RETRY_MS.length; i++) {
    if (!needsEnrichment(merged)) break;
    await sleep(RETRY_MS[i]!);

    const [pump, meta] = await Promise.all([
      fetchPumpFun(launch.mint),
      launch.metadataUri ? fetchJsonMetadata(launch.metadataUri) : Promise.resolve({}),
    ]);
    merged = mergePreferExisting(merged, pump);
    merged = mergePreferExisting(merged, meta);
    emit();
  }

  if (!merged.image || !merged.name) {
    const dex = await fetchDexScreener(launch.mint);
    merged = mergePreferExisting(merged, dex);
    emit();
  }

  // Always pull volumes — don't skip just because the visual landed.
  const vol = await fetchVolumeMetrics(launch.mint);
  if (vol) {
    merged = {
      ...merged,
      volumeUsd24h: vol.volumeUsd24h ?? merged.volumeUsd24h,
      volumeUsd1h: vol.volumeUsd1h ?? merged.volumeUsd1h,
      txns24h: vol.txns24h ?? merged.txns24h,
      volumeUpdatedAt: vol.volumeUpdatedAt,
    };
    emit();
  }

  // One more pump pass for holders/mcap if still empty.
  if (merged.marketCapUsd == null || merged.holderCount == null) {
    const pumpAgain = await fetchPumpFun(launch.mint);
    merged = mergePreferExisting(merged, pumpAgain);
    emit();
  }

  const record = toRecord(launch, merged);
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

export { hasUsefulVisual };
