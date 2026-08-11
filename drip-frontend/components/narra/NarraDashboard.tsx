"use client";

import { useEffect, useMemo, useState } from "react";
import type { MetaStage, MetaTrack, LaunchRecord } from "@/lib/narra/types";
import { fmtAge, fmtTime, formatCompact, capitalize, findMeta } from "@/lib/narra/format";
import { BetttrCard, PanelTitle } from "@/components/ui/BetttrCard";

const LOGO_SRC = "/logos/Betttr.png";
const STAGE_CLASS: Record<string, string> = {
  spark: "spark",
  naming: "spark",
  recognition: "",
  copycat: "copycat",
  momentum: "momentum",
  peak: "momentum",
  fade: "fade",
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

function ImageStrip({ images, max = 6, compact }: { images?: string[]; max?: number; compact?: boolean }) {
  if (!images?.length) return null;
  return (
    <div className={`meta-images ${compact ? "meta-images--compact" : ""}`}>
      {images.slice(0, max).map((url) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={url} src={url} alt="" loading="lazy" className="meta-thumb" />
      ))}
      {images.length > max && <span className="meta-more">+{images.length - max}</span>}
    </div>
  );
}

function MetaCard({
  m,
  selected,
  extraClass,
  stageFilter,
  sparks,
  onSelect,
}: {
  m: MetaTrack;
  selected: boolean;
  extraClass?: string;
  stageFilter?: MetaStage | null;
  sparks?: { text: string; terms?: string[] }[];
  onSelect: (id: string) => void;
}) {
  const stageHit = stageFilter
    ? metaMatchesStage(m, stageFilter, sparks ?? [])
    : false;
  const stageDimmed = !!stageFilter && !stageHit;

  return (
    <button
      type="button"
      className={`meta-item meta-item--compact ${extraClass ?? ""} ${selected ? "selected" : ""} ${stageHit ? "stage-hit" : ""} ${stageDimmed ? "stage-dimmed" : ""}`}
      onClick={() => onSelect(m.id)}
    >
      <ImageStrip images={m.sampleImages} max={4} compact />
      <div className="row1">
        <span className="theme">&quot;{m.theme}&quot;</span>
        <span className={`stage-pill ${STAGE_CLASS[m.stage] ?? ""}`}>{m.stageLabel}</span>
      </div>
      <div className="row2 meta-stats-line">
        <span><strong>{m.launchCount}</strong> tok</span>
        <span>{m.velocityPerHour}/hr</span>
        {m.totalVolumeUsd24h ? <span>${formatCompact(m.totalVolumeUsd24h)}</span> : null}
        <span className="meta-stats-sep">·</span>
        <span className="age-tag">1st <strong data-ts={m.firstSeen}>{fmtAge(m.firstSeenAgoSec)}</strong></span>
        <span className="age-tag">last <strong data-ts={m.lastSeen}>{fmtAge(m.lastSeenAgoSec)}</strong></span>
      </div>
      <DecayMeter m={m} compact />
      <div className="psych">{m.psychologyLabel}</div>
    </button>
  );
}

function NarraLoader({ onDone }: { onDone: () => void }) {
  const [geyser, setGeyser] = useState<"wait" | "loading" | "done">("loading");
  const [x, setX] = useState<"wait" | "loading" | "done">("wait");
  const [meta, setMeta] = useState<"wait" | "loading" | "done">("wait");
  const [progress, setProgress] = useState(0);
  const [out, setOut] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setGeyser("done"), 1400);
    const t2 = setTimeout(() => { setX("loading"); }, 1600);
    const t3 = setTimeout(() => setX("done"), 2800);
    const t4 = setTimeout(() => { setMeta("loading"); }, 3000);
    return () => [t1, t2, t3, t4].forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      setProgress((p) => Math.min(p + 1.5, 92));
    }, 60);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setGeyser("done");
      setX("done");
      setMeta("done");
      setProgress(100);
      setTimeout(() => {
        setOut(true);
        setTimeout(onDone, 550);
      }, 700);
    }, 6000);
    return () => clearTimeout(t);
  }, [onDone]);

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
  loaderDone,
  onLoaderDone,
}: {
  state: import("@/lib/narra/types").NarraState | null;
  error: string | null;
  loading: boolean;
  loaderDone: boolean;
  onLoaderDone: () => void;
}) {
  const [showLoader, setShowLoader] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<MetaStage | null>(null);
  const [appVisible, setAppVisible] = useState(false);

  const metas = state?.metas ?? null;
  const launches = state?.launches ?? [];
  const sparks = state?.sparks ?? [];
  const geyserStats = state?.geyserStats;
  const live = state?.live;
  const feeds = live?.feeds;

  useEffect(() => {
    if (loading) return;
    if (error) {
      setShowLoader(false);
      setAppVisible(true);
      return;
    }
    if (loaderDone) {
      setShowLoader(false);
      setAppVisible(true);
      onLoaderDone();
    }
  }, [loaderDone, loading, error, onLoaderDone]);

  useEffect(() => {
    const tick = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      document.querySelectorAll<HTMLElement>("[data-ts]").forEach((el) => {
        const ts = Number(el.dataset.ts);
        if (!ts) return;
        el.textContent = fmtAge(now - ts);
      });
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!metas || selectedId) return;
    const first = metas.active[0] ?? metas.forming[0] ?? metas.emerging?.[0] ?? metas.all[0];
    if (first) setSelectedId(first.id);
  }, [metas, selectedId]);

  const selected = metas && selectedId ? findMeta(metas, selectedId) : null;
  const hero = selected
    ?? metas?.active[0]
    ?? metas?.forming[0]
    ?? metas?.emerging?.[0]
    ?? metas?.all[0]
    ?? null;

  const formingClusters = metas ? sortMetasByStage([...(metas.emerging ?? []), ...metas.forming], stageFilter, sparks) : [];
  const activeMetas = metas ? sortMetasByStage(metas.active, stageFilter, sparks) : [];

  const stageFilterCount = useMemo(() => {
    if (!stageFilter || !metas) return 0;
    const all = [...(metas.emerging ?? []), ...metas.forming, ...metas.active];
    return all.filter((m) => metaMatchesStage(m, stageFilter, sparks)).length;
  }, [stageFilter, metas, sparks]);

  const timelineEvents: Array<{
    at: number;
    stage: string;
    theme: string;
    label: string;
    metaId: string | null;
    isSocial?: boolean;
  }> = [];

  for (const s of sparks) {
    timelineEvents.push({
      at: s.receivedAt,
      stage: "spark",
      theme: s.handle,
      label: s.text.slice(0, 100),
      metaId: null,
      isSocial: true,
    });
  }
  if (metas) {
    for (const m of [...(metas.emerging ?? []), ...metas.forming, ...metas.active]) {
      for (const ev of m.timeline) {
        timelineEvents.push({ ...ev, theme: m.theme, metaId: m.id });
      }
    }
  }
  timelineEvents.sort((a, b) => b.at - a.at);

  const progressPct = useMemo(() => {
    if (!metas) return 8;
    const active = metas.activeMetaCount ?? 0;
    const forming = metas.formingCount ?? 0;
    const rate = geyserStats?.perMinute ?? 0;
    return Math.min(100, 12 + active * 14 + forming * 8 + rate * 3);
  }, [metas, geyserStats?.perMinute]);

  if (showLoader) {
    return <NarraLoader onDone={() => { setShowLoader(false); setAppVisible(true); onLoaderDone(); }} />;
  }

  return (
    <div className="radar-root">
      <div className="radar-progress" aria-hidden="true">
        <div
          className="radar-progress__fill rainbow-bg"
          style={{ transform: `scaleX(${progressPct / 100})` }}
        />
      </div>

      <nav className="radar-nav">
        <div className="radar-nav__inner">
          <div className="radar-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO_SRC} alt="Betttr.xyz" className="radar-brand__logo" />
            <span className="radar-brand__title rainbow-text">Meta Radar</span>
          </div>
          <div className="radar-status">
            <div className={`radar-pill ${feeds?.geyser ? "radar-pill--live" : live?.connected ? "radar-pill--pending" : ""}`}>
              <span className="radar-pill__dot" />
              <span>
                {feeds?.geyser
                  ? `Geyser · ${geyserStats?.perMinute ?? 0}/min`
                  : live?.connected
                    ? "Geyser reconnecting…"
                    : state?.geyserEnabled === false
                      ? "Geyser disabled"
                      : "Geyser connecting…"}
              </span>
            </div>
            <div className={`radar-pill ${feeds?.tweetstream ? "radar-pill--live" : ""}`}>
              <span className="radar-pill__dot" />
              <span>{feeds?.tweetstream ? `X · ${sparks.length} sparks` : "X connecting…"}</span>
            </div>
            <div className="radar-pill radar-pill--stats">
              {metas
                ? `${launches.length} creates · ${metas.activeMetaCount} active · ${metas.formingCount} forming · ${capitalize(metas.dominantStage)}`
                : "—"}
            </div>
          </div>
        </div>
      </nav>

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
                      <span className="val">{sparks.length}</span>
                      <span className="lbl">sparks</span>
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
                    <span className="val t-metric">{hero.velocityPerHour}/h</span>
                    <span className="lbl">velocity</span>
                  </div>
                  <div className="hero-stat">
                    <span className="val" data-ts={hero.firstSeen}>{fmtAge(hero.firstSeenAgoSec)}</span>
                    <span className="lbl">since 1st</span>
                  </div>
                  <div className="hero-stat">
                    <span className="val" data-ts={hero.lastSeen}>{fmtAge(hero.lastSeenAgoSec)}</span>
                    <span className="lbl">last seen</span>
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
            {metas && hero && (
              <div className="stage-pipeline">
                {metas.stages.map((s, i) => {
                  const current = hero.stageIndex;
                  let cls = "stage-step";
                  if (i < current) cls += " done";
                  else if (i === current) cls += " current";
                  else cls += " future";
                  if (stageFilter === s.id) cls += " filter-on";
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={cls}
                      title={`Filter forming & active by ${s.label}`}
                      onClick={() => setStageFilter((prev) => (prev === s.id ? null : s.id))}
                    >
                      <div className="step-num">{i + 1}</div>
                      <div className="step-name">{s.label}</div>
                    </button>
                  );
                })}
              </div>
            )}
            {stageFilter && (
              <p className="stage-filter-hint">
                Showing <strong>{stageFilterCount}</strong> at <strong>{capitalize(stageFilter)}</strong>
                {" · "}
                <button type="button" className="stage-filter-clear" onClick={() => setStageFilter(null)}>clear</button>
              </p>
            )}
          </BetttrCard>
        </div>

        <main className="dashboard">
          <div className="row-top">
            <BetttrCard accent="spark">
              <PanelTitle count={sparks.length} variant="live">Social sparks</PanelTitle>
              <div className="card-scroll">
                {!sparks.length ? (
                  <p className="empty">Waiting for posts from watched X accounts…</p>
                ) : sparks.slice(0, 20).map((s) => (
                  <div key={s.id} className="spark-item">
                    <div className="handle">@{s.handle} · {s.kind}</div>
                    <div className="text">{s.text.slice(0, 140)}{s.text.length > 140 ? "…" : ""}</div>
                    <div className="time">
                      {fmtTime(s.receivedAt)}
                      {s.link && (
                        <> · <a href={s.link} target="_blank" rel="noopener noreferrer" data-cursor-hover>view</a></>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </BetttrCard>

            <BetttrCard accent="forming">
              <PanelTitle count={metas?.formingCount ?? 0} variant="warn">Forming</PanelTitle>
              <div className="card-scroll">
                {!formingClusters.length ? (
                  <p className="empty">Watching for 2+ token clusters…</p>
                ) : formingClusters.map((m) => (
                  <MetaCard
                    key={m.id}
                    m={m}
                    selected={selectedId === m.id}
                    extraClass={m.isEmerging ? "emerging" : "new-forming"}
                    stageFilter={stageFilter}
                    sparks={sparks}
                    onSelect={setSelectedId}
                  />
                ))}
              </div>
            </BetttrCard>

            <BetttrCard accent="active">
              <PanelTitle count={metas?.activeMetaCount ?? 0} variant="live">Active</PanelTitle>
              <div className="card-scroll">
                {!metas?.active.length ? (
                  <p className="empty">No active metas in the last 6 hours</p>
                ) : activeMetas.map((m) => (
                  <MetaCard
                    key={m.id}
                    m={m}
                    selected={selectedId === m.id}
                    stageFilter={stageFilter}
                    sparks={sparks}
                    onSelect={setSelectedId}
                  />
                ))}
              </div>
            </BetttrCard>

            <BetttrCard accent="launch">
              <PanelTitle count={launches.length} variant="live">Live creates</PanelTitle>
              <p className="rate-line" id="launchRate">
                {geyserStats?.perMinute ?? 0} creates/min · {geyserStats?.createsParsed ?? 0} parsed from {geyserStats?.pumpTxSeen ?? 0} pump txs
              </p>
              <div className="card-scroll">
                {!launches.length ? (
                  <p className="empty">Waiting for CreateV2 stream…</p>
                ) : launches.slice(0, 60).map((l) => (
                  <LaunchRow key={l.mint + l.signature} l={l} />
                ))}
              </div>
            </BetttrCard>
          </div>

          <div className="row-bottom">
            <BetttrCard accent="detail">
              <PanelTitle>Meta detail</PanelTitle>
              <div className="card-scroll">
                {!selected ? (
                  <p className="empty">Select a meta from Forming or Active</p>
                ) : (
                  <MetaDetail m={selected} />
                )}
              </div>
            </BetttrCard>

            <BetttrCard accent="timeline">
              <PanelTitle>Timeline</PanelTitle>
              <div className="card-scroll" id="timelineFeed">
                {!timelineEvents.length ? (
                  <p className="empty">No timeline events yet</p>
                ) : timelineEvents.slice(0, 50).map((ev, i) => (
                  <button
                    key={`${ev.at}-${i}`}
                    type="button"
                    className="timeline-event"
                    data-cursor-hover={ev.metaId ? true : undefined}
                    onClick={() => ev.metaId && setSelectedId(ev.metaId)}
                  >
                    <span className="time">{fmtTime(ev.at)}</span>
                    <span className="label">
                      <span className="stage-tag">{ev.stage}</span>
                      {ev.isSocial ? (
                        <strong>@{ev.theme}</strong>
                      ) : (
                        <strong>&quot;{ev.theme}&quot;</strong>
                      )}{" "}
                      — {ev.label}
                    </span>
                  </button>
                ))}
              </div>
            </BetttrCard>
          </div>
        </main>
      </div>
    </div>
  );
}

function LaunchRow({ l }: { l: LaunchRecord }) {
  const label = l.symbol || l.name || l.mint.slice(0, 8);
  const sub = l.name && l.symbol && l.name !== l.symbol ? l.name : `${l.mint.slice(0, 16)}…`;
  const ageSec = l.blockTime ? Math.floor(Date.now() / 1000) - l.blockTime : null;

  return (
    <div className="launch-row">
      {l.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={l.image} alt="" loading="lazy" />
      ) : (
        <div className="placeholder-img">?</div>
      )}
      <div className="launch-meta">
        <div className="sym">
          {label}
          {l.isCreateV2 && <span className="v2-tag">V2</span>}
        </div>
        <div className="name-line">{sub}</div>
      </div>
      <div className="launch-side">
        {l.blockTime && (
          <span className="age-tag launch-age" data-ts={l.blockTime}>{fmtAge(ageSec)}</span>
        )}
        {l.volumeUsd1h ? <span className="vol-tag">${formatCompact(l.volumeUsd1h)}</span> : null}
        <a href={`https://pump.fun/coin/${l.mint}`} target="_blank" rel="noopener noreferrer" title="Open on pump.fun" data-cursor-hover>↗</a>
      </div>
    </div>
  );
}

function MetaDetail({ m }: { m: MetaTrack }) {
  return (
    <>
      <div className="detail-section">
        <div className="detail-theme rainbow-text">&quot;{m.theme}&quot;</div>
        <div className="detail-timers">
          <span className="age-tag">Narrative first seen <strong data-ts={m.firstSeen}>{fmtAge(m.firstSeenAgoSec)}</strong> ago</span>
          <span className="age-tag">Last token <strong data-ts={m.lastSeen}>{fmtAge(m.lastSeenAgoSec)}</strong> ago</span>
          <span className="age-tag">Span {m.spanHours}h</span>
        </div>
        <DecayMeter m={m} />
        <div className="detail-grid">
          <div className="detail-stat"><div className="val">{m.stageLabel}</div><div className="lbl">Stage</div></div>
          <div className="detail-stat"><div className="val">{m.launchCount}</div><div className="lbl">Coins</div></div>
          <div className="detail-stat"><div className="val">{m.launchRateNow}/h</div><div className="lbl">Launch rate</div></div>
          <div className="detail-stat"><div className="val">${formatCompact(m.totalVolumeUsd1h)}</div><div className="lbl">Vol 1h</div></div>
        </div>
      </div>

      <div className="detail-section">
        <h3>Psychology</h3>
        <p className="t-body" style={{ color: "var(--radar-cyan)" }}>{m.psychologyLabel}</p>
        <p className="t-mono" style={{ color: "var(--radar-subtle)", marginTop: 8 }}>{m.traderMindset}</p>
      </div>

      <div className="detail-section">
        <h3>Deploying</h3>
        <div className="deploy-grid">
          {m.tokens.slice(0, 10).map((t) => (
            <a key={t.mint} className="deploy-card" href={`https://pump.fun/coin/${t.mint}`} target="_blank" rel="noopener noreferrer" data-cursor-hover>
              {t.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.image} alt="" className="deploy-img" loading="lazy" />
              ) : (
                <div className="deploy-img placeholder">?</div>
              )}
              <div className="deploy-label">{t.symbol ?? t.name ?? t.mint.slice(0, 6)}</div>
              {t.blockTime && (
                <div className="deploy-age" data-ts={t.blockTime}>{fmtAge(t.ageSec)}</div>
              )}
              {t.volumeUsd24h ? (
                <div className="deploy-mcap">${formatCompact(t.volumeUsd24h)}</div>
              ) : null}
            </a>
          ))}
        </div>
      </div>
    </>
  );
}
