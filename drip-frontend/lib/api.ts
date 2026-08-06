const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// ─── Shared types (mirrors drip-server store types) ──────────────────────────

export interface Campaign {
  id: string;
  project: string;
  logo: string;
  budgetTotal: number;
  budgetLeft: number;
  goal: number;
  verified: number;
  rateLabel: string;
  dripPerKViews: number;
  participants: number;
  active: boolean;
  createdAt: string;
}

export interface Vault {
  walletAddress: string;
  balance: number;
  claimable: number;
  lifetimeEarned: number;
  fillPct: number;
  lastUpdated: string;
}

export interface Post {
  id: string;
  walletAddress: string;
  twitterHandle: string;
  tweetId: string;
  tweetUrl: string;
  campaignId: string;
  impressions: number;
  totalEarned: number;
  verified: boolean;
  submittedAt: string;
  lastRefreshed: string;
  dripHr?: number;
  campaignName?: string;
}

export interface SubmitPostInput {
  walletAddress: string;
  twitterHandle: string;
  tweetUrl: string;
  campaignId: string;
}

export interface ClaimResult {
  success: boolean;
  claimed: number;
  txSignature: string;
  explorerUrl: string;
  vault: Pick<Vault, "balance" | "claimable" | "fillPct">;
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? "API error");
  }
  return res.json() as Promise<T>;
}

// ─── API client ──────────────────────────────────────────────────────────────

export const api = {
  health: () =>
    req<{ status: string; uptime: number }>("/health"),

  getCampaigns: () =>
    req<{ campaigns: Campaign[] }>("/api/campaigns"),

  getCampaign: (id: string) =>
    req<{ campaign: Campaign }>(`/api/campaigns/${id}`),

  getVault: (address: string) =>
    req<{ vault: Vault }>(`/api/vault/${address}`),

  getVaultPosts: (address: string) =>
    req<{ posts: Post[] }>(`/api/vault/${address}/posts`),

  submitPost: (data: SubmitPostInput) =>
    req<{ post: Post; tweet: { viewCount: number; text: string }; message: string }>(
      "/api/posts/submit",
      { method: "POST", body: JSON.stringify(data) },
    ),

  claimRewards: (walletAddress: string, amount: number) =>
    req<ClaimResult>("/api/claims", {
      method: "POST",
      body: JSON.stringify({ walletAddress, amount }),
    }),

  getLeaderboard: () =>
    req<{ leaderboard: { walletAddress: string; twitterHandle: string; lifetimeEarned: number }[] }>(
      "/api/vault/leaderboard/top",
    ),
};
