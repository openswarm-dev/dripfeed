"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MetaStage, MetaTrack, LaunchRecord } from "@/lib/narra/types";
import { fmtAge, formatCompact, capitalize } from "@/lib/narra/format";
import { getLaunchDisplay, shouldShowLaunch } from "@/lib/narra/launchDisplay";
import { BetttrCard, PanelTitle } from "@/components/ui/BetttrCard";
import { TokenImage } from "@/components/ui/TokenImage";
import { LiveAge } from "@/components/narra/LiveAge";
import { HoverOverlay } from "@/components/narra/HoverOverlay";
import { useMetaHeat, sortMetasByHeat } from "@/lib/narra/useMetaHeat";
import { metricDir, metaSnapshot, computeOpportunityScore, opportunityTier, type TimelineEvent } from "@/lib/narra/heat";
import { displayTheme } from "@/lib/narra/displayTheme";
import { AnimatedFeed } from "@/components/narra/AnimatedFeed";
import { OpportunityFeedCard } from "@/components/narra/OpportunityFeedCard";
import { PumpFunButton } from "@/components/ui/PumpFunButton";
import { useBetttrAuth } from "@/components/narra/AccountModal";
import { DeployTokenModal } from "@/components/narra/DeployTokenModal";
import { RadarNav, isBootDone, markBootDone } from "@/components/narra/RadarNav";

const LOGO_SRC = "/logos/Betttr.png";
const STAGE_LABELS: Record<string, string> = {
  spark: "Spark",
  naming: "Naming",
  recognition: "Recognition",
  copycat: "Copycat wave",
  momentum: "Money follows",
  peak: "Peak",
  fade: "Fade",
  launch: "Launch",
};

function DecayMeter({ m, compact }: { m: MetaTrack; compact?: boolean }) {
  const trendClass = m.volumeTrend ?? "cooling";
  const rate = m.dyingRate ?? 0;
  const volLine = m.totalVolumeUsd1h > 0 || m.totalVolumeUsd24h > 0
    ? `$${formatCompact(m.totalVolumeUsd1h)}/1h vol · $${formatCompact(m.totalVolumeUsd24h)}/24h`
    : `${m.launchRateNow ?? 0}/hr now · ${m.launchRatePeak ?? 0}/hr peak`;

  if (compact) {
    return (
      <div className="decay-meter compact">
        <div className="decay-bar" title={`Trend decay ${rate}%`}>
          <div className={`decay-fill ${trendClass}`} style={{ width: `${rate}%` }} />
        </div>
        <span className={`decay-pct ${trendClass}`}>{rate}%</span>
      </div>
    );
  }

  return (
    <div className="decay-meter">
      <div className="decay-head">
        <span>Trend decay</span>
        <span className={`decay-pct ${trendClass}`}>{rate}% · {trendClass}</span>
      </div>
      <div className="decay-bar">
        <div className={`decay-fill ${trendClass}`} style={{ width: `${rate}%` }} />
      </div>
      <div className="decay-sub">
        {volLine}{m.totalTxns24h ? ` · ${m.totalTxns24h} txns/24h` : ""}
      </div>
    </div>
  );
}

function metaMatchesStage(m: MetaTrack, stage: MetaStage, sparks: { text: string; terms?: string[] }[]): boolean {
  if (m.stage === stage) return true;
  if (stage !== "spark") return false;
  const theme = m.theme.toLowerCase();
  return sparks.some((s) => {
    const text = s.text.toLowerCase();
    if (text.includes(theme) || theme.includes(text.slice(0, 24))) return true;
    return (s.terms ?? []).some((t) => theme.includes(t.toLowerCase()) || t.toLowerCase().includes(theme));
  });
}

function sortMetasByStage(metas: MetaTrack[], stageFilter: MetaStage | null, sparks: { text: string; terms?: string[] }[]) {
  if (!stageFilter) return metas;
  return [...metas].sort((a, b) => {
    const am = metaMatchesStage(a, stageFilter, sparks) ? 0 : 1;
    const bm = metaMatchesStage(b, stageFilter, sparks) ? 0 : 1;
    return am - bm;
  });
}

function MetaCard({
  m,
  extraClass,
  stageFilter,
  sparks,
  heatIntensity = 0,
  surging = false,
  prevSnapshot,
  focusHit = false,
  focusDimmed = false,
  onHover,
  onHoverEnd,
  onDeploy,
}: {
  m: MetaTrack;
  extraClass?: string;
  stageFilter?: MetaStage | null;
  sparks?: { text: string; terms?: string[] }[];
  heatIntensity?: number;
  surging?: boolean;
  prevSnapshot?: ReturnType<typeof metaSnapshot>;
  focusHit?: boolean;
  focusDimmed?: boolean;
  onHover: (m: MetaTrack, el: HTMLElement) => void;
  onHoverEnd: () => void;
  onDeploy?: (m: MetaTrack) => void;
}) {
  const stageHit = stageFilter
    ? metaMatchesStage(m, stageFilter, sparks ?? [])
    : false;
  const stageDimmed = !!stageFilter && !stageHit;
  const hit = stageHit || focusHit;
  const dimmed = focusDimmed || (stageDimmed && !focusHit);
  const prev = prevSnapshot ?? metaSnapshot(m);
  const countDir = metricDir(m.launchCount, prev.launchCount);
  const volDir = metricDir(m.totalVolumeUsd1h, prev.totalVolumeUsd1h);
  const txDir = metricDir(m.totalTxns24h, prev.totalTxns24h);
  const glow = 0.08 + heatIntensity * 0.28 + (focusHit ? 0.2 : 0);

  return (
    <button
      type="button"
      className={`meta-item meta-item--compact ${extraClass ?? ""} ${hit ? "stage-hit" : ""} ${focusHit ? "opp-focus-hit" : ""} ${dimmed ? "stage-dimmed" : ""} ${surging ? "meta-item--surging" : ""}`}
      style={{ boxShadow: `0 0 0 1px rgba(200, 240, 255, ${glow})` }}
      onMouseEnter={(e) => onHover(m, e.currentTarget)}
      onMouseLeave={onHoverEnd}
    >
      <div className="meta-row-top">
        <TokenImage src={m.sampleImages[0]} size={28} priority />
        <div className="meta-row-main">
          <span className="theme">{displayTheme(m.theme)}</span>
          <span className="meta-key-stat">
            <strong className={countDir === "up" ? "metric-up" : ""}>{m.launchCount}</strong> coins
            {m.totalVolumeUsd1h > 0 ? (
              <> · <strong className={`metric-vol ${volDir === "up" ? "metric-up" : ""}`}>${formatCompact(m.totalVolumeUsd1h)}</strong>/1h vol</>
            ) : m.totalVolumeUsd24h > 0 ? (
              <> · <strong className="metric-vol">${formatCompact(m.totalVolumeUsd24h)}</strong>/24h vol</>
            ) : null}
            {m.totalTxns24h > 0 ? <> · <strong className={txDir === "up" ? "metric-up" : ""}>{m.totalTxns24h}</strong> tx</> : null}
          </span>
        </div>
        <div className="meta-card-actions">
          <span className="opp-badge stage-pill">{m.stageLabel}</span>
          <span
            role="button"
            tabIndex={0}
            className="meta-deploy-btn"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onDeploy?.(m);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                e.preventDefault();
                onDeploy?.(m);
              }
            }}
          >
            DEPLOY
          </span>
        </div>
      </div>
      <div className="meta-row-sub">
        <span>Newest add <strong><LiveAge ts={m.lastSeen} /></strong> ago</span>
        {m.uniqueCreators > 1 && <span>{m.uniqueCreators} deployers</span>}
      </div>
    </button>
  );
}

function NarraLoader({ onDone }: { onDone: () => void }) {
  const [geyser, setGeyser] = useState<"wait" | "loading" | "done">("loading");
  const [x, setX] = useState<"wait" | "loading" | "done">("wait");
  const [meta, setMeta] = useState<"wait" | "loading" | "done">("wait");
  const [progress, setProgress] = useState(0);
  const [out, setOut] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const finishedRef = useRef(false);

  useEffect(() => {
    const t1 = setTimeout(() => setGeyser("done"), 900);
    const t2 = setTimeout(() => setX("loading"), 1100);
    const t3 = setTimeout(() => setX("done"), 2000);
    const t4 = setTimeout(() => setMeta("loading"), 2200);
    const t5 = setTimeout(() => setMeta("done"), 3200);
    return () => [t1, t2, t3, t4, t5].forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const started = performance.now();
    const iv = setInterval(() => {
      const elapsed = performance.now() - started;
      // Ease to 92% over ~3.2s, never bounce backward.
      const target = Math.min(92, (elapsed / 3200) * 92);
      setProgress((p) => (target > p ? target : p));
    }, 50);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const finish = () => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      setGeyser("done");
      setX("done");
      setMeta("done");
      setProgress(100);
      setTimeout(() => {
        setOut(true);
        setTimeout(() => onDoneRef.current(), 450);
      }, 400);
    };

    // Minimum show time so steps can play; then exit once.
    const t = setTimeout(finish, 3800);
    return () => clearTimeout(t);
  }, []);

  const step = (id: string, status: typeof geyser, label: string) => (
    <div className={`loader-step ${status === "loading" ? "active" : ""} ${status === "done" ? "done" : ""}`} id={`loader-${id}`}>
      <div className="loader-step-left">
        <span className="loader-dot" />
        <span className="loader-step-label">{label}</span>
      </div>
      <div className="loader-action">
        {status === "loading" && <span className="loader-wait">Connecting…</span>}
        {status === "done" && <span className="loader-check">✓ Connected</span>}
        {status === "wait" && <span className="loader-wait">Waiting…</span>}
      </div>
    </div>
  );

  return (
    <div className={`loader ${out ? "loader-out" : ""}`}>
      <div className="loader-orb loader-orb-a animate-drift" />
      <div className="loader-orb loader-orb-b animate-drift-delay" />
      <div className="loader-orb loader-orb-c animate-drift-slow" />
      <div className="grid-dots-dark loader-grid" />

      <div className="loader-inner">
        <div className="loader-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_SRC} alt="Betttr.xyz" className="auth-overlay-logo" style={{ margin: "0 auto 12px" }} />
          <p className="loader-sub">Real-time meta radar · pump.fun · trader psychology</p>
        </div>

        <div className="loader-card">
          <div className="rainbow-bg loader-stripe" />
          <div className="loader-steps">
            {step("geyser", geyser, "Geyser live stream")}
            {step("x", x, "X social sparks")}
            {step("meta", meta, "Meta psychology engine")}
          </div>
        </div>

        <p className="loader-foot">Betttr.xyz · non-custodial reads only</p>
      </div>

      <div className="progress-rail">
        <div className="rainbow-bg progress-fill" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

export default function NarraDashboard({
  state,
  error,
  loading,
  loaderDone: _loaderDone,
  onLoaderDone,
  skipBoot = false,
}: {
  state: import("@/lib/narra/types").NarraState | null;
  error: string | null;
  loading: boolean;
  loaderDone: boolean;
  onLoaderDone: () => void;
  onRefreshLaunch?: (mint: string) => void;
  skipBoot?: boolean;
}) {
  const [showLoader, setShowLoader] = useState(() => !(skipBoot || isBootDone()));
  const [stageFilter, setStageFilter] = useState<MetaStage | null>(null);
  const [appVisible, setAppVisible] = useState(() => skipBoot || isBootDone());
  const [deployMeta, setDeployMeta] = useState<MetaTrack | null>(null);
  const auth = useBetttrAuth();
  const [hoverTarget, setHoverTarget] = useState<{
    kind: "meta";
    id: string;
    rect: DOMRect;
  } | null>(null);
  const [focusOppId, setFocusOppId] = useState<string | null>(null);
  const hoverHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showMetaHover = (m: MetaTrack, el: HTMLElement) => {
    if (hoverHideRef.current) clearTimeout(hoverHideRef.current);
    setHoverTarget({ kind: "meta", id: m.id, rect: el.getBoundingClientRect() });
  };

  const hideHover = () => {
    hoverHideRef.current = setTimeout(() => setHoverTarget(null), 150);
  };

  const cancelHideHover = () => {
    if (hoverHideRef.current) clearTimeout(hoverHideRef.current);
  };

  const metas = state?.metas ?? null;
  const launches = state?.launches ?? [];
  const sparks = state?.sparks ?? [];
  const geyserStats = state?.geyserStats;
  const live = state?.live;
  const feeds = live?.feeds;

  const resolvedHover = useMemo(() => {
    if (!hoverTarget) return null;
    const pool = metas
      ? [...(metas.emerging ?? []), ...metas.forming, ...metas.active]
      : [];
    const m = pool.find((x) => x.id === hoverTarget.id);
    if (!m) return null;
    return { kind: "meta" as const, m, rect: hoverTarget.rect };
  }, [hoverTarget, metas]);

  const allMetasForHeat = useMemo(
    () => metas ? [...(metas.emerging ?? []), ...metas.forming, ...metas.active] : [],
    [metas],
  );
  const { levels: heatLevels, intensities: heatIntensities, surging, prevSnapshots } = useMetaHeat(allMetasForHeat);
  const seenEventsRef = useRef<Set<string>>(new Set());
  const [flashKeys, setFlashKeys] = useState<Set<string>>(new Set());

  const dismissLoader = useCallback(() => {
    setShowLoader(false);
    setAppVisible(true);
    markBootDone();
    onLoaderDone();
  }, [onLoaderDone]);

  useEffect(() => {
    if (loading) return;
    if (error) {
      dismissLoader();
      return;
    }
    // Don't hard-cut the branded loader when SSE connects early —
    // NarraLoader finishes on its own timeline via dismissLoader.
  }, [loading, error, dismissLoader]);

  const formingClusters = useMemo(() => {
    if (!metas) return [];
    const staged = sortMetasByStage([...(metas.emerging ?? []), ...metas.forming], stageFilter, sparks);
    return sortMetasByHeat(staged);
  }, [metas, stageFilter, sparks]);

  const activeMetas = useMemo(() => {
    if (!metas) return [];
    const staged = sortMetasByStage(metas.active, stageFilter, sparks);
    return sortMetasByHeat(staged);
  }, [metas, stageFilter, sparks]);

  const hero = activeMetas[0]
    ?? formingClusters[0]
    ?? metas?.emerging?.[0]
    ?? metas?.all[0]
    ?? null;

  const timelineEvents = useMemo(() => {
    const events: TimelineEvent[] = [];
    const seenMints = new Set<string>();
    const seenMetas = new Set<string>();

    for (const l of launches) {
      if (!l.blockTime || seenMints.has(l.mint)) continue;
      seenMints.add(l.mint);
      const parts = [
        l.primaryNarrative && l.primaryNarrative !== "unknown" ? l.primaryNarrative : null,
        l.marketCapUsd ? `$${formatCompact(l.marketCapUsd)} mcap` : null,
        l.volumeUsd1h ? `$${formatCompact(l.volumeUsd1h)}/1h vol` : null,
        l.txns24h ? `${l.txns24h} tx` : null,
        l.bonded ? "graduated" : null,
      ].filter(Boolean);
      const label = parts.length ? parts.join(" · ") : "New pump.fun create";
      const score = computeOpportunityScore({
        at: l.blockTime,
        stage: "launch",
        isLaunch: true,
        label,
        marketCapUsd: l.marketCapUsd,
        volumeUsd1h: l.volumeUsd1h,
        txns24h: l.txns24h,
        holderCount: l.holderCount,
      }, null);
      events.push({
        feedId: `launch:${l.mint}`,
        at: l.blockTime,
        stage: "launch",
        theme: l.symbol ?? l.name ?? "New token",
        label,
        metaId: null,
        image: l.image,
        isLaunch: true,
        opportunityScore: score,
        tier: opportunityTier(score),
      });
      if (events.length >= 60) break;
    }

    if (metas) {
      for (const m of [...(metas.emerging ?? []), ...metas.forming, ...metas.active]) {
        if (seenMetas.has(m.id)) continue;
        seenMetas.add(m.id);
        const stats = [
          `${m.launchCount} coins`,
          m.totalVolumeUsd1h > 0 ? `$${formatCompact(m.totalVolumeUsd1h)}/1h vol` : null,
          m.totalTxns24h > 0 ? `${m.totalTxns24h} tx` : null,
        ].filter(Boolean).join(" · ");
        const label = m.psychologyLabel || stats;
        const score = computeOpportunityScore({
          at: m.lastSeen,
          stage: m.stage,
          label,
          stats,
        }, m);
        events.push({
          feedId: `meta:${m.id}`,
          at: m.lastSeen,
          stage: m.stage,
          theme: m.theme,
          label,
          metaId: m.id,
          image: m.sampleImages[0],
          stats,
          opportunityScore: score,
          tier: opportunityTier(score),
        });
      }
    }

    // Newest activity first — score only gates inclusion, does not reshuffle every tick.
    const quality = events
      .filter((e) => {
        if (e.isLaunch) return e.tier >= 1 || e.opportunityScore >= 3;
        return e.tier >= 1 || e.opportunityScore >= 4;
      })
      .sort((a, b) => {
        if (b.at !== a.at) return b.at - a.at;
        return b.opportunityScore - a.opportunityScore;
      })
      .slice(0, 80);

    return quality;
  }, [launches, metas]);

  const opportunityFeed = timelineEvents;

  const focusedOpportunity = useMemo(
    () => (focusOppId ? opportunityFeed.find((e) => e.feedId === focusOppId) ?? null : null),
    [focusOppId, opportunityFeed],
  );

  const focusMetaIds = useMemo(() => {
    if (!focusedOpportunity || !metas) return null;
    const ids = new Set<string>();
    if (focusedOpportunity.metaId) {
      ids.add(focusedOpportunity.metaId);
    }
    if (focusedOpportunity.isLaunch && focusedOpportunity.feedId.startsWith("launch:")) {
      const mint = focusedOpportunity.feedId.slice("launch:".length);
      for (const m of [...(metas.emerging ?? []), ...metas.forming, ...metas.active]) {
        if (m.tokens.some((t) => t.mint === mint)) ids.add(m.id);
        // Same visual cluster as the launch image
        if (focusedOpportunity.image && m.sampleImages.includes(focusedOpportunity.image)) {
          ids.add(m.id);
        }
      }
    }
    // Also match by theme when metaId drifted after a merge/recalc
    if (focusedOpportunity.metaId || !focusedOpportunity.isLaunch) {
      const theme = focusedOpportunity.theme.toLowerCase();
      for (const m of [...(metas.emerging ?? []), ...metas.forming, ...metas.active]) {
        if (m.id === focusedOpportunity.metaId) continue;
        const mt = m.theme.toLowerCase();
        if (mt === theme || mt.includes(theme) || theme.includes(mt.split("—")[0]!.trim())) {
          if (m.launchCount >= 2) ids.add(m.id);
        }
      }
    }
    return ids;
  }, [focusedOpportunity, metas]);

  const toggleOpportunityFocus = (ev: TimelineEvent) => {
    setFocusOppId((prev) => (prev === ev.feedId ? null : ev.feedId));
  };

  const opportunityFeedItems = useMemo(
    () => opportunityFeed.map((ev) => ({
      ...ev,
      id: ev.feedId,
    })),
    [opportunityFeed],
  );

  const formingFeedItems = useMemo(
    () => formingClusters.map((m) => ({ ...m, id: m.id })),
    [formingClusters],
  );

  const activeFeedItems = useMemo(
    () => activeMetas.map((m) => ({ ...m, id: m.id })),
    [activeMetas],
  );

  const visibleLaunches = useMemo(
    () => launches.filter((l) => shouldShowLaunch(l)),
    [launches],
  );

  const launchFeedItems = useMemo(
    () => visibleLaunches.slice(0, 80).map((l) => ({ ...l, id: l.mint })),
    [visibleLaunches],
  );

  useEffect(() => {
    const next = new Set<string>();
    const fresh = new Set<string>();
    for (const ev of timelineEvents.slice(0, 24)) {
      const key = ev.feedId;
      next.add(key);
      if (!seenEventsRef.current.has(key)) fresh.add(key);
    }
    seenEventsRef.current = next;
    if (fresh.size) {
      setFlashKeys((prev) => new Set([...prev, ...fresh]));
      const t = setTimeout(() => {
        setFlashKeys((prev) => {
          const n = new Set(prev);
          for (const k of fresh) n.delete(k);
          return n;
        });
      }, 4000);
      return () => clearTimeout(t);
    }
  }, [timelineEvents]);

  if (showLoader) {
    return <NarraLoader onDone={dismissLoader} />;
  }

  return (
    <div className="radar-root">
      <RadarNav active="radar" state={state} />

      <div className="ambient" aria-hidden="true">
        <div className="ambient-orb orb-a animate-drift" />
        <div className="ambient-orb orb-b animate-drift-delay" />
        <div className="ambient-orb orb-c animate-drift-slow" />
        <div className="grid-dots-dark ambient-grid" />
        <div className="noise-overlay-dark ambient-noise" />
      </div>

      <div className={`app ${appVisible ? "app-visible" : ""}`}>
        {error && (
          <div className="radar-error">
            {error}
            <br />
            <span>
              Local: run <code>npm run dev</code> in <code>DEVSNIPER/narra</code> · Railway: set <code>RADAR_API_URL</code> on the frontend service
            </span>
          </div>
        )}

        <div className="context-bar">
          <BetttrCard accent="hero">
            {!hero || !metas ? (
              <div className="hero-inner">
                <div className="hero-theme rainbow-text">
                  {launches.length > 0
                    ? `Live · ${launches.length} creates streaming`
                    : (metas?.insight ?? "Scanning pump.fun…")}
                </div>
                {launches.length > 0 && (
                  <div className="hero-stats">
                    <div className="hero-stat">
                      <span className="val t-metric">{launches.length}</span>
                      <span className="lbl">creates</span>
                    </div>
                    <div className="hero-stat">
                      <span className="val">{geyserStats?.perMinute ?? 0}/min</span>
                      <span className="lbl">rate</span>
                    </div>
                    <div className="hero-stat">
                      <span className="val">{metas?.activeMetaCount ?? 0}</span>
                      <span className="lbl">active</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="hero-inner">
                <div className="hero-theme rainbow-text">&quot;{hero.theme}&quot;</div>
                <div className="hero-stats">
                  <div className="hero-stat">
                    <span className="val t-metric">{hero.launchCount}</span>
                    <span className="lbl">tokens</span>
                  </div>
                  <div className="hero-stat">
                    <span className="val t-metric">${formatCompact(hero.totalVolumeUsd1h || hero.totalVolumeUsd24h)}</span>
                    <span className="lbl">cluster vol</span>
                  </div>
                  <div className="hero-stat">
                    <span className="val"><LiveAge ts={hero.firstSeen} /></span>
                    <span className="lbl">since 1st</span>
                  </div>
                  <div className="hero-stat">
                    <span className="val"><LiveAge ts={hero.lastSeen} /></span>
                    <span className="lbl">newest add</span>
                  </div>
                </div>
                <div className="stage-badge">
                  <span className="num rainbow-text">{hero.stageIndex + 1}/7</span>
                  <span className="name">{hero.stageLabel}</span>
                </div>
              </div>
            )}
          </BetttrCard>

          <BetttrCard accent="timeline">
            {metas && (
              <div className="stage-pipeline">
                {metas.stages.map((s) => {
                  const tokenCount = metas.stageTokenCounts?.[s.id as MetaStage]
                    ?? [...(metas.emerging ?? []), ...metas.forming, ...metas.active, ...(metas.fading ?? [])]
                      .filter((m) => m.stage === s.id)
                      .reduce((sum, m) => sum + m.launchCount, 0);
                  let cls = "stage-step stage-step--holo";
                  if (hero && s.id === hero.stage) cls += " current";
                  if (stageFilter === s.id) cls += " filter-on";
                  if (tokenCount > 0) cls += " has-count";
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={cls}
                      title={`${s.label}: ${tokenCount} tokens — ${s.description}`}
                      onClick={() => {
                        setStageFilter((prev) => (prev === s.id ? null : s.id));
                        setFocusOppId(null);
                      }}
                    >
                      <span className="opp-badge stage-step-badge">{s.label.toUpperCase()}</span>
                      <div className="step-count">{tokenCount}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </BetttrCard>
        </div>

        <HoverOverlay target={resolvedHover} onMouseEnter={cancelHideHover} onMouseLeave={hideHover}>
        <main className="dashboard">
          <div className="row-main">
            <BetttrCard accent="timeline">
              <PanelTitle count={opportunityFeed.filter((e) => e.tier >= 2).length} variant="live">Opportunity feed</PanelTitle>
              <p className="panel-hint">Strongest setups · newest first</p>
              <div className="card-scroll" id="timelineFeed">
                {!opportunityFeed.length ? (
                  <p className="empty">Watching for momentum…</p>
                ) : (
                  <AnimatedFeed
                    className="animated-feed"
                    items={opportunityFeedItems}
                    renderItem={(ev) => (
                      <OpportunityFeedCard
                        ev={ev}
                        flash={flashKeys.has(ev.feedId)}
                        selected={focusOppId === ev.feedId}
                        onSelect={toggleOpportunityFocus}
                      />
                    )}
                  />
                )}
              </div>
            </BetttrCard>

            <BetttrCard accent="forming">
              <PanelTitle count={metas?.formingCount ?? 0} variant="warn">Building</PanelTitle>
              <p className="panel-hint">Clusters forming — hottest rise to the top</p>
              <div className="card-scroll">
                {!formingClusters.length ? (
                  <p className="empty">Watching for 5+ token clusters…</p>
                ) : (
                  <AnimatedFeed
                    className="animated-feed"
                    items={formingFeedItems}
                    renderItem={(m) => (
                      <MetaCard
                        m={m}
                        extraClass={m.isEmerging ? "emerging" : "new-forming"}
                        stageFilter={stageFilter}
                        sparks={sparks}
                        heatIntensity={heatIntensities.get(m.id) ?? 0}
                        surging={surging.has(m.id)}
                        prevSnapshot={prevSnapshots.get(m.id)}
                        focusHit={!!focusMetaIds?.has(m.id)}
                        focusDimmed={!!focusMetaIds && !focusMetaIds.has(m.id)}
                        onHover={showMetaHover}
                        onHoverEnd={hideHover}
                        onDeploy={setDeployMeta}
                      />
                    )}
                  />
                )}
              </div>
            </BetttrCard>

            <BetttrCard accent="active">
              <PanelTitle count={metas?.activeMetaCount ?? 0} variant="live">Hot right now</PanelTitle>
              <p className="panel-hint">Confirmed metas — hover for detail</p>
              <div className="card-scroll">
                {!activeMetas.length ? (
                  <p className="empty">No active metas in the last 6 hours</p>
                ) : (
                  <AnimatedFeed
                    className="animated-feed"
                    items={activeFeedItems}
                    renderItem={(m) => (
                      <MetaCard
                        m={m}
                        stageFilter={stageFilter}
                        sparks={sparks}
                        heatIntensity={heatIntensities.get(m.id) ?? 0}
                        surging={surging.has(m.id)}
                        prevSnapshot={prevSnapshots.get(m.id)}
                        focusHit={!!focusMetaIds?.has(m.id)}
                        focusDimmed={!!focusMetaIds && !focusMetaIds.has(m.id)}
                        onHover={showMetaHover}
                        onHoverEnd={hideHover}
                        onDeploy={setDeployMeta}
                      />
                    )}
                  />
                )}
              </div>
            </BetttrCard>

            <BetttrCard accent="launch">
              <PanelTitle count={visibleLaunches.length} variant="live">New launches</PanelTitle>
              <p className="panel-hint">Live creates from Geyser</p>
              <div className="card-scroll">
                {!visibleLaunches.length ? (
                  <p className="empty">Waiting for CreateV2 stream…</p>
                ) : (
                  <AnimatedFeed
                    className="animated-feed"
                    items={launchFeedItems}
                    animateReorder={false}
                    renderItem={(l) => <LaunchRow l={l} />}
                  />
                )}
              </div>
            </BetttrCard>
          </div>
        </main>
        </HoverOverlay>
      </div>
      <DeployTokenModal
        open={!!deployMeta}
        onClose={() => setDeployMeta(null)}
        meta={deployMeta}
        auth={auth}
      />
    </div>
  );
}

function LaunchRow({ l }: { l: LaunchRecord }) {
  const { label, sub, pending } = getLaunchDisplay(l);
  const prevRef = useRef<Partial<LaunchRecord>>({});
  const prev = prevRef.current;
  const mcapDir = metricDir(l.marketCapUsd, prev.marketCapUsd);
  const volDir = metricDir(l.volumeUsd1h, prev.volumeUsd1h);
  const txDir = metricDir(l.txns24h, prev.txns24h);
  const holderDir = metricDir(l.holderCount, prev.holderCount);
  prevRef.current = {
    marketCapUsd: l.marketCapUsd,
    volumeUsd1h: l.volumeUsd1h,
    txns24h: l.txns24h,
    holderCount: l.holderCount,
  };

  return (
    <div className={`launch-row ${pending ? "launch-row--pending" : ""}`}>
      <TokenImage src={l.image} size={30} priority />
      <div className="launch-meta">
        <div className="sym">
          {label}
          {l.isCreateV2 && <span className="v2-tag">V2</span>}
          {l.bonded && <span className="bond-tag bonded">Graduated</span>}
          {!l.bonded && l.bondingProgressPct != null && l.bondingProgressPct > 0 && (
            <span className="bond-tag">{l.bondingProgressPct}%</span>
          )}
          {sub && <span className="name-inline">{sub}</span>}
        </div>
      </div>
      <div className="launch-side">
        {l.blockTime && (
          <span className="age-tag launch-age"><LiveAge ts={l.blockTime} /></span>
        )}
        {l.marketCapUsd ? (
          <span className={`mcap-tag ${mcapDir === "up" ? "metric-up" : ""}`}>${formatCompact(l.marketCapUsd)}</span>
        ) : null}
        {l.txns24h ? (
          <span className={`tx-tag ${txDir === "up" ? "metric-up" : ""}`}>{l.txns24h} tx</span>
        ) : null}
        {l.holderCount ? (
          <span className={`holder-tag ${holderDir === "up" ? "metric-up" : ""}`}>{l.holderCount}h</span>
        ) : null}
        {l.volumeUsd1h ? (
          <span className={`vol-tag ${volDir === "up" ? "metric-up" : ""}`}>${formatCompact(l.volumeUsd1h)}</span>
        ) : null}
        <PumpFunButton mint={l.mint} size={22} />
      </div>
    </div>
  );
}
