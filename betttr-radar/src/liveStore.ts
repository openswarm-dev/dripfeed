import type { LaunchRecord } from './fetchLaunches.js';
import { analyzeMetas, type MetaDashboard } from './metaEngine.js';
import { loadLatestReport } from './report.js';
import type { SocialSpark } from './socialSpark.js';
import { refreshVolumesForMints, fetchVolumeMetrics } from './volume.js';
import { refreshPumpCoinsForMints, fetchPumpCoin } from './market.js';
import { hydrateFromDb, initPersist, loadPersistedState, schedulePersist } from './persist.js';
import { normalizeMediaUrl } from './imageKey.js';

export interface FeedStatus {
  geyser: boolean;
  tweetstream: boolean;
  tweetstreamAccounts: string[];
}

export interface GeyserStats {
  pumpTxSeen: number;
  createsParsed: number;
  createsStored: number;
  perMinute: number;
}

export interface LiveState {
  connected: boolean;
  feeds: FeedStatus;
  geyserStats: GeyserStats;
  liveLaunches: number;
  liveSparks: number;
  lastLaunchAt: string | null;
  lastSparkAt: string | null;
  metas: MetaDashboard;
  launches: LaunchRecord[];
  sparks: SocialSpark[];
}

type SseClient = (data: string) => void;

const clients = new Set<SseClient>();
let state: LiveState | null = null;
let geyserConnected = false;
let tweetstreamConnected = false;
let geyserStats: GeyserStats = {
  pumpTxSeen: 0,
  createsParsed: 0,
  createsStored: 0,
  perMinute: 0,
};
const recentCreateTimes: number[] = [];

function mergeLaunches(existing: LaunchRecord[], incoming: LaunchRecord[]): LaunchRecord[] {
  const byMint = new Map<string, LaunchRecord>();
  for (const l of incoming) byMint.set(l.mint, l);
  for (const l of existing) {
    const prev = byMint.get(l.mint);
    byMint.set(l.mint, prev ? mergeLaunchRecord(prev, l) : l);
  }
  return [...byMint.values()]
    .sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0))
    .slice(0, 5000);
}

/** Prefer newer fields, but never let empty/zero polls wipe known-good metrics. */
function keepMetric(next: number | undefined, prev: number | undefined): number | undefined {
  if (next == null) return prev;
  if (next <= 0 && prev != null && prev > 0) return prev;
  return next;
}

function mergeLaunchRecord(prev: LaunchRecord, next: LaunchRecord): LaunchRecord {
  return {
    ...prev,
    ...next,
    name: next.name ?? prev.name,
    symbol: next.symbol ?? prev.symbol,
    image: next.image ?? prev.image,
    description: next.description ?? prev.description,
    marketCapUsd: keepMetric(next.marketCapUsd, prev.marketCapUsd),
    volumeUsd24h: keepMetric(next.volumeUsd24h, prev.volumeUsd24h),
    volumeUsd1h: keepMetric(next.volumeUsd1h, prev.volumeUsd1h),
    txns24h: keepMetric(next.txns24h, prev.txns24h),
    holderCount: keepMetric(next.holderCount, prev.holderCount),
    bondingProgressPct: next.bondingProgressPct ?? prev.bondingProgressPct,
    bonded: next.bonded ?? prev.bonded,
    volumeUpdatedAt: next.volumeUpdatedAt ?? prev.volumeUpdatedAt,
    marketUpdatedAt: next.marketUpdatedAt ?? prev.marketUpdatedAt,
  };
}

function persistCurrent() {
  if (!state) return;
  schedulePersist(state.launches, state.sparks, state.liveLaunches);
}

function buildState(
  launches: LaunchRecord[],
  sparks: SocialSpark[],
  liveLaunchCount = 0,
): LiveState {
  const metas = analyzeMetas(launches, 4, sparks, { live: true });
  const lastLaunch = launches
    .filter((l) => l.blockTime)
    .sort((a, b) => b.blockTime! - a.blockTime!)[0];
  const lastSpark = sparks[0];

  const now = Date.now();
  while (recentCreateTimes.length && recentCreateTimes[0]! < now - 60_000) {
    recentCreateTimes.shift();
  }
  geyserStats.perMinute = recentCreateTimes.length;

  return {
    connected: geyserConnected || tweetstreamConnected,
    feeds: {
      geyser: geyserConnected,
      tweetstream: tweetstreamConnected,
      tweetstreamAccounts: state?.feeds.tweetstreamAccounts ?? [],
    },
    geyserStats: { ...geyserStats },
    liveLaunches: liveLaunchCount,
    liveSparks: sparks.filter((s) => s.receivedAt > Math.floor(Date.now() / 1000) - 86400).length,
    lastLaunchAt: lastLaunch?.blockTime
      ? new Date(lastLaunch.blockTime * 1000).toISOString()
      : null,
    lastSparkAt: lastSpark
      ? new Date(lastSpark.receivedAt * 1000).toISOString()
      : null,
    metas,
    launches,
    sparks: sparks.slice(0, 100),
  };
}

function rebroadcast() {
  if (!state) return;
  broadcast('refresh', {
    metas: state.metas,
    sparks: state.sparks,
    launches: state.launches.slice(0, 200),
    geyserStats: state.geyserStats,
    liveLaunches: state.liveLaunches,
  });
}

export function initFromReport(): LiveState {
  const persisted = loadPersistedState();
  const report = loadLatestReport();
  const reportLaunches = report?.launches ?? [];
  const launches = persisted
    ? mergeLaunches(persisted.launches, reportLaunches)
    : reportLaunches;
  const sparks = persisted?.sparks ?? [];
  state = buildState(launches, sparks, persisted?.liveLaunches ?? 0);
  return state;
}

/** Connect Postgres + prefer hydrated launches over file when available. */
export async function initLiveStore(): Promise<LiveState> {
  await initPersist();
  const current = initFromReport();
  const fromDb = await hydrateFromDb();
  if (!fromDb?.launches.length) return current;

  const launches = mergeLaunches(current.launches, fromDb.launches);
  const sparkMap = new Map<string, SocialSpark>();
  for (const s of fromDb.sparks) sparkMap.set(s.id, s);
  for (const s of current.sparks) sparkMap.set(s.id, s);
  const sparks = [...sparkMap.values()]
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .slice(0, 200);
  state = buildState(
    launches,
    sparks,
    Math.max(current.liveLaunches, fromDb.liveLaunches),
  );
  return state;
}

/** On-demand pump.fun + DexScreener refresh for hover panels. */
export async function forceRefreshLaunch(mint: string): Promise<LaunchRecord | null> {
  const current = getState();
  const existing = current.launches.find((l) => l.mint === mint);
  if (!existing) return null;

  const [pump, vol] = await Promise.all([
    fetchPumpCoin(mint),
    fetchVolumeMetrics(mint),
  ]);

  const patched: LaunchRecord = mergeLaunchRecord(existing, {
    ...existing,
    name: pump?.name,
    symbol: pump?.symbol,
    description: pump?.description,
    image: normalizeMediaUrl(pump?.image) ?? existing.image,
    marketCapUsd: pump?.marketCapUsd,
    bonded: pump?.bonded,
    holderCount: pump?.holderCount,
    bondingProgressPct: pump?.bondingProgressPct,
    marketUpdatedAt: pump?.updatedAt,
    volumeUsd24h: vol?.volumeUsd24h,
    volumeUsd1h: vol?.volumeUsd1h,
    txns24h: vol?.txns24h,
    volumeUpdatedAt: vol?.volumeUpdatedAt,
  });

  updateLaunch(patched);
  return getState().launches.find((l) => l.mint === mint) ?? patched;
}

export function getState(): LiveState {
  if (!state) return initFromReport();
  state.feeds.geyser = geyserConnected;
  state.feeds.tweetstream = tweetstreamConnected;
  state.connected = geyserConnected || tweetstreamConnected;
  state.geyserStats = { ...geyserStats };
  return state;
}

export function setGeyserConnected(on: boolean) {
  geyserConnected = on;
  if (state) {
    state.feeds.geyser = on;
    state.connected = geyserConnected || tweetstreamConnected;
  }
}

export function setTweetStreamConnected(on: boolean) {
  tweetstreamConnected = on;
  if (state) {
    state.feeds.tweetstream = on;
    state.connected = geyserConnected || tweetstreamConnected;
  }
}

export function setTweetStreamAccounts(accounts: string[]) {
  if (state) state.feeds.tweetstreamAccounts = accounts;
}

export function recordGeyserPumpTx() {
  geyserStats.pumpTxSeen += 1;
}

export function recordCreateParsed() {
  geyserStats.createsParsed += 1;
}

export function recordCreateStored() {
  geyserStats.createsStored += 1;
  recentCreateTimes.push(Date.now());
}

export function addLaunch(launch: LaunchRecord) {
  const current = getState();
  if (current.launches.some((l) => l.mint === launch.mint)) return;

  recordCreateStored();
  const launches = [launch, ...current.launches].slice(0, 5000);
  state = buildState(launches, current.sparks, current.liveLaunches + 1);
  state.feeds.geyser = geyserConnected;
  state.feeds.tweetstream = tweetstreamConnected;
  broadcast('launch', {
    launch,
    metas: state.metas,
    sparks: state.sparks,
    launches: state.launches.slice(0, 200),
    geyserStats: state.geyserStats,
    liveLaunches: state.liveLaunches,
  });
  persistCurrent();
}

export function updateLaunch(launch: LaunchRecord, opts?: { soft?: boolean }) {
  const current = getState();
  const idx = current.launches.findIndex((l) => l.mint === launch.mint);
  if (idx < 0) return;

  const launches = [...current.launches];
  launches[idx] = mergeLaunchRecord(launches[idx]!, launch);

  // Soft path: patch launch + light broadcast without full meta recompute.
  // Used for progressive enrich so geyser isn't starved at 100% CPU.
  if (opts?.soft && state) {
    state = {
      ...state,
      launches,
      feeds: {
        geyser: geyserConnected,
        tweetstream: tweetstreamConnected,
        tweetstreamAccounts: state.feeds.tweetstreamAccounts,
      },
    };
    broadcast('launch', {
      launch: launches[idx],
      launches: state.launches.slice(0, 200),
      geyserStats: { ...geyserStats },
      liveLaunches: state.liveLaunches,
    });
    return;
  }

  state = buildState(launches, current.sparks, current.liveLaunches);
  state.feeds.geyser = geyserConnected;
  state.feeds.tweetstream = tweetstreamConnected;
  rebroadcast();
  persistCurrent();
}

export function addSpark(spark: SocialSpark) {
  const current = getState();
  if (current.sparks.some((s) => s.id === spark.id)) return;

  const sparks = [spark, ...current.sparks].slice(0, 200);
  state = buildState(current.launches, sparks, current.liveLaunches);
  state.feeds.geyser = geyserConnected;
  state.feeds.tweetstream = tweetstreamConnected;
  broadcast('spark', { spark, metas: state.metas, sparks: state.sparks });
  persistCurrent();
}

/** Merge scan file into live buffer ÔÇö never wipe live captures. */
export function refreshFromReport() {
  const report = loadLatestReport();
  if (!report) return;
  const current = getState();
  const merged = mergeLaunches(current.launches, report.launches);
  state = buildState(merged, current.sparks, current.liveLaunches);
  state.feeds.geyser = geyserConnected;
  state.feeds.tweetstream = tweetstreamConnected;
  rebroadcast();
  persistCurrent();
}

/** Re-run meta engine (stage shifts) without new launches. */
export function recalcMetas() {
  const current = getState();
  state = buildState(current.launches, current.sparks, current.liveLaunches);
  state.feeds.geyser = geyserConnected;
  state.feeds.tweetstream = tweetstreamConnected;
  rebroadcast();
}

let volumeRefreshRunning = false;
let volumePollOffset = 0;
const METRICS_BATCH = 36;
const NEWEST_PRIORITY = 18;

function needsMetrics(l: LaunchRecord): boolean {
  return (
    l.marketCapUsd == null
    || l.holderCount == null
    || l.volumeUsd1h == null
    || l.txns24h == null
    || l.bondingProgressPct == null
  );
}

/** Poll DexScreener + pump.fun for recent launches (newest always first, then rotate). */
export async function refreshLaunchVolumes() {
  if (volumeRefreshRunning || !state) return;
  volumeRefreshRunning = true;
  try {
    const current = getState();
    const now = Math.floor(Date.now() / 1000);
    const recentSorted = current.launches
      .filter((l) => l.blockTime && now - l.blockTime <= 7200)
      .sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
    const missingMetrics = recentSorted.filter(needsMetrics).slice(0, NEWEST_PRIORITY).map((l) => l.mint);
    const newest = [
      ...missingMetrics,
      ...recentSorted.slice(0, NEWEST_PRIORITY).map((l) => l.mint),
    ].filter((m, i, arr) => arr.indexOf(m) === i).slice(0, NEWEST_PRIORITY);
    const recent = recentSorted.map((l) => l.mint);
    const metaMints = [
      ...current.metas.active,
      ...current.metas.forming,
      ...(current.metas.emerging ?? []),
    ].flatMap((m) => m.tokens.map((t) => t.mint));
    const rotatePool = [...new Set([...recent, ...metaMints])].filter((m) => !newest.includes(m));
    if (!newest.length && !rotatePool.length) return;

    volumePollOffset = rotatePool.length ? volumePollOffset % rotatePool.length : 0;
    const rotated: string[] = [];
    const rotateCount = Math.max(0, METRICS_BATCH - newest.length);
    for (let i = 0; i < rotateCount && rotatePool.length; i++) {
      rotated.push(rotatePool[(volumePollOffset + i) % rotatePool.length]!);
    }
    if (rotatePool.length) {
      volumePollOffset = (volumePollOffset + rotateCount) % rotatePool.length;
    }

    const mints = [...new Set([...newest, ...rotated])];

    const [volumes, markets] = await Promise.all([
      refreshVolumesForMints(mints, 10),
      refreshPumpCoinsForMints(mints, 10),
    ]);
    if (!volumes.size && !markets.size) return;

    let changed = false;
    const launches = current.launches.map((l) => {
      const vol = volumes.get(l.mint);
      const mkt = markets.get(l.mint);
      if (!vol && !mkt) return l;
      changed = true;
      return mergeLaunchRecord(l, {
        ...l,
        name: mkt?.name,
        symbol: mkt?.symbol,
        image: mkt?.image,
        volumeUsd24h: vol?.volumeUsd24h,
        volumeUsd1h: vol?.volumeUsd1h,
        txns24h: vol?.txns24h,
        volumeUpdatedAt: vol?.volumeUpdatedAt,
        marketCapUsd: mkt?.marketCapUsd,
        bonded: mkt?.bonded,
        holderCount: mkt?.holderCount,
        bondingProgressPct: mkt?.bondingProgressPct,
        marketUpdatedAt: mkt?.updatedAt,
      });
    });

    if (changed) {
      state = buildState(launches, current.sparks, current.liveLaunches);
      state.feeds.geyser = geyserConnected;
      state.feeds.tweetstream = tweetstreamConnected;
      rebroadcast();
      persistCurrent();
    }
  } finally {
    volumeRefreshRunning = false;
  }
}

export function subscribe(client: SseClient) {
  clients.add(client);
  return () => clients.delete(client);
}

function broadcast(type: string, payload: unknown) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    try {
      client(msg);
    } catch {
      clients.delete(client);
    }
  }
}

export function heartbeat() {
  const msg = `: ping ${Date.now()}\n\n`;
  for (const client of clients) {
    try {
      client(msg);
    } catch {
      clients.delete(client);
    }
  }
}
