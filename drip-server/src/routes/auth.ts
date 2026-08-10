import { Router, Request, Response } from 'express';
import OAuth from 'oauth-1.0a';
import crypto from 'crypto';
import axios from 'axios';
import { prisma } from '../lib/prisma';
import { signToken, requireAuth, AuthPayload } from '../middleware/auth';

export const authRouter = Router();

// Allowed frontend origins (prevents open-redirect abuse)
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3006',
  (process.env.FRONTEND_URL ?? '').trim(),
  ...(process.env.EXTRA_ORIGINS ? process.env.EXTRA_ORIGINS.split(',').map(s => s.trim()) : []),
].filter(Boolean));

interface PendingToken { secret: string; returnUrl: string; }
// Temporary store for OAuth request tokens (expires quickly, in-memory is fine)
const pendingTokens = new Map<string, PendingToken>(); // oauth_token → { secret, returnUrl }

function makeOAuth() {
  return new OAuth({
    consumer: {
      key: process.env.X_CONSUMER_KEY!,
      secret: process.env.X_CONSUMER_SECRET!,
    },
    signature_method: 'HMAC-SHA1',
    hash_function: (base, key) =>
      crypto.createHmac('sha1', key).update(base).digest('base64'),
  });
}

// ── Step 1: Redirect user to X sign-in ──────────────────────────────────────
authRouter.get('/x', async (req: Request, res: Response) => {
  // ?return= lets the local dev frontend say "send me back to localhost"
  const returnParam = (req.query.return as string ?? '').trim();
  const defaultFrontend = (process.env.FRONTEND_URL ?? 'http://localhost:3000').trim();
  const returnUrl = ALLOWED_ORIGINS.has(returnParam) ? returnParam : defaultFrontend;

  try {
    const oauth = makeOAuth();
    const callbackUrl = `${(process.env.SERVER_URL ?? '').trim()}/api/auth/x/callback`;

    // oauth_callback MUST be in the signature base string (include it in data)
    const requestData = {
      url: 'https://api.twitter.com/oauth/request_token',
      method: 'POST',
      data: { oauth_callback: callbackUrl },
    };
    const headers = oauth.toHeader(oauth.authorize(requestData)) as unknown as Record<string, string>;

    const response = await axios.post(
      'https://api.twitter.com/oauth/request_token',
      new URLSearchParams({ oauth_callback: callbackUrl }),
      { headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    const params = new URLSearchParams(response.data as string);
    const oauthToken       = params.get('oauth_token')!;
    const oauthTokenSecret = params.get('oauth_token_secret')!;

    pendingTokens.set(oauthToken, { secret: oauthTokenSecret, returnUrl });

    res.redirect(`https://api.twitter.com/oauth/authorize?oauth_token=${oauthToken}`);
  } catch (err) {
    console.error('[Auth] Failed to get request token:', err);
    res.redirect(`${returnUrl}?auth_error=request_token_failed`);
  }
});

// ── Step 2: X redirects here after user authorises ──────────────────────────
authRouter.get('/x/callback', async (req: Request, res: Response) => {
  const { oauth_token, oauth_verifier } = req.query as Record<string, string>;
  const defaultFrontend = (process.env.FRONTEND_URL ?? 'http://localhost:3000').trim();

  if (!oauth_token || !oauth_verifier) {
    res.redirect(`${defaultFrontend}?auth_error=denied`);
    return;
  }

  const pending = pendingTokens.get(oauth_token);
  if (!pending) {
    res.redirect(`${defaultFrontend}?auth_error=token_expired`);
    return;
  }
  const { secret: oauthTokenSecret, returnUrl: frontendUrl } = pending;
  pendingTokens.delete(oauth_token);

  try {
    const oauth = makeOAuth();

    // Exchange for access token
    const requestData = { url: 'https://api.twitter.com/oauth/access_token', method: 'POST' };
    const tokenData = { key: oauth_token, secret: oauthTokenSecret };
    const headers = oauth.toHeader(oauth.authorize(requestData, tokenData)) as unknown as Record<string, string>;

    const atResponse = await axios.post(
      'https://api.twitter.com/oauth/access_token',
      `oauth_verifier=${encodeURIComponent(oauth_verifier)}`,
      { headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    const atParams = new URLSearchParams(atResponse.data as string);
    const accessToken  = atParams.get('oauth_token')!;
    const accessSecret = atParams.get('oauth_token_secret')!;
    const twitterId    = atParams.get('user_id')!;
    const twitterHandle = atParams.get('screen_name')!;

    // Fetch full profile for name + pfp
    let twitterName = twitterHandle;
    let twitterPfp  = '';
    let twitterFollowers = 0;
    try {
      const profileReqData = { url: 'https://api.twitter.com/1.1/account/verify_credentials.json', method: 'GET' };
      const profileHeaders = oauth.toHeader(oauth.authorize(profileReqData, { key: accessToken, secret: accessSecret })) as unknown as Record<string, string>;
      const profileRes = await axios.get(
        'https://api.twitter.com/1.1/account/verify_credentials.json?include_email=false',
        { headers: profileHeaders },
      );
      twitterName = profileRes.data.name ?? twitterHandle;
      twitterPfp  = (profileRes.data.profile_image_url_https ?? '').replace('_normal', '_400x400');
      twitterFollowers = profileRes.data.followers_count ?? 0;
    } catch { /* profile fetch is best-effort */ }

    // Upsert user in DB
    const user = await prisma.user.upsert({
      where: { twitterId },
      create: { twitterId, twitterHandle, twitterName, twitterPfp, twitterFollowers, oauthToken: accessToken, oauthSecret: accessSecret },
      update: { twitterHandle, twitterName, twitterPfp, twitterFollowers, oauthToken: accessToken, oauthSecret: accessSecret },
    });

    // Ensure vault exists
    await prisma.vault.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    });

    const jwt = signToken({ userId: user.id, twitterId, twitterHandle });

    // Redirect back to frontend with token in URL
    res.redirect(`${frontendUrl}?token=${jwt}&handle=${twitterHandle}`);
  } catch (err) {
    console.error('[Auth] Callback error:', err);
    res.redirect(`${frontendUrl}?auth_error=callback_failed`);
  }
});

// ── Link Phantom wallet to account ──────────────────────────────────────────
authRouter.post('/wallet', requireAuth, async (req: Request, res: Response) => {
  const { walletAddress } = req.body as { walletAddress: string };
  const user = (req as Request & { user: AuthPayload }).user;

  if (!walletAddress) {
    res.status(400).json({ error: 'walletAddress required' });
    return;
  }

  try {
    await prisma.user.update({
      where: { id: user.userId },
      data: { walletAddress },
    });
    await prisma.vault.update({
      where: { userId: user.userId },
      data: {},   // vault already exists from OAuth step
    });
    res.json({ success: true, walletAddress });
  } catch (err: unknown) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('Unique constraint')) {
      res.status(409).json({ error: 'This wallet is already linked to another account' });
    } else {
      res.status(500).json({ error: 'Failed to link wallet' });
    }
  }
});

// ── Get current user ────────────────────────────────────────────────────────
authRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  const { userId } = (req as Request & { user: AuthPayload }).user;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { vault: true },
  });
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  res.json({ user: { ...user, oauthToken: undefined, oauthSecret: undefined } });
});
