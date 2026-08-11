#!/usr/bin/env bash
# Betttr radar — Oracle Cloud Free Tier one-shot setup (Ubuntu 22.04/24.04 ARM or x86)
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/betttr-radar}"
REPO_URL="${REPO_URL:-https://github.com/openswarm-dev/dripfeed.git}"
RADAR_PORT="${RADAR_PORT:-3950}"
SERVICE_USER="${SERVICE_USER:-radar}"

echo "==> Betttr radar Oracle setup"
echo "    Install dir: $INSTALL_DIR"
echo "    Port: $RADAR_PORT"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/oracle-setup.sh"
  exit 1
fi

echo "==> System packages"
apt-get update -qq
apt-get install -y -qq git curl ca-certificates ufw

echo "==> Node.js 22"
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
node -v
npm -v

echo "==> Service user"
if ! id "$SERVICE_USER" &>/dev/null; then
  useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

echo "==> Clone / update repo"
mkdir -p "$(dirname "$INSTALL_DIR")"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  git -C "$INSTALL_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$INSTALL_DIR/repo"
  mkdir -p "$INSTALL_DIR"
  cp -a "$INSTALL_DIR/repo/betttr-radar/." "$INSTALL_DIR/"
  rm -rf "$INSTALL_DIR/repo"
fi

echo "==> npm install"
cd "$INSTALL_DIR"
sudo -u "$SERVICE_USER" npm install --include=dev

echo "==> .env"
if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
  chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/.env"
  chmod 600 "$INSTALL_DIR/.env"
  echo ""
  echo "!!! Edit $INSTALL_DIR/.env with your API keys, then:"
  echo "    sudo systemctl restart betttr-radar"
  echo ""
fi

echo "==> systemd"
cat > /etc/systemd/system/betttr-radar.service <<EOF
[Unit]
Description=Betttr.xyz Meta Radar (Geyser + TweetStream)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
Environment=NODE_ENV=production
Environment=PORT=$RADAR_PORT
Environment=BETTTR_RADAR_PORT=$RADAR_PORT
Environment=NARRA_PORT=$RADAR_PORT
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$(command -v npm) start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable betttr-radar

echo "==> Firewall (ufw)"
ufw allow OpenSSH
ufw allow "${RADAR_PORT}/tcp"
ufw --force enable || true

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

PUBLIC_IP=$(curl -fsSL https://api.ipify.org || curl -fsSL https://ifconfig.me/ip || echo "unknown")

echo ""
echo "=========================================="
echo "  Setup complete"
echo "=========================================="
echo ""
echo "  1. Edit secrets:"
echo "       sudo nano $INSTALL_DIR/.env"
echo ""
echo "  2. Whitelist this IP in ERPC Geyser:"
echo "       $PUBLIC_IP"
echo ""
echo "  3. Oracle Console → VCN → Security List → Ingress:"
echo "       TCP $RADAR_PORT from 0.0.0.0/0 (or your frontend IP only)"
echo ""
echo "  4. Start service:"
echo "       sudo systemctl start betttr-radar"
echo "       sudo systemctl status betttr-radar"
echo "       sudo journalctl -u betttr-radar -f"
echo ""
echo "  5. Health check:"
echo "       curl http://127.0.0.1:$RADAR_PORT/health"
echo "       curl http://$PUBLIC_IP:$RADAR_PORT/health"
echo ""
echo "  6. Point frontend RADAR_API_URL to:"
echo "       http://$PUBLIC_IP:$RADAR_PORT"
echo ""
echo "  Set ALLOWED_ORIGINS in .env to your frontend URL if needed."
echo "=========================================="
