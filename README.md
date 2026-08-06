# DripFeed

> Web3 creator rewards platform — earn $DRIP tokens for the attention you generate on X.

## Structure

```
dripfeed/
├── drip-frontend/   Next.js 16 app (React 19, Framer Motion, Phantom wallet)
└── drip-server/     Express + TypeScript API (twitterapi.io, Solana SPL)
```

## Quick Start

### 1. drip-server

```bash
cd drip-server
npm install
cp .env.example .env           # fill in your keys
npm run dev                    # starts on http://localhost:4000
```

### 2. drip-frontend

```bash
cd drip-frontend
npm install
cp .env.local.example .env.local
npm run dev                    # starts on http://localhost:3000
```

## Environment Variables

### drip-server `.env`

| Variable | Description |
|---|---|
| `PORT` | Server port (default 4000) |
| `FRONTEND_URL` | CORS origin for the frontend |
| `TWITTER_API_KEY` | [twitterapi.io](https://twitterapi.io/dashboard) API key |
| `SOLANA_RPC_URL` | Solana RPC endpoint (Helius recommended) |
| `TREASURY_PRIVATE_KEY` | Base58 private key of the treasury wallet |
| `DRIP_MINT_ADDRESS` | SPL token mint address for $DRIP |

### drip-frontend `.env.local`

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | drip-server URL |
| `NEXT_PUBLIC_SOLANA_RPC` | Solana RPC (passed to Phantom adapter) |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Server health |
| GET | `/api/campaigns` | List active campaigns |
| POST | `/api/posts/submit` | Submit + verify a tweet |
| GET | `/api/vault/:address` | Vault state for a wallet |
| GET | `/api/vault/:address/posts` | Tracked posts with live DRIP/hr |
| POST | `/api/claims` | Claim DRIP to wallet |
| GET | `/api/vault/leaderboard/top` | Top 20 earners |

## Tweet Verification Flow

1. Creator submits an `x.com/…/status/…` URL
2. Server extracts the tweet ID and calls **twitterapi.io** `GET /twitter/tweets`
3. Tweet author is verified against the creator's claimed X handle
4. `viewCount`, `likeCount`, `retweetCount` etc. are stored
5. Reward engine polls every 5 min, calculates composite engagement score → DRIP

## Wallet Flow

1. Creator enters their X handle on the landing screen
2. Phantom wallet popup opens via `@solana/wallet-adapter-react`
3. `publicKey` is passed to the backend as `walletAddress`
4. DRIP claims trigger SPL token transfers from the treasury wallet

## Tech Stack

- **Frontend**: Next.js 16, React 19, Framer Motion, Tailwind CSS v4, Phantom wallet adapter
- **Backend**: Express.js, TypeScript, axios, @solana/web3.js, @solana/spl-token
- **Twitter data**: [twitterapi.io](https://twitterapi.io) — $0.15/1k tweets
- **Blockchain**: Solana mainnet, SPL tokens
