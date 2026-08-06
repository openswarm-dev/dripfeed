import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthPayload } from '../middleware/auth';

export const vaultRouter = Router();

/** GET /api/vault/me — vault for the authenticated user */
vaultRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  const { userId } = (req as Request & { user: AuthPayload }).user;

  const vault = await prisma.vault.findUnique({ where: { userId } });
  if (!vault) { res.status(404).json({ error: 'Vault not found' }); return; }
  res.json({ vault });
});

/** GET /api/vault/leaderboard — top 20 earners */
vaultRouter.get('/leaderboard', async (_req: Request, res: Response) => {
  const vaults = await prisma.vault.findMany({
    where: { lifetimeEarned: { gt: 0 } },
    orderBy: { lifetimeEarned: 'desc' },
    take: 20,
    include: { user: { select: { twitterHandle: true, twitterPfp: true, walletAddress: true } } },
  });
  res.json({ leaderboard: vaults });
});
