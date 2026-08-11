export interface SocialSpark {
  id: string;
  tweetId: string;
  handle: string;
  name?: string;
  text: string;
  kind: string;
  createdAt: number;
  receivedAt: number;
  link?: string;
  tokens?: Array<{ symbol?: string; contract?: string; priceUsd?: number }>;
  terms: string[];
}

const STOP = new Set([
  'the', 'and', 'coin', 'token', 'sol', 'pump', 'fun', 'new', 'official',
  'real', 'true', 'just', 'for', 'you', 'this', 'that', 'with', 'from',
  'http', 'https', 'com',
]);

export function extractSparkTerms(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s$#@]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w.replace(/^[@$]/, '')));

  const terms = new Set<string>();
  for (const w of words) {
    terms.add(w.replace(/^[@$]/, ''));
  }

  const parts = text.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  for (let i = 0; i < parts.length - 1; i++) {
    const bigram = `${parts[i]!.replace(/^[@$]/, '')} ${parts[i + 1]!.replace(/^[@$]/, '')}`;
    if (bigram.length >= 5) terms.add(bigram);
  }

  return [...terms];
}

export function sparkFromTweet(payload: {
  tweetId: string;
  text: string;
  kind?: string;
  createdAt: number;
  link?: string;
  author?: { handle?: string; name?: string };
  detected?: {
    tokens?: Array<{ symbol?: string; contract?: string; priceUsd?: number }>;
  };
}): SocialSpark {
  const handle = payload.author?.handle?.replace(/^@/, '') ?? 'unknown';
  return {
    id: payload.tweetId,
    tweetId: payload.tweetId,
    handle,
    name: payload.author?.name,
    text: payload.text,
    kind: payload.kind ?? 'post',
    createdAt: payload.createdAt,
    receivedAt: Math.floor(Date.now() / 1000),
    link: payload.link ?? `https://x.com/${handle}/status/${payload.tweetId}`,
    tokens: payload.detected?.tokens,
    terms: extractSparkTerms(payload.text),
  };
}

export function findSparkForTheme(theme: string, sparks: SocialSpark[]): SocialSpark | undefined {
  const t = theme.toLowerCase();
  return sparks.find((s) =>
    s.terms.some((term) => t.includes(term) || term.includes(t)) ||
    s.text.toLowerCase().includes(t),
  );
}
