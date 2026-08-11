import type { LaunchRecord } from './fetchLaunches.js';
import { analyzeMetas, type MetaDashboard } from './metaEngine.js';
import { loadLatestReport } from './report.js';
import type { SocialSpark } from './socialSpark.js';
import { hydrateFromDb, initPersist, loadPersistedState, schedulePersist } from './persist.js';
import { fetchRecentPumpCreates } from './market.js';
import { classifyNarratives } from './classify.js';
import { normalizeMediaUrl } from './imageKey.js';
import { slimLaunchForWire, slimMetasForWire } from './wirePayload.js';

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

function hasLaunchLabel(l: LaunchRecord): boolean {
  const name = l.name?.trim();
  const sym = l.symbol?.trim();
  if (!name && !sym) return false;
  // mint-prefix placeholders from old false positives
  if (sym && sym === l.mint.slice(0, 8) && !name) return false;
  return true;
}

/** Prefer showing every real create; only hide ancient nameless junk. */
function isUsableLaunch(l: LaunchRecord): boolean {
  if (hasLaunchLabel(l) || !!l.metadataUri || !!l.image) return true;
  const age = l.blockTime ? Math.floor(Date.now() / 1000) - l.blockTime : 0;
  return age < 180;
}

function usableLaunches(launches: LaunchRecord[]): LaunchRecord[] {
  return launches.filter(isUsableLaunch);
}

function buildState(
  launches: LaunchRecord[],
  sparks: SocialSpark[],
  liveLaunchCount = 0,
): LiveState {
  const clean = usableLaunches(launches);
  const metas = analyzeMetas(clean, 4, sparks, { live: true });
  const lastLaunch = clean
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
    launches: clean,
    sparks: sparks.slice(0, 100),
  };
}

function rebroadcast() {
  if (!state) return;
  broadcast('refresh', {
    metas: slimMetasForWire(state.metas),
    sparks: state.sparks,
    launches: state.launches.slice(0, 80).map(slimLaunchForWire),
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

/** Return cached launch only — no pump.fun / DexScreener (keeps create stream healthy). */
export async function forceRefreshLaunch(mint: string): Promise<LaunchRecord | null> {
  return getState().launches.find((l) => l.mint === mint) ?? null;
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

  // Soft path: push to UI immediately — never run analyzeMetas on the hot create path.
  if (state) {
    state = {
      ...state,
      launches,
      liveLaunches: current.liveLaunches + 1,
      lastLaunchAt: launch.blockTime
        ? new Date(launch.blockTime * 1000).toISOString()
        : state.lastLaunchAt,
      feeds: {
        geyser: geyserConnected,
        tweetstream: tweetstreamConnected,
        tweetstreamAccounts: state.feeds.tweetstreamAccounts,
      },
      geyserStats: { ...geyserStats, perMinute: recentCreateTimes.length },
    };
    broadcast('launch', {
      launch,
      geyserStats: state.geyserStats,
      liveLaunches: state.liveLaunches,
    });
    persistCurrent();
    scheduleMetaRecalc();
    return;
  }

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

let metaRecalcTimer: ReturnType<typeof setTimeout> | null = null;
let metasDirty = false;

/** Mark metas dirty; flushed on a short interval so Building/Hot keep moving. */
function scheduleMetaRecalc() {
  metasDirty = true;
  if (metaRecalcTimer) return;
  metaRecalcTimer = setTimeout(() => {
    metaRecalcTimer = null;
    if (!metasDirty) return;
    metasDirty = false;
    recalcMetas();
  }, 120);
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
    // Only send the patched launch — never re-serialize the whole feed on every enrich tick.
    broadcast('launch', {
      launch: launches[idx],
      geyserStats: { ...geyserStats },
      liveLaunches: state.liveLaunches,
    });
    scheduleMetaRecalc();
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

/** Merge scan file into live buffer — never wipe live captures. */
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
  // Always push metas so Building / Hot / opportunity clusters move in the UI.
  broadcast('refresh', {
    metas: slimMetasForWire(state.metas),
    geyserStats: state.geyserStats,
    liveLaunches: state.liveLaunches,
  });
}

/** Metrics polling disabled — pump.fun/DexScreener starved ERPC create handling. */
export async function refreshLaunchVolumes() {
  return;
}

/**
 * Gap-fill newest pump.fun creates via one list API call (identity only).
 * Catches tokens ERPC missed without per-mint metrics polling.
 */
let createSyncRunning = false;
export async function syncRecentPumpCreates() {
  if (createSyncRunning || !state) return;
  createSyncRunning = true;
  try {
    const recent = await fetchRecentPumpCreates(50);
    if (!recent.length) return;

    const current = getState();
    const known = new Set(current.launches.map((l) => l.mint));
    let added = 0;

    // Newest-first; yield between adds so each create flushes its own SSE event
    // instead of dumping a batch into one TCP/React tick.
    for (const coin of recent) {
      if (known.has(coin.mint)) continue;
      known.add(coin.mint);

      const cls = classifyNarratives({
        name: coin.name,
        symbol: coin.symbol,
        mint: coin.mint,
      });

      addLaunch({
        signature: `pump-sync:${coin.mint}`,
        slot: 0,
        blockTime: coin.createdAt || Math.floor(Date.now() / 1000),
        mint: coin.mint,
        creator: coin.creator ?? '',
        isCreateV2: true,
        name: coin.name,
        symbol: coin.symbol,
        image: normalizeMediaUrl(coin.image),
        metadataUri: coin.metadataUri,
        narratives: cls.narratives,
        primaryNarrative: cls.primaryNarrative,
        narrativeScore: cls.narrativeScore,
      });
      added += 1;
      await new Promise((r) => setImmediate(r));
    }

    if (added) {
      console.log(`[sync] gap-filled ${added} creates from pump.fun list`);
    }
  } finally {
    createSyncRunning = false;
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
