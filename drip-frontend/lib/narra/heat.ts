import type { MetaTrack } from "./types";

export interface MetaSnapshot {
  launchCount: number;
  totalVolumeUsd1h: number;
  totalVolumeUsd24h: number;
  totalTxns24h: number;
  topMarketCapUsd: number;
  totalHolders: number;
}

export function metaSnapshot(m: MetaTrack): MetaSnapshot {
  const totalHolders = m.tokens.reduce((s, t) => s + (t.holderCount ?? 0), 0);
  return {
    launchCount: m.launchCount,
    totalVolumeUsd1h: m.totalVolumeUsd1h ?? 0,
    totalVolumeUsd24h: m.totalVolumeUsd24h ?? 0,
    totalTxns24h: m.totalTxns24h ?? 0,
    topMarketCapUsd: m.topMarketCapUsd ?? 0,
    totalHolders,
  };
}

/** Always-on heat from how active the cluster is right now (not just deltas). */
export function computeSustainedHeat(m: MetaTrack, nowSec = Math.floor(Date.now() / 1000)): number {
  let s = 0;
  const vol1h = m.totalVolumeUsd1h ?? 0;
  const tx = m.totalTxns24h ?? 0;
  const count = m.launchCount;
  const ageSec = nowSec - m.lastSeen;

  if (count >= 2) s += 1;
  if (count >= 5) s += 1;
  if (count >= 10) s += 1;
  if (count >= 15) s += 1;
  if (vol1h > 0) s += 1;
  if (vol1h >= 25) s += 1;
  if (tx >= 3) s += 1;
  if (tx >= 15) s += 1;
  if (m.volumeTrend === "hot") s += 2;
  if (m.volumeTrend === "cooling" && vol1h > 0) s += 1;
  if (m.stage === "momentum" || m.stage === "copycat") s += 1;
  if (m.stage === "peak") s += 1;
  if (m.isActive) s += 1;
  if (ageSec <= 600) s += 1;
  if (ageSec <= 120) s += 1;

  return Math.min(5, s);
}

/** Short boost when a metric ticks up (sticks ~25s). */
export function computePulseBoost(cur: MetaSnapshot, prev: MetaSnapshot | null): number {
  if (!prev) return 0;
  let boost = 0;
  if (cur.launchCount > prev.launchCount) boost += 2;
  if (cur.totalVolumeUsd1h > prev.totalVolumeUsd1h) boost += 2;
  if (cur.totalTxns24h > prev.totalTxns24h) boost += 1;
  if (cur.topMarketCapUsd > prev.topMarketCapUsd) boost += 1;
  if (cur.totalHolders > prev.totalHolders) boost += 1;
  return Math.min(3, boost);
}

export type MetricDir = "up" | "down" | "same";

export function metricDir(cur?: number, prev?: number): MetricDir {
  const c = cur ?? 0;
  const p = prev ?? c;
  if (c > p) return "up";
  if (c < p) return "down";
  return "same";
}

export interface TimelineEvent {
  feedId: string;
  at: number;
  stage: string;
  theme: string;
  label: string;
  metaId: string | null;
  image?: string;
  isSocial?: boolean;
  isLaunch?: boolean;
  stats?: string;
  opportunityScore: number;
  tier: 0 | 1 | 2 | 3;
}

/** Quality score from metrics/stage only — age is NOT included (feed sorts by time). */
export function computeOpportunityScore(
  ev: {
    at: number;
    stage: string;
    isLaunch?: boolean;
    isSocial?: boolean;
    label: string;
    stats?: string;
    marketCapUsd?: number;
    volumeUsd1h?: number;
    txns24h?: number;
    holderCount?: number;
  },
  meta?: MetaTrack | null,
): number {
  let s = 0;

  if (ev.stage === "momentum" || ev.stage === "copycat") s += 6;
  if (ev.stage === "peak") s += 5;
  if (ev.stage === "recognition") s += 3;
  if (ev.stage === "naming") s += 1;

  if (meta) {
    if (meta.launchCount >= 5) s += 2;
    if (meta.launchCount >= 8) s += 2;
    if (meta.launchCount >= 12) s += 2;
    if (meta.volumeTrend === "hot") s += 4;
    if (meta.isActive) s += 2;
    const vol = meta.totalVolumeUsd1h ?? 0;
    if (vol > 0) s += 1;
    if (vol >= 100) s += 2;
    if (vol >= 1000) s += 2;
    if ((meta.totalTxns24h ?? 0) >= 10) s += 2;
    if ((meta.totalTxns24h ?? 0) >= 50) s += 2;
    if ((meta.topMarketCapUsd ?? 0) >= 5000) s += 2;
    if ((meta.topMarketCapUsd ?? 0) >= 20000) s += 2;
  }

  if (ev.isLaunch) {
    const mcap = ev.marketCapUsd ?? 0;
    const vol = ev.volumeUsd1h ?? 0;
    const tx = ev.txns24h ?? 0;
    const holders = ev.holderCount ?? 0;

    // Fixed floor for naked creates — do NOT use Date.now() age (causes constant re-sort).
    if (mcap <= 0 && vol <= 0 && tx <= 0) {
      return Math.max(s, 6);
    }
    if (mcap > 0) s += 1;
    if (mcap >= 5000) s += 2;
    if (vol > 0) s += 1;
    if (vol >= 50) s += 2;
    if (vol >= 500) s += 2;
    if (tx >= 5) s += 1;
    if (tx >= 25) s += 2;
    if (holders >= 20) s += 1;
  }

  if (ev.label.includes("mcap") || ev.label.includes("vol") || ev.label.includes("tx")) s += 1;

  return s;
}

export function opportunityTier(score: number): 0 | 1 | 2 | 3 {
  if (score >= 12) return 3;
  if (score >= 8) return 2;
  if (score >= 5) return 1;
  return 0;
}
