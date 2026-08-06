import { Router, Request, Response } from 'express';
import { store } from '../store';

export const vaultRouter = Router();

/** GET /api/vault/:address — vault state for a wallet */
vaultRouter.get('/:address', (req: Request, res: Response) => {
  const vault = store.getOrCreateVault(req.params.address as string);
  res.json({ vault });
});

/** GET /api/vault/:address/posts — tracked posts with live rate */
vaultRouter.get('/:address/posts', (req: Request, res: Response) => {
  const posts = Array.from(store.posts.values()).filter(
    p => p.walletAddress === req.params.address && p.verified,
  );

  const enriched = posts.map(post => {
    const campaign = store.campaigns.find(c => c.id === post.campaignId);
    const dripHr   = campaign ? +((post.impressions / 1_000) * campaign.dripPerKViews).toFixed(4) : 0;
    return { ...post, dripHr, campaignName: campaign?.project ?? 'Unknown' };
  });

  res.json({ posts: enriched });
});

/** GET /api/leaderboard — top 20 earners */
vaultRouter.get('/leaderboard/top', (_req: Request, res: Response) => {
  const entries = Array.from(store.vaults.values())
    .sort((a, b) => b.lifetimeEarned - a.lifetimeEarned)
    .slice(0, 20)
    .map(v => {
      const user = store.users.get(v.walletAddress);
      return {
        walletAddress:  v.walletAddress,
        twitterHandle:  user?.twitterHandle ?? '',
        lifetimeEarned: v.lifetimeEarned,
        balance:        v.balance,
      };
    });
  res.json({ leaderboard: entries });
});
