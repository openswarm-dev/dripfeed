"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { GeyserStats, MetaDashboard, NarraLive, NarraReport, NarraState, LaunchRecord, SocialSpark } from "./types";

/** Same-origin proxy — see app/api/radar/* */
const API_BASE = "";

const BOOT_CACHE_KEY = "betttr_live_v5";
const BOOT_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
const LIVE_FEED_MAX = 150;

interface BootCache {
  at: number;
  liveFeed: LaunchRecord[];
  geyserStats: GeyserStats;
  live: NarraLive;
  geyserEnabled?: boolean;
}

if (typeof window !== "undefined") {
  try {
    ["betttr_boot_v1", "betttr_boot_v2", "betttr_boot_v3", "betttr_live_v4"].forEach((k) => sessionStorage.removeItem(k));
  } catch { /* ignore */ }
}

const EMPTY_LIVE: NarraLive = {
  connected: false,
  feeds: { geyser: false, tweetstream: false, tweetstreamAccounts: [] },
  liveLaunches: 0,
  liveSparks: 0,
  lastLaunchAt: null,
  lastSparkAt: null,
};

const EMPTY_GEYSER: GeyserStats = {
  pumpTxSeen: 0,
  createsParsed: 0,
  createsStored: 0,
  perMinute: 0,
};

const EMPTY_STATE: NarraState = {
  metas: null,
  liveFeed: [],
  sparks: [],
  geyserStats: EMPTY_GEYSER,
  geyserEnabled: undefined,
  live: EMPTY_LIVE,
};

function readBootCache(): BootCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(BOOT_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as BootCache;
    if (Date.now() - data.at > BOOT_CACHE_MAX_AGE_MS) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    data.liveFeed = (data.liveFeed ?? []).filter(
      (l) => !l.blockTime || nowSec - l.blockTime < 7200,
    );
    return data;
  } catch {
    return null;
  }
}

function writeBootCache(state: Pick<NarraState, "liveFeed" | "geyserStats" | "live" | "geyserEnabled">) {
  if (typeof window === "undefined") return;
  try {
    const payload: BootCache = {
      at: Date.now(),
      liveFeed: state.liveFeed.slice(0, LIVE_FEED_MAX),
      geyserStats: state.geyserStats,
      live: state.live,
      geyserEnabled: state.geyserEnabled,
    };
    sessionStorage.setItem(BOOT_CACHE_KEY, JSON.stringify(payload));
  } catch { /* ignore */ }
}

function cacheToState(cache: BootCache): NarraState {
  return {
    metas: null,
    liveFeed: cache.liveFeed,
    sparks: [],
    geyserStats: cache.geyserStats ?? EMPTY_GEYSER,
    geyserEnabled: cache.geyserEnabled,
    live: cache.live ?? EMPTY_LIVE,
  };
}

/** Never let empty/zero polls erase known-good metrics. */
function keepMetric(next: number | undefined, prev: number | undefined): number | undefined {
  if (next == null) return prev;
  if (next <= 0 && prev != null && prev > 0) return prev;
  return next;
}

function mergeLaunchRecord(prev: LaunchRecord, next: LaunchRecord): LaunchRecord {
  let blockTime = prev.blockTime ?? next.blockTime ?? null;
  if (prev.blockTime != null && next.blockTime != null) {
    blockTime = Math.min(prev.blockTime, next.blockTime);
  }

  return {
    ...prev,
    ...next,
    blockTime,
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

/** Prepend new tokens at top; patch enrichments in place — never re-sort. */
function applyLiveLaunch(feed: LaunchRecord[], launch: LaunchRecord): LaunchRecord[] {
  const idx = feed.findIndex((l) => l.mint === launch.mint);
  if (idx === 0) {
    return [mergeLaunchRecord(feed[0]!, launch), ...feed.slice(1)].slice(0, LIVE_FEED_MAX);
  }
  if (idx > 0) {
    const next = [...feed];
    next[idx] = mergeLaunchRecord(feed[idx]!, launch);
    return next;
  }
  return [launch, ...feed].slice(0, LIVE_FEED_MAX);
}

function mergeMetas(prev: MetaDashboard | null, next: MetaDashboard | null | undefined): MetaDashboard | null {
  if (!next) return prev;
  if (!prev) return next;

  const prevById = new Map(
    [...(prev.emerging ?? []), ...prev.forming, ...prev.active, ...(prev.fading ?? [])].map((m) => [m.id, m]),
  );

  const patch = (m: (typeof next.active)[number]) => {
    const old = prevById.get(m.id);
    if (!old) return m;
    return {
      ...m,
      totalVolumeUsd1h: keepMetric(m.totalVolumeUsd1h, old.totalVolumeUsd1h) ?? m.totalVolumeUsd1h,
      totalVolumeUsd24h: keepMetric(m.totalVolumeUsd24h, old.totalVolumeUsd24h) ?? m.totalVolumeUsd24h,
      totalTxns24h: keepMetric(m.totalTxns24h, old.totalTxns24h) ?? m.totalTxns24h,
      topMarketCapUsd: keepMetric(m.topMarketCapUsd, old.topMarketCapUsd) ?? m.topMarketCapUsd,
      totalMarketCapUsd: keepMetric(m.totalMarketCapUsd, old.totalMarketCapUsd) ?? m.totalMarketCapUsd,
    };
  };

  return {
    ...next,
    emerging: (next.emerging ?? []).map(patch),
    forming: next.forming.map(patch),
    active: next.active.map(patch),
    fading: (next.fading ?? []).map(patch),
    all: next.all?.length ? next.all.map(patch) : (prev.all ?? []),
  };
}

type PartialPayload = Partial<NarraReport & {
  metas?: MetaDashboard;
  launches?: LaunchRecord[];
  sparks?: SocialSpark[];
  geyserStats?: GeyserStats;
  geyserEnabled?: boolean;
  live?: NarraLive;
  launch?: LaunchRecord;
  spark?: SocialSpark;
  connected?: boolean;
  feeds?: NarraLive["feeds"];
  liveLaunches?: number;
  liveSparks?: number;
}>;

/** Merge SSE/report payloads — never let DB/historical launches touch liveFeed. */
function mergePayload(base: NarraState, data: PartialPayload): NarraState {
  let liveFeed = base.liveFeed;
  if (data.launch) {
    liveFeed = applyLiveLaunch(base.liveFeed, data.launch);
  }

  let sparks = base.sparks;
  if (data.sparks) {
    const byId = new Map(base.sparks.map((s) => [s.id, s]));
    for (const s of data.sparks) byId.set(s.id, s);
    sparks = [...byId.values()].sort((a, b) => b.receivedAt - a.receivedAt).slice(0, 200);
  } else if (data.spark) {
    sparks = [data.spark, ...base.sparks].slice(0, 100);
  }

  const live: NarraLive = {
    ...base.live,
    ...(data.live ?? {}),
    feeds: data.feeds ?? data.live?.feeds ?? base.live.feeds,
    connected: data.connected ?? data.live?.connected ?? base.live.connected,
    liveLaunches: data.liveLaunches ?? data.live?.liveLaunches ?? base.live.liveLaunches,
    liveSparks: data.liveSparks ?? data.live?.liveSparks ?? base.live.liveSparks,
  };

  return {
    metas: mergeMetas(base.metas, data.metas),
    liveFeed,
    sparks,
    geyserStats: data.geyserStats ?? base.geyserStats,
    geyserEnabled: data.geyserEnabled ?? base.geyserEnabled,
    live,
  };
}

export function useNarra() {
  const bootCache = typeof window !== "undefined" ? readBootCache() : null;
  const [state, setState] = useState<NarraState | null>(() => (bootCache ? cacheToState(bootCache) : null));
  const [loading, setLoading] = useState(!bootCache);
  const [error, setError] = useState<string | null>(null);
  const [loaderDone, setLoaderDone] = useState(!!bootCache);
  const esRef = useRef<EventSource | null>(null);
  const hydratedRef = useRef(!!bootCache);

  const persistCache = useCallback((next: NarraState) => {
    writeBootCache(next);
  }, []);

  const mergePartial = useCallback((data: PartialPayload) => {
    setState((prev) => {
      const merged = mergePayload(prev ?? EMPTY_STATE, data);
      persistCache(merged);
      return merged;
    });
  }, [persistCache]);

  // Metas only — never pollutes the geyser live feed.
  useEffect(() => {
    let cancelled = false;
    const loadMetas = () => {
      fetch(`${API_BASE}/api/radar/report`, { cache: "no-store" })
        .then((r) => r.json())
        .then((report: NarraReport) => {
          if (cancelled) return;
          setState((prev) => mergePayload(prev ?? EMPTY_STATE, {
            metas: report.metas,
            sparks: report.sparks,
            geyserStats: report.geyserStats,
            geyserEnabled: report.geyserEnabled,
            live: report.live,
          }));
        })
        .catch(() => { /* non-fatal */ });
    };

    if (!bootCache) {
      const t = setTimeout(loadMetas, 6000);
      return () => { cancelled = true; clearTimeout(t); };
    }
    loadMetas();
    const iv = setInterval(loadMetas, 120_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [bootCache]);

  // SSE — geyser live feed streams here in real time.
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/radar/stream`);
    esRef.current = es;

    const launchQueue: PartialPayload[] = [];
    let draining = false;
    const drainLaunches = () => {
      const next = launchQueue.shift();
      if (!next) { draining = false; return; }
      flushSync(() => mergePartial(next));
      if (launchQueue.length) requestAnimationFrame(drainLaunches);
      else draining = false;
    };
    const enqueueLaunch = (data: PartialPayload) => {
      launchQueue.push(data);
      if (!draining) { draining = true; requestAnimationFrame(drainLaunches); }
    };

    es.addEventListener("init", (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      // launches from SSE init = geyser-only liveFeed from backend (not DB).
      const serverFeed: LaunchRecord[] = data.launches ?? [];
      setState((prev) => {
        const base = prev ?? EMPTY_STATE;
        let liveFeed = base.liveFeed;
        for (let i = serverFeed.length - 1; i >= 0; i--) {
          liveFeed = applyLiveLaunch(liveFeed, serverFeed[i]!);
        }
        const merged: NarraState = {
          ...base,
          liveFeed,
          geyserStats: data.geyserStats ?? base.geyserStats,
          geyserEnabled: data.geyserEnabled ?? base.geyserEnabled,
          live: {
            ...base.live,
            connected: data.connected ?? false,
            feeds: data.feeds ?? EMPTY_LIVE.feeds,
            liveLaunches: data.liveLaunches ?? liveFeed.length,
            liveSparks: data.liveSparks ?? 0,
            lastLaunchAt: data.lastLaunchAt ?? null,
            lastSparkAt: data.lastSparkAt ?? null,
          },
        };
        writeBootCache(merged);
        return merged;
      });
      setLoading(false);
      setLoaderDone(true);
      setError(null);
      hydratedRef.current = true;

      fetch(`${API_BASE}/api/radar/report`, { cache: "no-store" })
        .then((r) => r.json())
        .then((report: NarraReport) => {
          setState((prev) => mergePayload(prev ?? EMPTY_STATE, {
            metas: report.metas,
            sparks: report.sparks,
          }));
        })
        .catch(() => { /* non-fatal */ });
    });

    es.addEventListener("launch", (e) => {
      enqueueLaunch(JSON.parse((e as MessageEvent).data));
    });

    es.addEventListener("spark", (e) => {
      mergePartial(JSON.parse((e as MessageEvent).data));
    });

    es.addEventListener("refresh", (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      // refresh = metas/metrics only — ignore any launches array from DB rebroadcasts.
      mergePartial({
        metas: data.metas,
        sparks: data.sparks,
        geyserStats: data.geyserStats,
        liveLaunches: data.liveLaunches,
      });
    });

    es.onerror = () => { /* EventSource auto-reconnects */ };

    return () => {
      launchQueue.length = 0;
      es.close();
      esRef.current = null;
    };
  }, [mergePartial]);

  const refreshLaunch = useCallback(async (mint: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/radar/launch/${mint}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { launch?: LaunchRecord };
      if (data.launch) mergePartial({ launch: data.launch });
    } catch { /* ignore */ }
  }, [mergePartial]);

  return { state, loading, error, loaderDone, refreshLaunch };
}
