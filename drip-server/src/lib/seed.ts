import { prisma } from './prisma';

const CAMPAIGNS = [
  { id: 'c1', project: 'Solana Foundation', logo: 'SOL', budgetTotal: 20000, budgetLeft: 14230, goal: 10_000_000, verified: 6_421_000, rateLabel: '100K views → 1 DRIP', dripPerKViews: 0.01 },
  { id: 'c2', project: 'Jupiter Exchange',  logo: 'JUP', budgetTotal: 8000,  budgetLeft: 7100,  goal: 5_000_000,  verified: 890_000,   rateLabel: '80K views → 1 DRIP',  dripPerKViews: 0.0125 },
  { id: 'c3', project: 'Pyth Network',      logo: 'PYTH',budgetTotal: 15000, budgetLeft: 12800, goal: 8_000_000,  verified: 3_200_000, rateLabel: '120K views → 1 DRIP', dripPerKViews: 0.00833 },
  { id: 'c4', project: 'Drift Protocol',    logo: 'DRIFT',budgetTotal:12000, budgetLeft:11200,  goal: 4_000_000,  verified: 210_000,   rateLabel: '90K views → 1 DRIP',  dripPerKViews: 0.01111 },
];

export async function seedCampaigns() {
  // Seeding disabled — campaigns are created by project owners via the platform
}
