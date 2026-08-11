import WebSocket from 'ws';
import { config } from './config.js';
import { addSpark, setTweetStreamConnected } from './liveStore.js';
import { sparkFromTweet } from './socialSpark.js';

const API = 'https://api.tweetstream.io';

type StreamEnvelope = {
  t?: string;
  op?: string;
  d?: Record<string, unknown>;
};

export async function setupTweetStreamAccounts(): Promise<void> {
  if (!config.tweetstreamApiKey || !config.tweetstreamAccounts.length) return;

  try {
    const meRes = await fetch(`${API}/api/me`, {
      headers: { Authorization: `Bearer ${config.tweetstreamApiKey}` },
    });
    const me = await meRes.json();
    const tracked = new Set<string>(
      (me?.trackedAccounts?.handles ?? []).map((h: string) => h.toLowerCase()),
    );

    const missing = config.tweetstreamAccounts.filter(
      (a) => !tracked.has(a.toLowerCase()),
    );
    if (!missing.length) {
      console.log('  TweetStream watchlist: all accounts already tracked');
      return;
    }

    const res = await fetch(`${API}/api/add-account`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.tweetstreamApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ accounts: missing }),
    });
    const data = await res.json();
    console.log('  TweetStream watchlist:', JSON.stringify(data?.results ?? data));
  } catch (err: any) {
    console.error('  TweetStream account setup failed:', err?.message ?? err);
  }
}

export async function fetchTweetStreamMe(): Promise<void> {
  if (!config.tweetstreamApiKey) return;
  try {
    const res = await fetch(`${API}/api/me`, {
      headers: { Authorization: `Bearer ${config.tweetstreamApiKey}` },
    });
    const data = await res.json();
    const tracked = data?.trackedAccounts?.handles ?? [];
    const ws = data?.websocket;
    console.log(
      `  TweetStream plan: ${data?.plan ?? '?'} · ${tracked.length}/${data?.trackedAccounts?.limit ?? '?'} accounts · WS ${ws?.active ?? 0}/${ws?.limit ?? 1}`,
    );
    if (tracked.length) {
      console.log(`  Tracking: ${tracked.join(', ')}`);
    }
  } catch (err: any) {
    console.error('  TweetStream /api/me failed:', err?.message ?? err);
  }
}

export function startTweetStreamFeed() {
  if (!config.tweetstreamApiKey) {
    console.log('  TweetStream off — set TWEETSTREAM_API_KEY in narra/.env\n');
    return;
  }

  let retry = 0;
  let ws: WebSocket | null = null;

  const connect = () => {
    ws = new WebSocket(config.tweetstreamWsUrl, [
      'tweetstream.v1',
      `tweetstream.auth.token.${config.tweetstreamApiKey}`,
    ]);

    ws.on('open', () => {
      retry = 0;
      setTweetStreamConnected(true);
      console.log('  TweetStream connected — waiting for posts from watchlist\n');
    });

    ws.on('message', (raw) => {
      try {
        const event = JSON.parse(raw.toString()) as StreamEnvelope;
        routeEvent(event);
      } catch {
        /* ignore malformed */
      }
    });

    ws.on('close', (code, reason) => {
      setTweetStreamConnected(false);
      console.warn(`  TweetStream closed (${code}) ${reason.toString()}`);
      const delayMs = Math.min(30_000, 1000 * 2 ** retry) + Math.floor(Math.random() * 500);
      retry += 1;
      setTimeout(connect, delayMs);
    });

    ws.on('error', (err) => {
      if (!err.message.includes('429')) {
        console.error('  TweetStream error:', err.message);
      }
    });
  };

  connect();
}

function routeEvent(event: StreamEnvelope) {
  if (event.t === 'tweet' && event.op === 'content') {
    const d = event.d as {
      tweetId?: string;
      text?: string;
      kind?: string;
      createdAt?: number;
      link?: string;
      author?: { handle?: string; name?: string };
    };
    if (!d?.tweetId || !d.text) return;

    const spark = sparkFromTweet({
      tweetId: d.tweetId,
      text: d.text,
      kind: d.kind,
      createdAt: d.createdAt ?? Math.floor(Date.now() / 1000),
      link: d.link,
      author: d.author,
    });
    addSpark(spark);
    console.log(`[x] @${spark.handle}: ${spark.text.slice(0, 80)}…`);
    return;
  }

  if (event.t === 'tweet' && event.op === 'meta') {
    // Token/OCR enrichment arrives after content — logged only for now
    const d = event.d as { tweetId?: string; detected?: unknown };
    if (d?.detected) {
      console.log(`[x-meta] ${d.tweetId}`, JSON.stringify(d.detected).slice(0, 120));
    }
  }
}
