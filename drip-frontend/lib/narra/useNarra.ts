"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeyserStats, MetaDashboard, NarraLive, NarraReport, NarraState, LaunchRecord, SocialSpark } from "./types";

/** Same-origin proxy — see app/api/radar/* */
const API_BASE = "";
/** Boot paint only — never write on every live create (that blocked the UI). */
const BOOT_CACHE_KEY = "betttr_boot_v2";
const BOOT_CACHE_MAX_AGE_MS = 15 * 60_000;

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

function reportToState(report: NarraReport): NarraState {
  return {
    metas: report.metas ?? null,
    launches: report.launches ?? [],
    sparks: report.sparks ?? [],
    geyserStats: report.geyserStats ?? EMPTY_GEYSER,
    geyserEnabled: report.geyserEnabled,
    live: report.live ?? EMPTY_LIVE,
  };
}

function readBootCache(): NarraState | null {
  try {
    const raw = sessionStorage.getItem(BOOT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NarraState & { cachedAt?: number };
    if (!parsed?.metas && !parsed?.launches?.length) return null;
    if (parsed.cachedAt && Date.now() - parsed.cachedAt > BOOT_CACHE_MAX_AGE_MS) return null;
    return {
      metas: parsed.metas ?? null,
      launches: parsed.launches ?? [],
      sparks: parsed.sparks ?? [],
      geyserStats: parsed.geyserStats ?? EMPTY_GEYSER,
      geyserEnabled: parsed.geyserEnabled,
      live: parsed.live ?? EMPTY_LIVE,
    };
  } catch {
    return null;
  }
}

function writeBootCache(state: NarraState) {
  try {
    // Keep boot snapshot lean — metas + newest launches only.
    const payload = {
      metas: state.metas,
      launches: state.launches.slice(0, 120),
      sparks: state.sparks.slice(0, 40),
      geyserStats: state.geyserStats,
      geyserEnabled: state.geyserEnabled,
      live: state.live,
      cachedAt: Date.now(),
    };
    sessionStorage.setItem(BOOT_CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
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

/** Never let empty/zero polls erase known-good metrics. */
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

function mergeLaunchesByMint(existing: LaunchRecord[], incoming: LaunchRecord[]): LaunchRecord[] {
  const byMint = new Map<string, LaunchRecord>();
  for (const l of existing) byMint.set(l.mint, l);

  const fresh: string[] = [];
  for (const l of incoming) {
    const prev = byMint.get(l.mint);
    if (prev) {
      byMint.set(l.mint, mergeLaunchRecord(prev, l));
    } else {
      byMint.set(l.mint, l);
      fresh.push(l.mint);
    }
  }

  const seen = new Set<string>();
  const ordered: LaunchRecord[] = [];
  for (const mint of [...fresh.reverse(), ...existing.map((l) => l.mint)]) {
    if (seen.has(mint)) continue;
    const row = byMint.get(mint);
    if (!row) continue;
    seen.add(mint);
    ordered.push(row);
  }
  for (const [mint, row] of byMint) {
    if (seen.has(mint)) continue;
    ordered.push(row);
  }
  return ordered.slice(0, 5000);
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

function mergePayload(base: NarraState, data: PartialPayload): NarraState {
  let launches = base.launches;
  if (data.launches) {
    launches = mergeLaunchesByMint(base.launches, data.launches);
  } else if (data.launch) {
    launches = mergeLaunchesByMint(base.launches, [data.launch]);
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
    launches,
    sparks,
    geyserStats: data.geyserStats ?? base.geyserStats,
    geyserEnabled: data.geyserEnabled ?? base.geyserEnabled,
    live,
  };
}

export function useNarra() {
  const [state, setState] = useState<NarraState | null>(() => readBootCache());
  const [loading, setLoading] = useState(() => !readBootCache()?.metas);
  const [error, setError] = useState<string | null>(null);
  const [loaderDone, setLoaderDone] = useState(() => Boolean(readBootCache()?.metas));
  const esRef = useRef<EventSource | null>(null);
  const hydratedRef = useRef(Boolean(readBootCache()?.metas));

  const mergePartial = useCallback((data: PartialPayload, opts?: { persistBoot?: boolean }) => {
    setState((prev) => {
      const base = prev ?? {
        metas: null,
        launches: [],
        sparks: [],
        geyserStats: EMPTY_GEYSER,
        geyserEnabled: undefined,
        live: EMPTY_LIVE,
      };
      const next = mergePayload(base, data);
      if (opts?.persistBoot && next.metas) writeBootCache(next);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`${API_BASE}/api/radar/report`, { cache: "no-store" });
        const report: NarraReport = await res.json();
        if (cancelled) return;
        if (!res.ok || report.error) {
          if (!hydratedRef.current) {
            setError(report.error ?? "Radar service unavailable");
          }
        } else {
          setState((prev) => {
            const next = prev ? mergePayload(prev, report) : reportToState(report);
            writeBootCache(next);
            return next;
          });
          setError(null);
          hydratedRef.current = true;
          setLoaderDone(true);
        }
      } catch {
        if (!cancelled && !hydratedRef.current) {
          setError("Cannot reach radar backend. Run npm run dev in DEVSNIPER/narra (port 3950) or set RADAR_API_URL.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/radar/stream`);
    esRef.current = es;

    es.addEventListener("init", (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      mergePartial(
        {
          metas: data.metas,
          launches: data.launches,
          sparks: data.sparks,
          geyserStats: data.geyserStats,
          geyserEnabled: data.geyserEnabled,
          connected: data.connected,
          feeds: data.feeds,
          liveLaunches: data.liveLaunches,
          liveSparks: data.liveSparks,
        },
        { persistBoot: true },
      );
      setLoading(false);
      setLoaderDone(true);
      setError(null);
      hydratedRef.current = true;
    });

    es.addEventListener("launch", (e) => {
      mergePartial(JSON.parse((e as MessageEvent).data));
    });

    es.addEventListener("spark", (e) => {
      mergePartial(JSON.parse((e as MessageEvent).data));
    });

    es.addEventListener("refresh", (e) => {
      mergePartial(JSON.parse((e as MessageEvent).data), { persistBoot: true });
    });

    es.onerror = () => {
      /* EventSource auto-reconnects */
    };

    return () => {
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
    } catch {
      /* ignore */
    }
  }, [mergePartial]);

  return { state, loading, error, loaderDone, refreshLaunch };
}
