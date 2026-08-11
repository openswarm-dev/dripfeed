"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeyserStats, MetaDashboard, NarraLive, NarraReport, NarraState, LaunchRecord, SocialSpark } from "./types";

/** Same-origin proxy — see app/api/radar/* */
const API_BASE = "";

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

function mergePayload(base: NarraState, data: PartialPayload): NarraState {
  let launches = base.launches;
  if (data.launches) {
    launches = data.launches;
  } else if (data.launch) {
    launches = [data.launch, ...base.launches].slice(0, 500);
  }

  let sparks = base.sparks;
  if (data.sparks) {
    sparks = data.sparks;
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
    metas: data.metas ?? base.metas,
    launches,
    sparks,
    geyserStats: data.geyserStats ?? base.geyserStats,
    geyserEnabled: data.geyserEnabled ?? base.geyserEnabled,
    live,
  };
}

export function useNarra() {
  const [state, setState] = useState<NarraState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loaderDone, setLoaderDone] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const mergePartial = useCallback((data: PartialPayload) => {
    setState((prev) => {
      const base = prev ?? {
        metas: null,
        launches: [],
        sparks: [],
        geyserStats: EMPTY_GEYSER,
        geyserEnabled: undefined,
        live: EMPTY_LIVE,
      };
      return mergePayload(base, data);
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
          setError(report.error ?? "Radar service unavailable");
        } else {
          setState(reportToState(report));
        }
      } catch {
        if (!cancelled) {
          setError("Cannot reach radar backend. Run npm run dev in DEVSNIPER/narra (port 3950) or set RADAR_API_URL.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (loading || error) return;

    const es = new EventSource(`${API_BASE}/api/radar/stream`);
    esRef.current = es;

    es.addEventListener("init", (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      mergePartial({
        metas: data.metas,
        launches: data.launches,
        sparks: data.sparks,
        geyserStats: data.geyserStats,
        geyserEnabled: data.geyserEnabled,
        connected: data.connected,
        feeds: data.feeds,
        liveLaunches: data.liveLaunches,
        liveSparks: data.liveSparks,
      });
      setLoaderDone(true);
    });

    es.addEventListener("launch", (e) => {
      mergePartial(JSON.parse((e as MessageEvent).data));
    });

    es.addEventListener("spark", (e) => {
      mergePartial(JSON.parse((e as MessageEvent).data));
    });

    es.addEventListener("refresh", (e) => {
      mergePartial(JSON.parse((e as MessageEvent).data));
    });

    es.onerror = () => { /* EventSource auto-reconnects */ };

    const fallback = setTimeout(() => setLoaderDone(true), 6000);

    const poll = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/radar/report`, { cache: "no-store" });
        if (!res.ok) return;
        const report: NarraReport = await res.json();
        if (!report.error) setState(reportToState(report));
      } catch {
        /* ignore */
      }
    }, 8000);

    return () => {
      clearTimeout(fallback);
      clearInterval(poll);
      es.close();
      esRef.current = null;
    };
  }, [loading, error, mergePartial]);

  return { state, loading, error, loaderDone };
}
