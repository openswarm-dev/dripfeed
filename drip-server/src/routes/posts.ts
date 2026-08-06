import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { store } from '../store';
import { extractTweetId, getTweet } from '../services/twitter';
import { refreshPostMetrics } from '../services/rewards';

export const postsRouter = Router();

/** POST /api/posts/submit — verify tweet ownership and begin tracking */
postsRouter.post('/submit', async (req: Request, res: Response) => {
  const { walletAddress, twitterHandle, tweetUrl, campaignId } = req.body as {
    walletAddress: string;
    twitterHandle: string;
    tweetUrl:      string;
    campaignId:    string;
  };

  if (!walletAddress || !twitterHandle || !tweetUrl || !campaignId) {
    res.status(400).json({ error: 'Missing required fields: walletAddress, twitterHandle, tweetUrl, campaignId' });
    return;
  }

  const campaign = store.campaigns.find(c => c.id === campaignId && c.active);
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found or inactive' });
    return;
  }

  if (campaign.budgetLeft <= 0) {
    res.status(400).json({ error: 'Campaign budget exhausted' });
    return;
  }

  const tweetId = extractTweetId(tweetUrl);
  if (!tweetId) {
    res.status(400).json({ error: 'Invalid tweet URL — must be an x.com or twitter.com /status/ link' });
    return;
  }

  // Duplicate check
  const duplicate = Array.from(store.posts.values()).find(p => p.tweetId === tweetId);
  if (duplicate) {
    res.status(409).json({ error: 'Tweet already submitted to this campaign' });
    return;
  }

  // Fetch from twitterapi.io
  const tweet = await getTweet(tweetId);
  if (!tweet) {
    res.status(404).json({ error: 'Tweet not found — it may have been deleted or the ID is invalid' });
    return;
  }

  // Verify authorship: tweet must be posted by the claimed X handle
  const tweetAuthor  = tweet.author.userName.toLowerCase().replace(/^@/, '');
  const claimedHandle = twitterHandle.toLowerCase().replace(/^@/, '');
  if (tweetAuthor !== claimedHandle) {
    res.status(403).json({
      error: `Tweet was posted by @${tweet.author.userName}, not @${twitterHandle}. Submit a tweet from your own account.`,
    });
    return;
  }

  const post = {
    id:             uuidv4(),
    walletAddress,
    twitterHandle:  claimedHandle,
    tweetId,
    tweetUrl,
    campaignId,
    impressions:    tweet.viewCount,
    totalEarned:    0,
    verified:       true,
    submittedAt:    new Date().toISOString(),
    lastRefreshed:  new Date().toISOString(),
  };

  store.posts.set(post.id, post);

  // Ensure user record exists
  if (!store.users.has(walletAddress)) {
    store.users.set(walletAddress, {
      walletAddress,
      twitterHandle: claimedHandle,
      connectedAt: new Date().toISOString(),
    });
  }

  // Increment participant count once per wallet per campaign
  const existingPosts = Array.from(store.posts.values()).filter(
    p => p.walletAddress === walletAddress && p.campaignId === campaignId,
  );
  if (existingPosts.length === 1) campaign.participants++;

  store.getOrCreateVault(walletAddress);

  // Initial earnings calculation (don't await — happens in background)
  refreshPostMetrics(post.id).catch(console.error);

  res.json({ post, tweet: { viewCount: tweet.viewCount, text: tweet.text }, message: 'Tweet verified — tracking started' });
});

/** GET /api/posts/wallet/:address — all posts for a wallet */
postsRouter.get('/wallet/:address', (req: Request, res: Response) => {
  const posts = Array.from(store.posts.values())
    .filter(p => p.walletAddress === req.params.address)
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  res.json({ posts });
});
