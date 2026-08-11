import type { LaunchRecord } from './fetchLaunches.js';
import type { PsychologyMode } from './attention.js';
import { narrativeLabel } from './classify.js';
import { volumeDecayScore } from './volume.js';
import { findSparkForTheme, type SocialSpark } from './socialSpark.js';
import { imageClusterKey } from './imageKey.js';

export type MetaStage =
  | 'spark'
  | 'naming'
  | 'recognition'
  | 'copycat'
  | 'momentum'
  | 'peak'
  | 'fade';

export interface MetaToken {
  mint: string;
  symbol?: string;
  name?: string;
  image?: string;
  marketCapUsd?: number;
  volumeUsd24h?: number;
  volumeUsd1h?: number;
  txns24h?: number;
  blockTime?: number;
  ageSec?: number;
  creator: string;
  twitter?: string;
}

export type VolumeTrend = 'hot' | 'cooling' | 'dying';

export interface MetaTimelineEvent {
  at: number;
  stage: MetaStage;
  label: string;
}

export interface MetaTrack {
  id: string;
  theme: string;
  stage: MetaStage;
  stageIndex: number;
  stageLabel: string;
  stageDescription: string;
  psychology: PsychologyMode;
  psychologyLabel: string;
  traderMindset: string;
  launchCount: number;
  velocityPerHour: number;
  velocityPer10Min: number;
  firstSeen: number;
  lastSeen: number;
  ageHours: number;
  spanHours: number;
  totalMarketCapUsd: number;
  avgMarketCapUsd: number;
  topMarketCapUsd: number;
  moneySignal: string;
  newsSignal: string;
  isNew: boolean;
  isNotable: boolean;
  isActive: boolean;
  attentionScore: number;
  uniqueCreators: number;
  sampleImages: string[];
  tokens: MetaToken[];
  timeline: MetaTimelineEvent[];
  isEmerging?: boolean;
  /** Seconds since first token in cluster */
  firstSeenAgoSec: number;
  /** Seconds since last token in cluster */
  lastSeenAgoSec: number;
  totalVolumeUsd24h: number;
  totalVolumeUsd1h: number;
  totalTxns24h: number;
  launchRateNow: number;
  launchRatePeak: number;
  /** 0 = hot trend, 100 = dead */
  dyingRate: number;
  volumeTrend: VolumeTrend;
}

export interface MetaDashboard {
  generatedAt: string;
  lookbackDays: number;
  totalLaunches: number;
  activeMetaCount: number;
  formingCount: number;
  dominantStage: MetaStage;
  insight: string;
  stages: Array<{ id: MetaStage; label: string; description: string }>;
  forming: MetaTrack[];
  emerging: MetaTrack[];
  active: MetaTrack[];
  fading: MetaTrack[];
  all: MetaTrack[];
}

const STOP = new Set([
  'the', 'and', 'coin', 'token', 'sol', 'pump', 'fun', 'new', 'official',
  'real', 'true', 'just', 'for', 'you', 'this', 'that', 'with', 'from',
  'meme', 'memes', 'cat', 'dog', 'pepe', 'based', 'chad', 'anon',
]);

/** Minimum tokens to count as a real meta (not noise) */
const MIN_META_TOKENS = 5;
/** Minimum for "forming" — early but measurable cluster */
const MIN_FORMING_TOKENS = 4;
/** Min launches in last hour to call something actively forming */
const MIN_FORMING_VELOCITY = 3;
/** Min distinct deployer wallets for a meta */
const MIN_UNIQUE_CREATORS = 3;
/** Min tokens sharing the same image to form a visual copycat meta (title ignored) */
const MIN_IMAGE_CLUSTER = 2;

/** Live-mode thresholds — tighter window, faster stage movement */
const LIVE = {
  lookbackHours: 24,
  minEmergingTokens: 2,
  emergingWindowSec: 45 * 60,
  minFormingTokens: 3,
  minFormingVelocity: 2,
  minMetaTokens: 4,
  minUniqueCreators: 2,
  fadeAfterHours: 2,
};

export const STAGE_DEFS: Array<{ id: MetaStage; label: string; description: string }> = [
  { id: 'spark', label: 'Spark', description: 'Something is happening — first signal' },
  { id: 'naming', label: 'Naming', description: 'First token names the theme' },
  { id: 'recognition', label: 'Recognition', description: 'Others see it — 2–3 related launches' },
  { id: 'copycat', label: 'Copycat wave', description: 'X worked — launch X2, X3…' },
  { id: 'momentum', label: 'Money follows', description: 'Buys and mcap confirm the crowd' },
  { id: 'peak', label: 'Peak', description: 'Max attention — velocity slowing' },
  { id: 'fade', label: 'Fade', description: 'Meta cooling — attention moving on' },
];

const STAGE_INDEX: Record<MetaStage, number> = {
  spark: 0,
  naming: 1,
  recognition: 2,
  copycat: 3,
  momentum: 4,
  peak: 5,
  fade: 6,
};

const PSYCH_LABELS: Record<PsychologyMode, string> = {
  herding: 'Herding — everyone piles into the same idea',
  copycat_wave: 'Copycat wave — "others will see this too"',
  momentum_chase: 'Momentum chase — buying what already moves',
  solo_bet: 'Solo bet — early, before the crowd',
  unknown: 'Unknown — no clear crowd signal yet',
};

function extractTerms(launch: LaunchRecord): string[] {
  const raw = [launch.symbol, launch.name].filter(Boolean).join(' ');
  const terms = new Set<string>();

  if (launch.symbol) {
    const sym = launch.symbol.toLowerCase().replace(/[^a-z0-9$]/g, '').trim();
    if (sym.length >= 2) terms.add(sym);
  }

  if (launch.name) {
    const name = launch.name.toLowerCase().trim();
    if (name.length >= 3) terms.add(name);
  }

  if (!raw.trim()) return [...terms];

  const words = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s$]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP.has(w));

  for (const w of words) terms.add(w);

  const parts = raw.toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
  for (let i = 0; i < parts.length - 1; i++) {
    const bigram = `${parts[i]} ${parts[i + 1]}`;
    if (!STOP.has(parts[i]!) && !STOP.has(parts[i + 1]!)) terms.add(bigram);
  }

  return [...terms];
}

function inferPsychology(
  count: number,
  velocityPer10Min: number,
  avgMcap: number,
  stage: MetaStage,
): { mode: PsychologyMode; mindset: string } {
  if (stage === 'fade') {
    return { mode: 'unknown', mindset: 'Attention shifting — crowd looking for the next thing' };
  }
  if (stage === 'momentum' || stage === 'peak') {
    return {
      mode: 'momentum_chase',
      mindset: 'Money follows belief — traders buy what already has traction',
    };
  }
  if (count >= 5 && velocityPer10Min >= 2) {
    return {
      mode: 'copycat_wave',
      mindset: `${count} launches on the same theme — devs assume the crowd is watching`,
    };
  }
  if (count >= 3) {
    return {
      mode: 'herding',
      mindset: 'Attention clustering — "others think like me" kicks in',
    };
  }
  if (count === 1) {
    return { mode: 'solo_bet', mindset: 'First mover — solo bet before herd forms' };
  }
  if (avgMcap > 5000) {
    return { mode: 'momentum_chase', mindset: 'Early traction — watch if copycats follow' };
  }
  return { mode: 'herding', mindset: 'Emerging recognition — meta forming' };
}

function trackMintSet(track: MetaTrack): Set<string> {
  return new Set(track.tokens.map((t) => t.mint));
}

function tracksOverlap(a: MetaTrack, b: MetaTrack): boolean {
  const aMints = trackMintSet(a);
  const bMints = trackMintSet(b);
  let overlap = 0;
  for (const m of aMints) {
    if (bMints.has(m)) overlap++;
  }
  const minSize = Math.min(aMints.size, bMints.size);
  return overlap >= MIN_IMAGE_CLUSTER && overlap >= minSize * 0.5;
}

function preferTrack(a: MetaTrack, b: MetaTrack): MetaTrack {
  if (a.id.startsWith('img-') && !b.id.startsWith('img-')) return a;
  if (b.id.startsWith('img-') && !a.id.startsWith('img-')) return b;
  if (a.launchCount !== b.launchCount) return a.launchCount > b.launchCount ? a : b;
  return a.attentionScore >= b.attentionScore ? a : b;
}

function uniqueCreators(launches: LaunchRecord[]): number {
  return new Set(launches.map((l) => l.creator)).size;
}

function qualifiesAsMeta(
  count: number,
  velocityPerHour: number,
  creators: number,
  imageCluster: boolean,
  live = false,
): boolean {
  const minTokens = live ? LIVE.minMetaTokens : MIN_META_TOKENS;
  if (imageCluster && count >= MIN_IMAGE_CLUSTER) return true;
  if (count >= minTokens && creators >= 2) return true;
  if (count >= minTokens && velocityPerHour >= (live ? 1.5 : 2)) return true;
  if (count >= (live ? 5 : 6) && creators >= MIN_UNIQUE_CREATORS) return true;
  return false;
}

function qualifiesAsForming(
  count: number,
  velocityPerHour: number,
  creators: number,
  recentWindowCount: number,
  live = false,
): boolean {
  const minTokens = live ? LIVE.minFormingTokens : MIN_FORMING_TOKENS;
  const minVel = live ? LIVE.minFormingVelocity : MIN_FORMING_VELOCITY;
  if (count >= minTokens && velocityPerHour >= minVel && creators >= 2) return true;
  if (live && count >= minTokens && recentWindowCount >= 3 && creators >= 2) return true;
  return false;
}

function qualifiesAsEmerging(
  count: number,
  recentWindowCount: number,
  spanSec: number,
  live: boolean,
): boolean {
  if (!live) return false;
  return (
    count >= LIVE.minEmergingTokens &&
    recentWindowCount >= LIVE.minEmergingTokens &&
    spanSec <= LIVE.emergingWindowSec
  );
}

function computeTrendMetrics(
  deduped: LaunchRecord[],
  now: number,
  firstSeen: number,
  lastSeen: number,
  spanHours: number,
  live: boolean,
) {
  const recent30m = deduped.filter((l) => now - l.blockTime! <= 1800).length;
  const recent1h = deduped.filter((l) => now - l.blockTime! <= 3600).length;
  const prev1h = deduped.filter(
    (l) => now - l.blockTime! <= 7200 && now - l.blockTime! > 3600,
  ).length;

  const peakLaunchRate = deduped.length / Math.max(spanHours, 0.08);
  const launchRateNow = recent30m * 2;

  const totalVolumeUsd24h = deduped.reduce((s, l) => s + (l.volumeUsd24h ?? 0), 0);
  const totalVolumeUsd1h = deduped.reduce((s, l) => s + (l.volumeUsd1h ?? 0), 0);
  const totalTxns24h = deduped.reduce((s, l) => s + (l.txns24h ?? 0), 0);

  const volDecay = volumeDecayScore(totalVolumeUsd24h, totalVolumeUsd1h);
  const launchDecay =
    peakLaunchRate > 0
      ? Math.max(0, Math.min(1, 1 - launchRateNow / peakLaunchRate))
      : recent1h === 0
        ? 0.6
        : 0.25;

  const timeSinceLastSec = now - lastSeen;
  const fadeSec = (live ? LIVE.fadeAfterHours : 8) * 3600;
  const timeDecay = Math.min(1, timeSinceLastSec / fadeSec);

  const windowDecay = prev1h > 0 ? Math.max(0, Math.min(1, 1 - recent1h / prev1h)) : recent1h === 0 ? 0.4 : 0;

  const hasVolume = totalVolumeUsd24h > 0 || totalVolumeUsd1h > 0;
  const dyingRate = Math.round(
    100 *
      (hasVolume
        ? 0.3 * launchDecay + 0.4 * volDecay + 0.2 * timeDecay + 0.1 * windowDecay
        : 0.45 * launchDecay + 0.35 * timeDecay + 0.2 * windowDecay),
  );

  let volumeTrend: VolumeTrend = 'hot';
  if (dyingRate >= 60) volumeTrend = 'dying';
  else if (dyingRate >= 30) volumeTrend = 'cooling';

  return {
    firstSeenAgoSec: now - firstSeen,
    lastSeenAgoSec: now - lastSeen,
    totalVolumeUsd24h: Math.round(totalVolumeUsd24h),
    totalVolumeUsd1h: Math.round(totalVolumeUsd1h),
    totalTxns24h,
    launchRateNow: Math.round(launchRateNow * 10) / 10,
    launchRatePeak: Math.round(peakLaunchRate * 10) / 10,
    dyingRate: Math.max(0, Math.min(100, dyingRate)),
    volumeTrend,
  };
}

function buildTrackFromGroup(
  theme: string,
  deduped: LaunchRecord[],
  now: number,
  sparks: SocialSpark[],
  imageCluster = false,
  live = false,
): MetaTrack | null {
  if (imageCluster) {
    if (deduped.length < MIN_IMAGE_CLUSTER) return null;
  } else {
    const minTokens = live ? LIVE.minEmergingTokens : MIN_FORMING_TOKENS;
    if (deduped.length < minTokens) return null;
  }

  const times = deduped.map((l) => l.blockTime!).sort((a, b) => a - b);
  const firstSeen = times[0]!;
  const lastSeen = times[times.length - 1]!;
  const ageHours = (now - firstSeen) / 3600;
  const spanHours = Math.max(0.05, (lastSeen - firstSeen) / 3600);
  const spanSec = lastSeen - firstSeen;

  const lastHour = deduped.filter((l) => now - l.blockTime! <= 3600);
  const recentWindow = deduped.filter((l) => now - l.blockTime! <= LIVE.emergingWindowSec);
  const velocityPerHour = lastHour.length;
  const creators = uniqueCreators(deduped);
  const spanMin = Math.max(1, (lastSeen - firstSeen) / 60);
  const velocityPer10Min = (deduped.length / spanMin) * 10;
  const burstVelocityPerHour = deduped.length / spanHours;
  const effectiveVelocity = Math.max(velocityPerHour, burstVelocityPerHour);

  const isEmerging = qualifiesAsEmerging(deduped.length, recentWindow.length, spanSec, live);
  const isMeta = qualifiesAsMeta(deduped.length, effectiveVelocity, creators, imageCluster, live);
  const isForming = qualifiesAsForming(
    deduped.length,
    effectiveVelocity,
    creators,
    recentWindow.length,
    live,
  );

  if (!isMeta && !isForming && !isEmerging) return null;

  const mcaps = deduped.map((l) => l.marketCapUsd ?? 0).filter((m) => m > 0);
  const totalMcap = mcaps.reduce((a, b) => a + b, 0);
  const avgMcap = mcaps.length ? totalMcap / mcaps.length : 0;
  const topMcap = mcaps.length ? Math.max(...mcaps) : 0;

  const stage = inferStage({
    count: deduped.length,
    firstSeen,
    lastSeen,
    now,
    velocityPerHour: effectiveVelocity,
    velocityRecentHour: velocityPerHour,
    avgMcap,
    topMcap,
  }, live);

  const stageDef = STAGE_DEFS.find((s) => s.id === stage)!;
  const psych = imageCluster && deduped.length >= 2
    ? {
        mode: 'copycat_wave' as PsychologyMode,
        mindset: `${deduped.length} tokens reusing the same image — visual copycat wave`,
      }
    : inferPsychology(deduped.length, velocityPer10Min, avgMcap, stage);
  const recencyBoost = Math.max(0, 12 - (now - lastSeen) / 300);

  const tokens: MetaToken[] = deduped
    .sort((a, b) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0))
    .slice(0, 24)
    .map((l) => ({
      mint: l.mint,
      symbol: l.symbol,
      name: l.name,
      image: l.image,
      marketCapUsd: l.marketCapUsd,
      volumeUsd24h: l.volumeUsd24h,
      volumeUsd1h: l.volumeUsd1h,
      txns24h: l.txns24h,
      blockTime: l.blockTime ?? undefined,
      ageSec: l.blockTime ? now - l.blockTime : undefined,
      creator: l.creator,
      twitter: (l as LaunchRecord & { twitter?: string }).twitter,
    }));

  const trend = computeTrendMetrics(deduped, now, firstSeen, lastSeen, spanHours, live);

  const sampleImages = [
    ...new Set(tokens.map((t) => t.image).filter(Boolean) as string[]),
  ].slice(0, 8);

  const hoursSinceLast = (now - lastSeen) / 3600;
  const isNew = (isForming || isEmerging) && ageHours <= 4 && stage !== 'fade';
  const isActive = isMeta && (hoursSinceLast <= (live ? 6 : 12) || effectiveVelocity >= (live ? 3 : 4));
  const attentionScore = scoreMeta({
    launchCount: deduped.length,
    velocityPer10Min,
    totalMarketCapUsd: totalMcap,
    recencyBoost,
    stageIndex: STAGE_INDEX[stage],
  }) + (creators >= MIN_UNIQUE_CREATORS ? 10 : 0) + (imageCluster ? 15 : 0);

  const isNotable = isMeta && (stage === 'copycat' || stage === 'momentum' || effectiveVelocity >= 4);

  const clusterKey = imageCluster
    ? (imageClusterKey(deduped[0]?.image) ?? theme.replace(/\s+/g, '-'))
    : theme.replace(/\s+/g, '-');

  return {
    id: `${imageCluster ? 'img' : 'term'}-${clusterKey}`,
    theme: imageCluster ? `${theme} · image copycats` : theme,
    stage,
    stageIndex: STAGE_INDEX[stage],
    stageLabel: stageDef.label,
    stageDescription: stageDef.description,
    psychology: psych.mode,
    psychologyLabel: PSYCH_LABELS[psych.mode],
    traderMindset: psych.mindset,
    launchCount: deduped.length,
    velocityPerHour: Math.round(effectiveVelocity * 10) / 10,
    velocityPer10Min: Math.round(velocityPer10Min * 10) / 10,
    firstSeen,
    lastSeen,
    ageHours: Math.round(ageHours * 10) / 10,
    spanHours: Math.round(spanHours * 10) / 10,
    totalMarketCapUsd: Math.round(totalMcap),
    avgMarketCapUsd: Math.round(avgMcap),
    topMarketCapUsd: Math.round(topMcap),
    moneySignal: totalMcap > 0
      ? `$${totalMcap.toLocaleString()} combined mcap · ${creators} deployers`
      : `${deduped.length} deploys · ${creators} wallets — mcap pending`,
    newsSignal: (() => {
      const linked = findSparkForTheme(theme, sparks);
      if (linked) {
        return `@${linked.handle} · "${linked.text.slice(0, 120)}${linked.text.length > 120 ? '…' : ''}"`;
      }
      return buildNewsSignal(tokens, sparks);
    })(),
    isNew,
    isNotable,
    isActive,
    attentionScore,
    uniqueCreators: creators,
    sampleImages,
    tokens,
    timeline: buildTimeline(theme, tokens, stage),
    isEmerging: isEmerging && !isMeta,
    ...trend,
  };
}

function inferStage(
  opts: {
    count: number;
    firstSeen: number;
    lastSeen: number;
    now: number;
    velocityPerHour: number;
    velocityRecentHour: number;
    avgMcap: number;
    topMcap: number;
  },
  live = false,
): MetaStage {
  const hoursSinceLast = (opts.now - opts.lastSeen) / 3600;
  const hoursSinceFirst = (opts.now - opts.firstSeen) / 3600;
  const fadeAfter = live ? LIVE.fadeAfterHours : 8;
  const peakRatio = live ? 0.5 : 0.35;

  if (opts.count >= 2 && hoursSinceLast > fadeAfter) return 'fade';
  if (opts.count >= 5 && opts.velocityPerHour >= 2 &&
      opts.velocityRecentHour < opts.velocityPerHour * peakRatio) return 'peak';
  if (opts.avgMcap >= 8000 && opts.count >= 4) return 'momentum';
  if (opts.topMcap >= 15000 && opts.count >= 3) return 'momentum';
  if (live && opts.count >= 5 && opts.velocityRecentHour >= 3) return 'momentum';
  if (opts.count >= 6 && opts.velocityRecentHour >= 3) return 'copycat';
  if (opts.count >= 4 && opts.velocityRecentHour >= 2) return 'copycat';
  if (live && opts.count >= 3 && opts.velocityRecentHour >= 2) return 'copycat';
  if (opts.count >= 3 && hoursSinceFirst <= (live ? 2 : 3)) return 'recognition';
  if (opts.count >= 2) return 'naming';
  return 'spark';
}

function buildNewsSignal(tokens: MetaToken[], sparks: SocialSpark[]): string {
  const withTwitter = tokens.find((t) => t.twitter);
  if (withTwitter?.twitter) {
    try {
      const u = new URL(withTwitter.twitter);
      const parts = u.pathname.split('/').filter(Boolean);
      const handle = parts[0];
      return `@${handle} linked in token metadata — likely social spark`;
    } catch {
      return 'Twitter link in token metadata — social-origin signal';
    }
  }

  for (const t of tokens) {
    const themeTerms = [t.symbol, t.name].filter(Boolean).join(' ');
    if (!themeTerms) continue;
    const spark = sparks.find((s) =>
      s.terms.some((term) => themeTerms.toLowerCase().includes(term)) ||
      s.text.toLowerCase().includes((t.symbol ?? t.name ?? '').toLowerCase()),
    );
    if (spark) {
      return `@${spark.handle} · "${spark.text.slice(0, 100)}${spark.text.length > 100 ? '…' : ''}" · ${spark.link ?? ''}`;
    }
  }

  return 'On-chain signal — no linked tweet yet';
}

function buildTimeline(
  theme: string,
  tokens: MetaToken[],
  stage: MetaStage,
): MetaTimelineEvent[] {
  const sorted = [...tokens].sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0));
  const events: MetaTimelineEvent[] = [];

  if (sorted[0]) {
    events.push({
      at: sorted[0].blockTime ?? 0,
      stage: 'spark',
      label: `First signal: ${sorted[0].symbol ?? sorted[0].name ?? theme}`,
    });
  }
  if (sorted.length >= 2) {
    events.push({
      at: sorted[1]!.blockTime ?? 0,
      stage: 'recognition',
      label: `Recognition: ${sorted.length - 1} more token(s) naming "${theme}"`,
    });
  }
  if (sorted.length >= 5) {
    const fifth = sorted[4];
    events.push({
      at: fifth?.blockTime ?? 0,
      stage: 'copycat',
      label: `Copycat wave: 5+ launches on "${theme}"`,
    });
  }
  const top = sorted.reduce(
    (best, t) => ((t.marketCapUsd ?? 0) > (best.marketCapUsd ?? 0) ? t : best),
    sorted[0]!,
  );
  if ((top.marketCapUsd ?? 0) >= 8000) {
    events.push({
      at: top.blockTime ?? 0,
      stage: 'momentum',
      label: `Money follows: ${top.symbol ?? top.name} hit ~$${Math.round(top.marketCapUsd ?? 0).toLocaleString()} mcap`,
    });
  }
  events.push({
    at: sorted[sorted.length - 1]!.blockTime ?? 0,
    stage,
    label: `Now: ${STAGE_DEFS.find((s) => s.id === stage)?.label ?? stage}`,
  });

  return events.sort((a, b) => a.at - b.at);
}

function scoreMeta(c: {
  launchCount: number;
  velocityPer10Min: number;
  totalMarketCapUsd: number;
  recencyBoost: number;
  stageIndex: number;
}): number {
  return (
    c.launchCount * 4 +
    c.velocityPer10Min * 10 +
    Math.log10(Math.max(c.totalMarketCapUsd, 1)) * 3 +
    c.recencyBoost * 2 +
    c.stageIndex * 2
  );
}

export function analyzeMetas(
  launches: LaunchRecord[],
  lookbackDays = 4,
  sparks: SocialSpark[] = [],
  opts: { live?: boolean } = {},
): MetaDashboard {
  const live = opts.live ?? false;
  const now = Math.floor(Date.now() / 1000);
  const cutoff = live
    ? now - LIVE.lookbackHours * 3600
    : now - lookbackDays * 86400;
  const recent = launches.filter((l) => l.blockTime != null && l.blockTime >= cutoff);

  const termMap = new Map<string, LaunchRecord[]>();
  const imageMap = new Map<string, LaunchRecord[]>();
  const narrativeMap = new Map<string, LaunchRecord[]>();

  for (const l of recent) {
    const imgKey = imageClusterKey(l.image);
    if (imgKey) {
      if (!imageMap.has(imgKey)) imageMap.set(imgKey, []);
      imageMap.get(imgKey)!.push(l);
    }
  }

  const imageGroupedMints = new Set<string>();
  const imageGroups: LaunchRecord[][] = [];

  for (const [, group] of imageMap) {
    const unique = new Map<string, LaunchRecord>();
    for (const l of group) unique.set(l.mint, l);
    const deduped = [...unique.values()];
    if (deduped.length < MIN_IMAGE_CLUSTER) continue;
    imageGroups.push(deduped);
    for (const l of deduped) imageGroupedMints.add(l.mint);
  }

  for (const l of recent) {
    if (imageGroupedMints.has(l.mint)) continue;

    for (const term of extractTerms(l)) {
      if (!termMap.has(term)) termMap.set(term, []);
      termMap.get(term)!.push(l);
    }
    if (l.primaryNarrative && l.primaryNarrative !== 'other') {
      const key = `narrative:${l.primaryNarrative}`;
      if (!narrativeMap.has(key)) narrativeMap.set(key, []);
      narrativeMap.get(key)!.push(l);
    }
  }

  const tracks: MetaTrack[] = [];
  const seenIds = new Set<string>();

  const addTrack = (track: MetaTrack | null) => {
    if (track && !seenIds.has(track.id)) {
      seenIds.add(track.id);
      tracks.push(track);
    }
  };

  for (const deduped of imageGroups) {
    const sorted = [...deduped].sort((a, b) => (a.blockTime ?? 0) - (b.blockTime ?? 0));
    const original = sorted[0];
    const label = original?.symbol ?? original?.name ?? 'visual';
    addTrack(buildTrackFromGroup(String(label), deduped, now, sparks, true, live));
  }

  for (const [theme, group] of termMap) {
    if (theme.length < 2) continue;
    const unique = new Map<string, LaunchRecord>();
    for (const l of group) unique.set(l.mint, l);
    addTrack(buildTrackFromGroup(theme, [...unique.values()], now, sparks, false, live));
  }

  for (const [narrativeId, group] of narrativeMap) {
    const unique = new Map<string, LaunchRecord>();
    for (const l of group) unique.set(l.mint, l);
    const deduped = [...unique.values()];
    if (deduped.length < (live ? LIVE.minEmergingTokens : MIN_FORMING_TOKENS)) continue;
    const label = narrativeLabel(narrativeId.replace('narrative:', ''));
    addTrack(buildTrackFromGroup(label, deduped, now, sparks, false, live));
  }

  tracks.sort((a, b) => b.attentionScore - a.attentionScore);

  const suppressed = new Set<number>();
  for (let i = 0; i < tracks.length; i++) {
    if (suppressed.has(i)) continue;
    for (let j = i + 1; j < tracks.length; j++) {
      if (suppressed.has(j)) continue;
      if (!tracksOverlap(tracks[i]!, tracks[j]!)) continue;
      const keep = preferTrack(tracks[i]!, tracks[j]!);
      suppressed.add(keep === tracks[i] ? j : i);
    }
  }

  const dedupedTracks = tracks
    .filter((_, i) => !suppressed.has(i))
    .filter((c, i, arr) =>
      !arr.some(
        (other, j) =>
          j < i &&
          other.theme.includes(c.theme) &&
          other.launchCount >= c.launchCount,
      ),
    );

  const emerging = dedupedTracks.filter((m) => m.isEmerging).slice(0, 8);
  const forming = dedupedTracks.filter((m) => m.isNew && !m.isEmerging).slice(0, 8);
  const active = dedupedTracks.filter((m) => m.isActive).slice(0, 12);
  const fading = dedupedTracks.filter((m) => m.stage === 'fade').slice(0, 6);

  const stageCounts = new Map<MetaStage, number>();
  for (const m of dedupedTracks) {
    stageCounts.set(m.stage, (stageCounts.get(m.stage) ?? 0) + 1);
  }
  const dominantStage =
    [...stageCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'recognition';

  const top = active[0] ?? forming[0] ?? emerging[0];
  let insight: string;
  if (!top) {
    insight = live
      ? `Scanning ${recent.length} creates (24h) — clusters form at 2+ tokens, metas at ${LIVE.minMetaTokens}+.`
      : `No qualified metas yet — need ${MIN_META_TOKENS}+ tokens with measurable velocity, or ${MIN_FORMING_TOKENS}+ forming fast. Single launches don't count.`;
  } else if (emerging.length > 0 && !active.length) {
    insight = `${emerging.length} emerging cluster(s) — "${emerging[0]!.theme}" at ${emerging[0]!.stageLabel} (${emerging[0]!.launchCount} tokens).`;
  } else if (forming.length > 0 && !active.length) {
    insight = `${forming.length} cluster(s) forming — "${forming[0]!.theme}" has ${forming[0]!.launchCount} tokens at ${forming[0]!.velocityPerHour}/hr. Not a meta until ${MIN_META_TOKENS}+ deploys.`;
  } else if (forming.length > 0) {
    insight = `"${top.theme}" is the lead meta (${top.launchCount} tokens). ${forming.length} more cluster(s) building momentum.`;
  } else if (top.stage === 'copycat' || top.stage === 'momentum') {
    insight = `"${top.theme}" is a real meta — ${top.launchCount} tokens, ${top.uniqueCreators} deployers, ${top.stageLabel}.`;
  } else {
    insight = `Leading meta: "${top.theme}" — ${top.launchCount} tokens, ${top.uniqueCreators} deployers over ${top.spanHours}h.`;
  }

  return {
    generatedAt: new Date().toISOString(),
    lookbackDays,
    totalLaunches: recent.length,
    activeMetaCount: active.length,
    formingCount: forming.length + emerging.length,
    dominantStage,
    insight,
    stages: STAGE_DEFS,
    emerging,
    forming,
    active,
    fading,
    all: dedupedTracks.slice(0, 30),
  };
}
