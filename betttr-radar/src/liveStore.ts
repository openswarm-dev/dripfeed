import type { LaunchRecord } from './fetchLaunches.js';
import { analyzeMetas, type MetaDashboard } from './metaEngine.js';
import { loadLatestReport } from './report.js';
import type { SocialSpark } from './socialSpark.js';
import { refreshVolumesForMints } from './volume.js';
import { refreshPumpCoinsForMints } from './market.js';
import { loadPersistedState, schedulePersist } from './persist.js';

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
    byMint.set(l.mint, prev ? { ...prev, ...l } : l);
  }
  return [...byMint.values()]
    .sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0))
    .slice(0, 5000);
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

export function updateLaunch(launch: LaunchRecord) {
  const current = getState();
  const idx = current.launches.findIndex((l) => l.mint === launch.mint);
  if (idx < 0) return;

  const launches = [...current.launches];
  launches[idx] = { ...launches[idx], ...launch };
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
  rebroadcast();
}

let volumeRefreshRunning = false;
let volumePollOffset = 0;
const METRICS_BATCH = 36;
const NEWEST_PRIORITY = 18;

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
    const newest = recentSorted.slice(0, NEWEST_PRIORITY).map((l) => l.mint);
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
      return {
        ...l,
        name: l.name ?? mkt?.name,
        symbol: l.symbol ?? mkt?.symbol,
        image: l.image ?? mkt?.image,
        volumeUsd24h: vol?.volumeUsd24h ?? l.volumeUsd24h,
        volumeUsd1h: vol?.volumeUsd1h ?? l.volumeUsd1h,
        txns24h: vol?.txns24h ?? l.txns24h,
        volumeUpdatedAt: vol?.volumeUpdatedAt ?? l.volumeUpdatedAt,
        marketCapUsd: mkt?.marketCapUsd ?? l.marketCapUsd,
        bonded: mkt?.bonded ?? l.bonded,
        holderCount: mkt?.holderCount ?? l.holderCount,
        bondingProgressPct: mkt?.bondingProgressPct ?? l.bondingProgressPct,
        marketUpdatedAt: mkt?.updatedAt ?? l.marketUpdatedAt,
      };
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
