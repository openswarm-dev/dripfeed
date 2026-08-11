import { getTweet } from './twitter';
import { prisma } from '../lib/prisma';

function engagementScore(
  views: number, likes: number, retweets: number,
  replies: number, quotes: number, followers: number,
): number {
  const base = views + likes * 2 + retweets * 3 + quotes * 4 + replies * 2;
  const followerMult = Math.min(1.5, 1 + Math.log10(Math.max(1, followers)) / 20);
  return base * followerMult;
}

export async function refreshPostMetrics(postId: string): Promise<void> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { campaign: true, user: true },
  });
  if (!post?.verified || !post.campaign) return;

  const tweet = await getTweet(post.tweetId);
  if (!tweet) return;

  const newScore = engagementScore(
    tweet.viewCount, tweet.likeCount, tweet.retweetCount,
    tweet.replyCount, tweet.quoteCount, tweet.author.followers,
  );
  const prevScore = Number(post.impressions);
  const delta     = Math.max(0, newScore - prevScore);
  const earned    = (delta / 1_000) * Number(post.campaign.dripPerKViews);

  await prisma.post.update({
    where: { id: postId },
    data: {
      impressions:   newScore,
      totalEarned:   { increment: earned },
      lastRefreshed: new Date(),
    },
  });

  if (earned > 0) {
    const vault = await prisma.vault.findUnique({ where: { userId: post.userId } });
    if (!vault) return;

    const newBalance = Number(vault.balance) + earned;
    await prisma.vault.update({
      where: { userId: post.userId },
      data: {
        balance:        { increment: earned },
        claimable:      { increment: earned * 0.65 },
        lifetimeEarned: { increment: earned },
        fillPct:        Math.min(95, (newBalance / 2_000) * 100),
      },
    });
  }
}

export function startRewardEngine(): void {
  const interval = Number(process.env.REWARD_POLL_INTERVAL_MS) || 5 * 60_000;

  async function tick() {
    try {
      const posts = await prisma.post.findMany({ where: { verified: true } });
      if (posts.length === 0) return;
      console.log(`[RewardEngine] Refreshing ${posts.length} post(s)…`);
      await Promise.allSettled(posts.map(p => refreshPostMetrics(p.id)));
    } catch (err) {
      console.error('[RewardEngine] Tick failed:', err);
    }
  }

  setTimeout(tick, 30_000);
  setInterval(tick, interval);
  console.log(`[RewardEngine] Started — polling every ${interval / 1000}s`);
}
