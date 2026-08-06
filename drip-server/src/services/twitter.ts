import axios from 'axios';

const client = axios.create({
  baseURL: 'https://api.twitterapi.io',
  headers: { 'X-API-Key': process.env.TWITTER_API_KEY },
  timeout: 10_000,
});

export interface TweetData {
  id: string;
  text: string;
  viewCount: number;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  quoteCount: number;
  bookmarkCount: number;
  createdAt: string;
  author: {
    userName: string;
    id: string;
    name: string;
    profilePicture: string;
    followers: number;
    isBlueVerified: boolean;
  };
}

export interface UserData {
  userName: string;
  id: string;
  name: string;
  profilePicture: string;
  followers: number;
  following: number;
  isBlueVerified: boolean;
  description: string;
}

/** Extract tweet ID from any x.com / twitter.com URL */
export function extractTweetId(url: string): string | null {
  const m = url.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/);
  return m?.[1] ?? null;
}

/** Fetch one or more tweets by ID */
export async function getTweet(tweetId: string): Promise<TweetData | null> {
  try {
    const res = await client.get<{ tweets: RawTweet[]; status: string }>('/twitter/tweets', {
      params: { tweet_ids: tweetId },
    });
    const raw = res.data?.tweets?.[0];
    if (!raw) return null;
    return mapTweet(raw);
  } catch (err) {
    console.error('[Twitter] getTweet error:', (err as Error).message);
    return null;
  }
}

/** Fetch a Twitter user by @handle */
export async function getUser(username: string): Promise<UserData | null> {
  try {
    const clean = username.replace(/^@/, '');
    const res = await client.get<{ data: RawUser; status: string }>('/twitter/user/info', {
      params: { userName: clean },
    });
    const raw = res.data?.data;
    if (!raw) return null;
    return {
      userName: raw.userName,
      id: raw.id,
      name: raw.name,
      profilePicture: raw.profilePicture ?? '',
      followers: raw.followers ?? 0,
      following: raw.following ?? 0,
      isBlueVerified: raw.isBlueVerified ?? false,
      description: raw.description ?? '',
    };
  } catch (err) {
    console.error('[Twitter] getUser error:', (err as Error).message);
    return null;
  }
}

// ─── Raw API types ────────────────────────────────────────────────────────────

interface RawTweet {
  id: string;
  text: string;
  viewCount?: number;
  likeCount?: number;
  retweetCount?: number;
  replyCount?: number;
  quoteCount?: number;
  bookmarkCount?: number;
  createdAt?: string;
  author?: RawUser;
}

interface RawUser {
  userName: string;
  id: string;
  name: string;
  profilePicture?: string;
  followers?: number;
  following?: number;
  isBlueVerified?: boolean;
  description?: string;
}

function mapTweet(raw: RawTweet): TweetData {
  return {
    id:            raw.id,
    text:          raw.text,
    viewCount:     raw.viewCount     ?? 0,
    likeCount:     raw.likeCount     ?? 0,
    retweetCount:  raw.retweetCount  ?? 0,
    replyCount:    raw.replyCount    ?? 0,
    quoteCount:    raw.quoteCount    ?? 0,
    bookmarkCount: raw.bookmarkCount ?? 0,
    createdAt:     raw.createdAt     ?? '',
    author: {
      userName:       raw.author?.userName       ?? '',
      id:             raw.author?.id             ?? '',
      name:           raw.author?.name           ?? '',
      profilePicture: raw.author?.profilePicture ?? '',
      followers:      raw.author?.followers      ?? 0,
      isBlueVerified: raw.author?.isBlueVerified ?? false,
    },
  };
}
