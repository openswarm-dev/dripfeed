"use client";

import { useEffect, useRef, useState } from "react";
import type { MetaTrack } from "./types";
import {
  computePulseBoost,
  computeSustainedHeat,
  metaSnapshot,
  type MetaSnapshot,
} from "./heat";

const RISE_RATE = 0.07;
const FALL_RATE = 0.022;
const TICK_MS = 80;

function levelFromSmooth(v: number): number {
  if (v < 0.55) return 0;
  if (v < 1.45) return 1;
  if (v < 2.45) return 2;
  if (v < 3.45) return 3;
  if (v < 4.45) return 4;
  return 5;
}

export function useMetaHeat(metas: MetaTrack[] | undefined) {
  const prevRef = useRef<Map<string, MetaSnapshot>>(new Map());
  const targetRef = useRef<Map<string, number>>(new Map());
  const smoothRef = useRef<Map<string, number>>(new Map());
  const pulseRef = useRef<Map<string, { boost: number; until: number }>>(new Map());
  const [levels, setLevels] = useState<Map<string, number>>(new Map());
  const [intensities, setIntensities] = useState<Map<string, number>>(new Map());
  const [surging, setSurging] = useState<Set<string>>(new Set());
  const [prevSnapshots, setPrevSnapshots] = useState<Map<string, MetaSnapshot>>(new Map());

  useEffect(() => {
    if (!metas?.length) return;
    const now = Date.now();
    const displayPrev = new Map<string, MetaSnapshot>();
    const activeIds = new Set<string>();

    for (const m of metas) {
      activeIds.add(m.id);
      const cur = metaSnapshot(m);
      const prev = prevRef.current.get(m.id) ?? null;
      displayPrev.set(m.id, prev ?? cur);

      const boost = computePulseBoost(cur, prev);
      if (boost > 0) {
        const existing = pulseRef.current.get(m.id);
        pulseRef.current.set(m.id, {
          boost: Math.max(existing?.boost ?? 0, boost),
          until: now + 30_000,
        });
      }

      const pulse = pulseRef.current.get(m.id);
      const pulseActive = pulse && pulse.until > now ? pulse.boost * 0.35 : 0;
      const sustained = computeSustainedHeat(m);
      targetRef.current.set(m.id, Math.min(5, sustained + pulseActive));

      prevRef.current.set(m.id, cur);
    }

    for (const id of [...targetRef.current.keys()]) {
      if (!activeIds.has(id)) targetRef.current.set(id, 0);
    }

    for (const [id, p] of pulseRef.current) {
      if (p.until <= now) pulseRef.current.delete(id);
    }

    setPrevSnapshots(displayPrev);
  }, [metas]);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const nextLevels = new Map<string, number>();
      const nextIntensity = new Map<string, number>();
      const nextSurging = new Set<string>();

      const ids = new Set([
        ...targetRef.current.keys(),
        ...smoothRef.current.keys(),
      ]);

      for (const id of ids) {
        const target = targetRef.current.get(id) ?? 0;
        const cur = smoothRef.current.get(id) ?? target;
        const diff = target - cur;
        const rate = diff > 0 ? RISE_RATE : FALL_RATE;
        const next = Math.abs(diff) < 0.015 ? target : cur + diff * rate;
        smoothRef.current.set(id, next);

        const intensity = Math.max(0, Math.min(1, next / 5));
        nextIntensity.set(id, intensity);
        nextLevels.set(id, levelFromSmooth(next));

        const pulse = pulseRef.current.get(id);
        if (pulse && pulse.until > now && diff > 0.05) nextSurging.add(id);
      }

      setLevels(nextLevels);
      setIntensities(nextIntensity);
      setSurging(nextSurging);
    };

    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, []);

  return { levels, intensities, surging, prevSnapshots };
}

/** Score each meta for sort priority — higher = hotter / more relevant right now. */
function metaHotScore(m: MetaTrack, nowSec: number): number {
  let s = 0;
  const ageSec = nowSec - (m.lastSeen ?? 0);
  const vol1h = m.totalVolumeUsd1h ?? 0;
  const vol24h = m.totalVolumeUsd24h ?? 0;
  const tx = m.totalTxns24h ?? 0;

  // Freshness — heavily weighted. A cluster that just had a new token wins.
  if (ageSec <= 120) s += 50;
  else if (ageSec <= 300) s += 40;
  else if (ageSec <= 600) s += 30;
  else if (ageSec <= 1800) s += 20;
  else if (ageSec <= 3600) s += 10;
  // Stale with no volume gets penalised hard.
  else if (ageSec > 7200 && vol1h <= 0) s -= 30;
  else if (ageSec > 3600 && vol1h <= 0) s -= 10;

  // Volume momentum — real money moving
  if (vol1h >= 10000) s += 30;
  else if (vol1h >= 1000) s += 20;
  else if (vol1h >= 100) s += 12;
  else if (vol1h >= 10) s += 6;
  else if (vol1h > 0) s += 3;

  // 24h vol as a fallback signal
  if (vol1h <= 0 && vol24h >= 500) s += 5;

  // Tx activity
  if (tx >= 100) s += 10;
  else if (tx >= 20) s += 6;
  else if (tx >= 5) s += 3;

  // Trend — hot means volume is growing
  if (m.volumeTrend === "hot") s += 15;
  else if (m.volumeTrend === "cooling") s += 5;

  // Stage — early/active stages preferred for opportunities
  if (m.stage === "momentum" || m.stage === "copycat") s += 12;
  else if (m.stage === "recognition") s += 8;
  else if (m.stage === "naming") s += 5;
  else if (m.stage === "peak") s += 4;

  // Size as a tiebreak
  if (m.launchCount >= 20) s += 8;
  else if (m.launchCount >= 10) s += 5;
  else if (m.launchCount >= 5) s += 3;

  return s;
}

export function sortMetasByHeat(
  metas: MetaTrack[],
  _levels?: Map<string, number>,
): MetaTrack[] {
  const nowSec = Math.floor(Date.now() / 1000);
  return [...metas].sort((a, b) => metaHotScore(b, nowSec) - metaHotScore(a, nowSec));
}
