import type { LaunchRecord } from './fetchLaunches.js';

const STOP = new Set([
  'the', 'and', 'coin', 'token', 'sol', 'pump', 'fun', 'new', 'official',
  'real', 'true', 'just', 'for', 'you', 'this', 'that', 'with', 'from',
]);

export type PsychologyMode =
  | 'herding'
  | 'copycat_wave'
  | 'momentum_chase'
  | 'solo_bet'
  | 'unknown';

export interface AttentionCluster {
  id: string;
  theme: string;
  launchCount: number;
  velocityPer10Min: number;
  windowMinutes: number;
  firstSeen: number;
  lastSeen: number;
  totalMarketCapUsd: number;
  avgMarketCapUsd: number;
  psychology: PsychologyMode;
  psychologyLabel: string;
  traderMindset: string;
  sampleTokens: Array<{ symbol?: string; name?: string; mint: string; marketCapUsd?: number }>;
  attentionScore: number;
}

export interface AttentionPulse {
  generatedAt: string;
  windowMinutes: number;
  totalLaunches: number;
  hotClusters: AttentionCluster[];
  dominantPsychology: PsychologyMode;
  psychologySummary: Array<{ mode: PsychologyMode; label: string; count: number; pct: number }>;
  insight: string;
}

const PSYCH_LABELS: Record<PsychologyMode, string> = {
  herding: 'Herding — everyone pile into the same idea',
  copycat_wave: 'Copycat wave — "X worked, launch X2, X3…"',
  momentum_chase: 'Momentum chase — buying what already has traction',
  solo_bet: 'Solo bet — isolated launch, no crowd yet',
  unknown: 'Unknown — no clear theme signal',
};

function extractTerms(launch: LaunchRecord): string[] {
  const raw = [launch.symbol, launch.name].filter(Boolean).join(' ');
  if (!raw.trim()) return [];

  const words = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s$]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));

  const terms = new Set<string>(words);

  const parts = raw.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
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
  windowMin: number,
): { mode: PsychologyMode; mindset: string } {
  if (count >= 5 && velocityPer10Min >= 2) {
    return {
      mode: 'copycat_wave',
      mindset: `${count} launches on the same theme in ${windowMin}min — devs/traders assume others see it too`,
    };
  }
  if (count >= 3 && velocityPer10Min >= 1) {
    return {
      mode: 'herding',
      mindset: `Attention clustering — multiple people chasing the same thread ("others think like me")`,
    };
  }
  if (avgMcap > 5000 && count >= 2) {
    return {
      mode: 'momentum_chase',
      mindset: `Money flowing where traction already shows — betting the crowd notices next`,
    };
  }
  if (count === 1) {
    return {
      mode: 'solo_bet',
      mindset: `Lone launch — early before the herd, or noise nobody picked up`,
    };
  }
  return {
    mode: 'herding',
    mindset: `Emerging cluster — watch if copycats follow`,
  };
}

function scoreCluster(c: {
  launchCount: number;
  velocityPer10Min: number;
  totalMarketCapUsd: number;
  recencyBoost: number;
}): number {
  return (
    c.launchCount * 3 +
    c.velocityPer10Min * 8 +
    Math.log10(Math.max(c.totalMarketCapUsd, 1)) * 2 +
    c.recencyBoost
  );
}

export function analyzeAttention(
  launches: LaunchRecord[],
  windowMinutes = 60,
): AttentionPulse {
  const now = Math.floor(Date.now() / 1000);
  const windowSec = windowMinutes * 60;
  const recent = launches.filter(
    (l) => l.blockTime != null && now - l.blockTime! <= windowSec,
  );

  const termMap = new Map<string, LaunchRecord[]>();
  for (const l of recent) {
    for (const term of extractTerms(l)) {
      if (!termMap.has(term)) termMap.set(term, []);
      termMap.get(term)!.push(l);
    }
  }

  const clusters: AttentionCluster[] = [];

  for (const [theme, group] of termMap) {
    if (group.length < 2 || theme.length < 3) continue;

    const times = group.map((l) => l.blockTime!).sort((a, b) => a - b);
    const spanMin = Math.max(1, (times[times.length - 1]! - times[0]!) / 60);
    const velocityPer10Min = (group.length / spanMin) * 10;

    const mcaps = group.map((l) => l.marketCapUsd ?? 0).filter((m) => m > 0);
    const totalMcap = mcaps.reduce((a, b) => a + b, 0);
    const avgMcap = mcaps.length ? totalMcap / mcaps.length : 0;

    const psych = inferPsychology(group.length, velocityPer10Min, avgMcap, Math.round(spanMin));
    const recencyBoost = Math.max(0, 10 - (now - times[times.length - 1]!) / 60);

    clusters.push({
      id: theme.replace(/\s+/g, '-'),
      theme,
      launchCount: group.length,
      velocityPer10Min: Math.round(velocityPer10Min * 10) / 10,
      windowMinutes: Math.round(spanMin),
      firstSeen: times[0]!,
      lastSeen: times[times.length - 1]!,
      totalMarketCapUsd: Math.round(totalMcap),
      avgMarketCapUsd: Math.round(avgMcap),
      psychology: psych.mode,
      psychologyLabel: PSYCH_LABELS[psych.mode],
      traderMindset: psych.mindset,
      sampleTokens: group
        .sort((a, b) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0))
        .slice(0, 5)
        .map((l) => ({
          symbol: l.symbol,
          name: l.name,
          mint: l.mint,
          marketCapUsd: l.marketCapUsd,
        })),
      attentionScore: scoreCluster({
        launchCount: group.length,
        velocityPer10Min,
        totalMarketCapUsd: totalMcap,
        recencyBoost,
      }),
    });
  }

  clusters.sort((a, b) => b.attentionScore - a.attentionScore);

  const hotClusters = clusters
    .filter((c, i) => {
      return !clusters.some(
        (other, j) =>
          j < i &&
          other.theme.includes(c.theme) &&
          other.launchCount >= c.launchCount,
      );
    })
    .slice(0, 12);

  const psychCounts = new Map<PsychologyMode, number>();
  for (const l of recent) {
    const terms = extractTerms(l);
    let mode: PsychologyMode = 'unknown';
    if (terms.length === 0) mode = 'unknown';
    else {
      const best = hotClusters.find((c) =>
        terms.some((t) => c.theme.includes(t) || t.includes(c.theme)),
      );
      mode = best?.psychology ?? 'solo_bet';
    }
    psychCounts.set(mode, (psychCounts.get(mode) ?? 0) + 1);
  }

  const psychologySummary = [...psychCounts.entries()]
    .map(([mode, count]) => ({
      mode,
      label: PSYCH_LABELS[mode],
      count,
      pct: recent.length ? Math.round((count / recent.length) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const dominant = psychologySummary[0]?.mode ?? 'unknown';
  const top = hotClusters[0];

  let insight: string;
  if (!top) {
    insight =
      'No clear attention clusters — market fragmented or too little metadata to read trader intent.';
  } else if (top.psychology === 'copycat_wave') {
    insight = `Copycat attention on "${top.theme}" — ${top.launchCount} launches in ~${top.windowMinutes}min. People assume the crowd is watching the same thing.`;
  } else if (top.psychology === 'momentum_chase') {
    insight = `"${top.theme}" has traction (avg mcap ~$${top.avgMarketCapUsd.toLocaleString()}). Psychology: buy what's moving because others will notice.`;
  } else {
    insight = `Emerging attention on "${top.theme}" — ${top.launchCount} related launches. Watch for copycats.`;
  }

  return {
    generatedAt: new Date().toISOString(),
    windowMinutes,
    totalLaunches: recent.length,
    hotClusters,
    dominantPsychology: dominant,
    psychologySummary,
    insight,
  };
}

export function printAttentionPulse(pulse: AttentionPulse) {
  console.log('\n── Attention Pulse (trader psychology) ──\n');
  console.log(pulse.insight);
  console.log(`\nWindow: last ${pulse.windowMinutes}min · ${pulse.totalLaunches} launches\n`);

  if (pulse.hotClusters.length === 0) {
    console.log('No hot clusters detected.\n');
    return;
  }

  console.log('Where attention is flowing:\n');
  for (const c of pulse.hotClusters.slice(0, 8)) {
    console.log(
      `  ▶ "${c.theme}" — ${c.launchCount} launches / ${c.windowMinutes}min (${c.velocityPer10Min}/10min)`,
    );
    console.log(`    ${c.psychologyLabel}`);
    console.log(`    ${c.traderMindset}`);
    console.log(`    Samples: ${c.sampleTokens.map((t) => t.symbol ?? t.name ?? '?').join(', ')}`);
    if (c.avgMarketCapUsd > 0) {
      console.log(`    Avg mcap: $${c.avgMarketCapUsd.toLocaleString()}`);
    }
    console.log('');
  }

  console.log('Psychology mix:');
  for (const p of pulse.psychologySummary.slice(0, 5)) {
    console.log(`  ${p.label}: ${p.pct}%`);
  }
  console.log('');
}
