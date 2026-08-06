// In-memory store — swap for Postgres/Redis in production

export interface User {
  walletAddress: string;
  twitterHandle: string;
  connectedAt: string;
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
}

export interface Vault {
  walletAddress: string;
  balance: number;       // total accumulated DRIP
  claimable: number;     // portion available to claim
  lifetimeEarned: number;
  fillPct: number;       // 0–100 visual fill
  lastUpdated: string;
}

export interface Campaign {
  id: string;
  project: string;
  logo: string;
  budgetTotal: number;
  budgetLeft: number;
  goal: number;          // impression target
  verified: number;      // verified impressions so far
  rateLabel: string;
  dripPerKViews: number;
  participants: number;
  active: boolean;
  createdAt: string;
}

class Store {
  users  = new Map<string, User>();
  posts  = new Map<string, Post>();
  vaults = new Map<string, Vault>();

  campaigns: Campaign[] = [
    {
      id: 'c1',
      project: 'Solana Foundation',
      logo: 'SOL',
      budgetTotal: 20_000,
      budgetLeft: 14_230,
      goal: 10_000_000,
      verified: 6_421_000,
      rateLabel: '100K views → 1 DRIP',
      dripPerKViews: 0.01,
      participants: 847,
      active: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'c2',
      project: 'Jupiter Exchange',
      logo: 'JUP',
      budgetTotal: 8_000,
      budgetLeft: 7_100,
      goal: 5_000_000,
      verified: 890_000,
      rateLabel: '80K views → 1 DRIP',
      dripPerKViews: 0.0125,
      participants: 312,
      active: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'c3',
      project: 'Pyth Network',
      logo: 'PYTH',
      budgetTotal: 15_000,
      budgetLeft: 12_800,
      goal: 8_000_000,
      verified: 3_200_000,
      rateLabel: '120K views → 1 DRIP',
      dripPerKViews: 0.00833,
      participants: 524,
      active: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'c4',
      project: 'Drift Protocol',
      logo: 'DRIFT',
      budgetTotal: 12_000,
      budgetLeft: 11_200,
      goal: 4_000_000,
      verified: 210_000,
      rateLabel: '90K views → 1 DRIP',
      dripPerKViews: 0.01111,
      participants: 198,
      active: true,
      createdAt: new Date().toISOString(),
    },
  ];

  getOrCreateVault(walletAddress: string): Vault {
    if (!this.vaults.has(walletAddress)) {
      this.vaults.set(walletAddress, {
        walletAddress,
        balance: 0,
        claimable: 0,
        lifetimeEarned: 0,
        fillPct: 0,
        lastUpdated: new Date().toISOString(),
      });
    }
    return this.vaults.get(walletAddress)!;
  }
}

export const store = new Store();
