import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthPayload } from '../middleware/auth';
import { extractTweetId, getTweet } from '../services/twitter';
import { refreshPostMetrics } from '../services/rewards';

export const postsRouter = Router();

/** POST /api/posts/submit — verify tweet ownership via X API and start tracking */
postsRouter.post('/submit', requireAuth, async (req: Request, res: Response) => {
  const { tweetUrl, campaignId } = req.body as { tweetUrl: string; campaignId: string };
  const auth = (req as Request & { user: AuthPayload }).user;

  if (!tweetUrl || !campaignId) {
    res.status(400).json({ error: 'tweetUrl and campaignId are required' });
    return;
  }

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId, active: true } });
  if (!campaign) { res.status(404).json({ error: 'Campaign not found or inactive' }); return; }
  if (Number(campaign.budgetLeft) <= 0) { res.status(400).json({ error: 'Campaign budget exhausted' }); return; }

  const tweetId = extractTweetId(tweetUrl);
  if (!tweetId) { res.status(400).json({ error: 'Invalid tweet URL' }); return; }

  const existing = await prisma.post.findUnique({ where: { tweetId } });
  if (existing) { res.status(409).json({ error: 'Tweet already submitted' }); return; }

  // Fetch tweet from twitterapi.io
  const tweet = await getTweet(tweetId);
  if (!tweet) { res.status(404).json({ error: 'Tweet not found or deleted' }); return; }

  // Verify the tweet was posted by the authenticated X account
  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) { res.status(401).json({ error: 'User not found' }); return; }

  const tweetAuthor = tweet.author.userName.toLowerCase().replace(/^@/, '');
  const claimedHandle = user.twitterHandle.toLowerCase().replace(/^@/, '');
  if (tweetAuthor !== claimedHandle) {
    res.status(403).json({
      error: `Tweet was posted by @${tweet.author.userName}, not @${user.twitterHandle}`,
    });
    return;
  }

  const post = await prisma.post.create({
    data: {
      userId: user.id,
      tweetId,
      tweetUrl,
      campaignId,
      impressions: tweet.viewCount,
      verified: true,
    },
  });

  // First participant check
  const postCount = await prisma.post.count({ where: { userId: user.id, campaignId } });
  if (postCount === 1) {
    await prisma.campaign.update({ where: { id: campaignId }, data: { participants: { increment: 1 } } });
  }

  // Background metrics refresh
  refreshPostMetrics(post.id).catch(console.error);

  res.json({ post, tweet: { viewCount: tweet.viewCount, text: tweet.text }, message: 'Tweet verified — tracking started' });
});

/** GET /api/posts/me — posts for the authenticated user */
postsRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  const { userId } = (req as Request & { user: AuthPayload }).user;
  const posts = await prisma.post.findMany({
    where: { userId },
    include: { campaign: true },
    orderBy: { submittedAt: 'desc' },
  });
  res.json({ posts });
});
