import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, validateConfig } from './config.js';
import {
  getState,
  initFromReport,
  subscribe,
  heartbeat,
  refreshFromReport,
  setTweetStreamAccounts,
  recalcMetas,
  refreshLaunchVolumes,
} from './liveStore.js';
import { startGeyserFeed } from './geyserFeed.js';
import { startRpcPollFeed } from './rpcPollFeed.js';
import {
  startTweetStreamFeed,
  setupTweetStreamAccounts,
  fetchTweetStreamMe,
} from './tweetStreamFeed.js';
import { enrichLaunchLive } from './enrich.js';
import { getState, updateLaunch } from './liveStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const HOST = process.env.HOST || '0.0.0.0';

async function logOutboundIp() {
  if (!process.env.RAILWAY_ENVIRONMENT && !process.env.RENDER) return;
  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(8000) });
    const data = await res.json() as { ip?: string };
    if (data.ip) {
      console.log(`  Outbound egress IP: ${data.ip}`);
    }
  } catch {
    /* non-fatal */
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.svg': 'image/svg+xml',
};

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function applyCors(req: http.IncomingMessage, res: http.ServerResponse) {
  const origin = req.headers.origin;
  if (!origin) return;
  const ok =
    origin.includes('localhost')
    || origin.includes('127.0.0.1')
    || origin.endsWith('.railway.app')
    || origin.endsWith('.up.railway.app')
    || origin.endsWith('.onrender.com')
    || ALLOWED_ORIGINS.includes(origin);
  if (ok) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

function buildReportPayload() {
  const state = getState();
  return {
    generatedAt: state.metas.generatedAt,
    days: state.metas.lookbackDays,
    totalLaunches: state.metas.totalLaunches,
    metas: state.metas,
    launches: state.launches.slice(0, 500),
    sparks: state.sparks,
    geyserStats: state.geyserStats,
    geyserEnabled: config.geyserEnabled,
    live: {
      connected: state.connected,
      feeds: state.feeds,
      liveLaunches: state.liveLaunches,
      liveSparks: state.liveSparks,
      lastLaunchAt: state.lastLaunchAt,
      lastSparkAt: state.lastSparkAt,
    },
  };
}

function buildStreamInitPayload() {
  const state = getState();
  return {
    ...state,
    geyserEnabled: config.geyserEnabled,
  };
}

validateConfig();
initFromReport();
setTweetStreamAccounts(config.tweetstreamAccounts);

const server = http.createServer((req, res) => {
  const url = req.url?.split('?')[0] ?? '/';

  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'betttr-radar' }));
    return;
  }

  if (url === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...getState(), geyserEnabled: config.geyserEnabled }));
    return;
  }

  if (url === '/api/report') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(buildReportPayload()));
    return;
  }

  if (url === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`event: init\ndata: ${JSON.stringify(buildStreamInitPayload())}\n\n`);

    const send = (data: string) => res.write(data);
    const unsub = subscribe(send);

    req.on('close', () => {
      unsub();
    });
    return;
  }

  const file = url === '/' ? '/index.html' : url;
  const filePath = path.join(PUBLIC, file);
  if (!filePath.startsWith(PUBLIC) || !fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});

async function enrichStaleLaunches() {
  const pending = getState().launches
    .filter((l) => {
      const hasLabel = (l.symbol?.trim() || l.name?.trim()) && l.symbol !== l.mint.slice(0, 8);
      return !hasLabel || !l.image;
    })
    .slice(0, 12);

  for (const l of pending) {
    try {
      const enriched = await enrichLaunchLive(l);
      updateLaunch(enriched);
    } catch {
      /* retry next interval */
    }
  }
}

server.listen(config.port, HOST, async () => {
  console.log(`\n  Betttr.xyz Meta Radar (live)`);
  console.log(`  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${config.port}\n`);

  setInterval(heartbeat, 25_000);
  setInterval(recalcMetas, 10_000);
  setInterval(() => void refreshLaunchVolumes(), 30_000);
  setInterval(refreshFromReport, 60_000);
  setInterval(() => void enrichStaleLaunches(), 12_000);

  if (config.tweetstreamApiKey) {
    await fetchTweetStreamMe();
    await setupTweetStreamAccounts();
    startTweetStreamFeed();
  } else {
    console.log('  TweetStream off — set TWEETSTREAM_API_KEY\n');
  }

  void logOutboundIp();

  const pollMode = config.rpcPollMode;
  if (pollMode === 'only' || pollMode === 'backup') {
    startRpcPollFeed().catch((err) => {
      console.error('RPC poll feed failed:', err?.message ?? err);
    });
  }

  if (config.geyserEnabled && pollMode !== 'only') {
    startGeyserFeed().catch((err) => {
      console.error('Geyser feed failed:', err?.message ?? err);
    });
  } else if (pollMode === 'only') {
    console.log('  Geyser gRPC off — RPC poll only (GEYSER_RPC_POLL=only)\n');
  } else if (!config.geyserEnabled) {
    console.log('  Geyser off — set BETTTR_GEYSER=true or NARRA_GEYSER=true\n');
  }
});
