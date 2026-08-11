import type { ParsedLaunch } from './parseCreate.js';
import { classifyNarratives } from './classify.js';
import type { LaunchRecord } from './fetchLaunches.js';
import { ipfsGatewayUrls, normalizeMediaUrl } from './imageKey.js';

const cache = new Map<string, Partial<LaunchRecord>>();
const RETRY_MS = [200, 450, 900, 1600];

export type EnrichProgress = (partial: LaunchRecord) => void;

async function fetchJsonFromUrl(url: string): Promise<Partial<LaunchRecord> | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { name?: string; symbol?: string; image?: string };
    return {
      name: data.name,
      symbol: data.symbol,
      image: normalizeMediaUrl(data.image),
    };
  } catch {
    return null;
  }
}

async function fetchJsonMetadata(uri?: string): Promise<Partial<LaunchRecord>> {
  const urls = ipfsGatewayUrls(uri);
  if (!urls.length && uri) {
    const single = normalizeMediaUrl(uri);
    if (single) urls.push(single);
  }
  for (const url of urls) {
    const got = await fetchJsonFromUrl(url);
    if (got && (got.image || got.name || got.symbol)) return got;
  }
  return {};
}

function needsEnrichment(m: Partial<LaunchRecord>): boolean {
  return !m.image || !(m.name || m.symbol);
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
  };
}

/**
 * Live enrich: metadata URI only (name/image).
 * Tries multiple IPFS gateways — no pump.fun API.
 */
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
    if (!merged.image && !(merged.name || merged.symbol)) return;
    onProgress(toRecord(launch, merged));
  };

  if (launch.metadataUri) {
    merged = mergePreferExisting(merged, await fetchJsonMetadata(launch.metadataUri));
    emit();
  }

  for (let i = 0; i < RETRY_MS.length; i++) {
    if (!needsEnrichment(merged)) break;
    if (!launch.metadataUri) break;
    await sleep(RETRY_MS[i]!);
    merged = mergePreferExisting(merged, await fetchJsonMetadata(launch.metadataUri));
    emit();
  }

  // Prefer a stable https image URL for the UI (first gateway rewrite).
  if (merged.image) merged.image = normalizeMediaUrl(merged.image) ?? merged.image;

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
