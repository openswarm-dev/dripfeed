export type MetaStage =
  | "spark"
  | "naming"
  | "recognition"
  | "copycat"
  | "momentum"
  | "peak"
  | "fade";

export type VolumeTrend = "hot" | "cooling" | "dying";

export interface MetaToken {
  mint: string;
  symbol?: string;
  name?: string;
  image?: string;
  marketCapUsd?: number;
  volumeUsd24h?: number;
  volumeUsd1h?: number;
  txns24h?: number;
  bonded?: boolean;
  holderCount?: number;
  bondingProgressPct?: number;
  blockTime?: number;
  ageSec?: number;
  creator: string;
  twitter?: string;
}

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
  psychology: string;
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
  firstSeenAgoSec: number;
  lastSeenAgoSec: number;
  totalVolumeUsd24h: number;
  totalVolumeUsd1h: number;
  totalTxns24h: number;
  launchRateNow: number;
  launchRatePeak: number;
  dyingRate: number;
  volumeTrend: VolumeTrend;
}

export interface MetaDashboard {
  generatedAt: string;
  lookbackDays: number;
  totalLaunches: number;
  activeMetaCount: number;
  formingCount: number;
  dominantStage: string;
  insight: string;
  stages: Array<{ id: MetaStage; label: string; description: string }>;
  stageTokenCounts?: Partial<Record<MetaStage, number>>;
  forming: MetaTrack[];
  emerging?: MetaTrack[];
  active: MetaTrack[];
  fading?: MetaTrack[];
  all: MetaTrack[];
}

export interface LaunchRecord {
  signature: string;
  slot: number;
  blockTime: number | null;
  mint: string;
  creator: string;
  isCreateV2: boolean;
  name?: string;
  symbol?: string;
  metadataUri?: string;
  image?: string;
  description?: string;
  marketCapUsd?: number;
  volumeUsd24h?: number;
  volumeUsd1h?: number;
  txns24h?: number;
  bonded?: boolean;
  holderCount?: number;
  bondingProgressPct?: number;
  volumeUpdatedAt?: number;
  marketUpdatedAt?: number;
  narratives: string[];
  primaryNarrative: string;
  narrativeScore: number;
}

export interface SocialSpark {
  id: string;
  tweetId: string;
  handle: string;
  name?: string;
  text: string;
  kind: string;
  createdAt: number;
  receivedAt: number;
  link?: string;
  terms: string[];
}

export interface GeyserStats {
  pumpTxSeen: number;
  createsParsed: number;
  createsStored: number;
  perMinute: number;
}

export interface FeedStatus {
  geyser: boolean;
  tweetstream: boolean;
  tweetstreamAccounts: string[];
}

export interface NarraLive {
  connected: boolean;
  feeds: FeedStatus;
  liveLaunches: number;
  liveSparks: number;
  lastLaunchAt: string | null;
  lastSparkAt: string | null;
}

export interface NarraReport {
  generatedAt: string;
  days: number;
  totalLaunches: number;
  metas: MetaDashboard;
  launches: LaunchRecord[];
  sparks: SocialSpark[];
  geyserStats: GeyserStats;
  geyserEnabled?: boolean;
  live: NarraLive;
  error?: string;
}

export interface NarraState {
  metas: MetaDashboard | null;
  launches: LaunchRecord[];
  sparks: SocialSpark[];
  geyserStats: GeyserStats;
  geyserEnabled?: boolean;
  live: NarraLive;
}
