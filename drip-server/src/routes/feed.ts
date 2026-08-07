import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export const feedRouter = Router();

/**
 * GET /api/feed
 * Returns the 20 most recent post submissions across all users.
 * Used for the community live feed on the frontend.
 */
feedRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const posts = await prisma.post.findMany({
      orderBy: { submittedAt: 'desc' },
      take: 20,
      include: {
        user:     { select: { twitterHandle: true, twitterPfp: true } },
        campaign: { select: { project: true } },
      },
    });

    const feed = posts.map(p => ({
      id:         p.id,
      handle:     p.user.twitterHandle,
      pfp:        p.user.twitterPfp,
      campaign:   p.campaign.project,
      impressions: p.impressions,
      earned:     p.totalEarned,
      tweetUrl:   p.tweetUrl,
      submittedAt: p.submittedAt,
    }));

    res.json({ feed });
  } catch (err) {
    console.error('[Feed] Error:', err);
    res.status(500).json({ error: 'Failed to load feed' });
  }
});
