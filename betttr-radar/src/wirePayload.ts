/**
 * Keep SSE / report payloads small so first paint isn't blocked on a 400KB+ JSON.
 */
import type { LaunchRecord } from './fetchLaunches.js';
import type { MetaDashboard, MetaToken, MetaTrack } from './metaEngine.js';

function slimToken(t: MetaToken): MetaToken {
  return {
    mint: t.mint,
    symbol: t.symbol,
    name: t.name,
    image: t.image,
    marketCapUsd: t.marketCapUsd,
    volumeUsd1h: t.volumeUsd1h,
    bonded: t.bonded,
    bondingProgressPct: t.bondingProgressPct,
    blockTime: t.blockTime,
    creator: t.creator,
  };
}

function slimMetaTrack(m: MetaTrack): MetaTrack {
  return {
    ...m,
    tokens: (m.tokens ?? []).slice(0, 8).map(slimToken),
    sampleImages: (m.sampleImages ?? []).slice(0, 4),
    timeline: (m.timeline ?? []).slice(-4),
  };
}

export function slimMetasForWire(metas: MetaDashboard): MetaDashboard {
  return {
    generatedAt: metas.generatedAt,
    lookbackDays: metas.lookbackDays,
    totalLaunches: metas.totalLaunches,
    activeMetaCount: metas.activeMetaCount,
    formingCount: metas.formingCount,
    dominantStage: metas.dominantStage,
    insight: metas.insight,
    stages: metas.stages,
    stageTokenCounts: metas.stageTokenCounts,
    emerging: (metas.emerging ?? []).map(slimMetaTrack),
    forming: metas.forming.map(slimMetaTrack),
    active: metas.active.map(slimMetaTrack),
    fading: (metas.fading ?? []).map(slimMetaTrack),
    all: [],
  };
}

export function slimLaunchForWire(l: LaunchRecord): LaunchRecord {
  return {
    signature: l.signature,
    slot: l.slot,
    blockTime: l.blockTime,
    mint: l.mint,
    creator: l.creator,
    isCreateV2: l.isCreateV2,
    name: l.name,
    symbol: l.symbol,
    image: l.image,
    narratives: l.narratives,
    primaryNarrative: l.primaryNarrative,
    narrativeScore: l.narrativeScore,
    marketCapUsd: l.marketCapUsd,
    volumeUsd1h: l.volumeUsd1h,
    volumeUsd24h: l.volumeUsd24h,
    txns24h: l.txns24h,
    holderCount: l.holderCount,
    bondingProgressPct: l.bondingProgressPct,
    bonded: l.bonded,
  };
}
