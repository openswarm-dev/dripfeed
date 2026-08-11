# Deploy betttr-radar on Oracle Cloud Free Tier

One static public IPv4 → whitelist in ERPC → Geyser works.

## 1. Create the VM (Oracle Console)

1. **Compute → Instances → Create instance**
2. **Name:** `betttr-radar`
3. **Image:** Ubuntu 22.04 or 24.04
4. **Shape:** `VM.Standard.A1.Flex` (ARM, Always Free)
   - OCPUs: **2**, Memory: **12 GB** (leave headroom; max free is 4 OCPU / 24 GB)
5. **Region:** `EU Frankfurt` (`eu-frankfurt-1`) if available — closest to ERPC Geyser
6. **Networking:** assign a **public IPv4**
7. **SSH key:** add your public key
8. Create instance

## 2. Open the firewall (Oracle Console)

**Networking → Virtual cloud networks → your VCN → Security Lists → Default**

Add **Ingress** rules:

| Source        | Protocol | Port        |
|---------------|----------|-------------|
| `0.0.0.0/0`   | TCP      | 22 (SSH)    |
| `0.0.0.0/0`   | TCP      | 3950 (radar)|

*(Tighten 3950 later to your frontend host only if you want.)*

## 3. SSH in and run setup

```bash
ssh ubuntu@YOUR_PUBLIC_IP

# One-liner (downloads and runs setup from GitHub)
curl -fsSL https://raw.githubusercontent.com/openswarm-dev/dripfeed/main/betttr-radar/scripts/oracle-setup.sh | sudo bash
```

Or clone and run locally:

```bash
git clone https://github.com/openswarm-dev/dripfeed.git
cd dripfeed/betttr-radar
sudo bash scripts/oracle-setup.sh
```

## 4. Add your API keys

```bash
sudo nano /opt/betttr-radar/.env
```

Required:

```env
BETTTR_GEYSER=true
NARRA_GEYSER=true
GEYSER_RPC_POLL=false

SOLANA_RPC_URL=https://edge.erpc.global?api-key=YOUR_ERPC_KEY
GEYSER_ENDPOINT=http://grpc-fra1-burst.erpc.global

HELIUS_API_KEY=your_helius_key

TWEETSTREAM_API_KEY=your_tweetstream_key
TWEETSTREAM_WS_URL=wss://ws-global.tweetstream.io/ws
TWEETSTREAM_ACCOUNTS=elonmusk;AutismCapital;realDonaldTrump;tier10k;lookonchain

# Your drip-frontend URL (comma-separated if multiple)
ALLOWED_ORIGINS=https://drip-frontend-production-35f0.up.railway.app
```

## 5. Whitelist IP in ERPC

On the VM:

```bash
curl -s https://api.ipify.org
```

Add that **one IP** in your ERPC dashboard for Geyser gRPC.

## 6. Start and verify

```bash
sudo systemctl start betttr-radar
sudo systemctl status betttr-radar
sudo journalctl -u betttr-radar -f
```

You should see:

```
Geyser live: http://grpc-fra1-burst.erpc.global
Geyser connected — streaming all pump.fun creates
[live] V2 ...
```

Health check:

```bash
curl http://YOUR_PUBLIC_IP:3950/health
curl http://YOUR_PUBLIC_IP:3950/api/report
```

## 7. Point your frontend at Oracle

On **Railway** (or wherever `drip-frontend` runs), set:

```
RADAR_API_URL=http://YOUR_ORACLE_PUBLIC_IP:3950
```

Redeploy the frontend. The Next.js API routes proxy `/api/radar/*` to that URL.

## Useful commands

```bash
sudo systemctl restart betttr-radar   # after .env changes
sudo journalctl -u betttr-radar -f   # live logs
cd /opt/betttr-radar && sudo git pull && sudo -u radar npm install && sudo systemctl restart betttr-radar
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `ETIMEDOUT` on Geyser | Wrong IP whitelisted in ERPC — re-check `curl api.ipify.org` |
| Can't reach `:3950` from browser | Oracle Security List ingress + `sudo ufw status` |
| `PERMISSION_DENIED` on Geyser | Bad ERPC api-key — check `SOLANA_RPC_URL` |
| ARM build errors | Use Ubuntu + Node 22; yellowstone-grpc supports ARM64 |
