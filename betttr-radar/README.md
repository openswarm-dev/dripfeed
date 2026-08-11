# Narra — Pump.fun narrative scanner

Finds Pump.fun token **creates** from the last 2–4 days, classifies them into narrative categories, and shows a report.

## How it works

| Source | Use |
|--------|-----|
| **ERPC HTTP RPC** | Backfill historical creates (last N days) |
| **ERPC Geyser gRPC** | Live stream of new creates going forward |
| **DexScreener** | Name/symbol/market cap enrichment |
| **Keyword classifier** | Narrative categories (AI, animals, political, etc.) |

> Geyser is **real-time only** — it cannot replay the last 2–4 days. Historical scans use RPC pagination on the Pump.fun program.

## Setup

```bash
cd narra
npm install
```

Uses `SOLANA_RPC_URL` and `GEYSER_ENDPOINT` from `../.env` automatically (or set `narra/.env`).

## Commands

```bash
# Scan last 3 days (default)
npm run scan

# Scan last 4 days, more pages
npm run scan -- --days 4 --pages 120

# Stream new launches via Geyser gRPC
npm run live

# Print CLI summary
npm run report

# Web UI
npm run dev
# → http://localhost:3950
```

Output saved to `narra/data/latest.json`.

## Narrative categories

AI / Agents, Animals / Pepe, Political, Celebrity, Gaming, DeFi, Food, Internet Culture, Meta / Pump, Tech, Absurdist, Other.

Classification is keyword-based on token name, symbol, description, and mint — good for trend spotting, not perfect taxonomy.
