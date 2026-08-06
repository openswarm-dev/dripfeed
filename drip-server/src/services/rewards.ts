import { getTweet } from './twitter';
import { store } from '../store';

/**
 * Scoring formula — weighted engagement score per 1K views.
 * Retweetes carry 3×, quotes 4×, replies 2× the weight of plain views.
 * Followers-adjusted multiplier rewards high-quality audiences.
 */
function engagementScore(
  views: number,
  likes: number,
  retweets: number,
  replies: number,
  quotes: number,
  authorFollowers: number,
): number {
  const base = views + likes * 2 + retweets * 3 + quotes * 4 + replies * 2;
  // Follower multiplier: tiny boost for larger accounts, capped so bots can't abuse
  const followerMult = Math.min(1.5, 1 + Math.log10(Math.max(1, authorFollowers)) / 20);
  return base * followerMult;
}

/**
 * Calculate DRIP earned for a given raw score delta and campaign rate.
 */
export function calculateEarnings(scoreDelta: number, dripPerKViews: number): number {
  return (scoreDelta / 1_000) * dripPerKViews;
}

/**
 * Refresh metrics for a single post, update vault balance.
 */
export async function refreshPostMetrics(postId: string): Promise<void> {
  const post = store.posts.get(postId);
  if (!post?.verified) return;

  const tweet = await getTweet(post.tweetId);
  if (!tweet) return;

  const newScore = engagementScore(
    tweet.viewCount,
    tweet.likeCount,
    tweet.retweetCount,
    tweet.replyCount,
    tweet.quoteCount,
    tweet.author.followers,
  );

  // Use raw viewCount as the stored impression baseline for display
  const prevScore = post.impressions; // repurposed as composite score
  const delta     = Math.max(0, newScore - prevScore);
  const campaign  = store.campaigns.find(c => c.id === post.campaignId);
  if (!campaign) return;

  const earned = calculateEarnings(delta, campaign.dripPerKViews);

  post.impressions  = newScore;                             // store composite score
  post.totalEarned += earned;
  post.lastRefreshed = new Date().toISOString();

  // Update campaign verified impressions (raw views for display)
  campaign.verified += tweet.viewCount - (campaign.verified ?? 0);

  // Update vault
  const vault        = store.getOrCreateVault(post.walletAddress);
  vault.balance     += earned;
  vault.claimable   += earned * 0.65;                       // 65% immediately claimable
  vault.lifetimeEarned += earned;
  vault.fillPct      = Math.min(95, (vault.balance / 2_000) * 100);
  vault.lastUpdated  = new Date().toISOString();
}

/**
 * Background worker — polls all active posts on a configurable interval.
 */
export function startRewardEngine(): void {
  const interval = Number(process.env.REWARD_POLL_INTERVAL_MS) || 5 * 60_000;

  async function tick() {
    const posts = Array.from(store.posts.values()).filter(p => p.verified);
    if (posts.length === 0) return;
    console.log(`[RewardEngine] Refreshing ${posts.length} post(s)…`);
    const results = await Promise.allSettled(posts.map(p => refreshPostMetrics(p.id)));
    const failed  = results.filter(r => r.status === 'rejected').length;
    if (failed > 0) console.warn(`[RewardEngine] ${failed} post(s) failed to refresh`);
  }

  // Initial run 30 s after startup (let server settle)
  setTimeout(tick, 30_000);
  setInterval(tick, interval);
  console.log(`[RewardEngine] Started — polling every ${interval / 1000}s`);
}
