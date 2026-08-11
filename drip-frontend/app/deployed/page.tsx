"use client";

import { useCallback, useEffect, useState } from "react";
import { TokenImage } from "@/components/ui/TokenImage";
import { useBetttrAuth } from "@/components/narra/AccountModal";
import { formatCompact } from "@/lib/narra/format";

type DeployRow = {
  id: string;
  mint: string;
  name: string;
  symbol: string;
  image?: string | null;
  signature: string;
  buySol: number;
  mayhem: boolean;
  createdAt: string;
  marketCapUsd?: number | null;
  volumeUsd1h?: number | null;
  volumeUsd24h?: number | null;
  txns24h?: number | null;
  holderCount?: number | null;
  bondingProgressPct?: number | null;
  bonded?: boolean | null;
};

async function api<T>(
  path: string,
  opts?: { method?: string; body?: unknown; token?: string | null },
): Promise<T> {
  const res = await fetch(`/api/radar${path}`, {
    method: opts?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts?.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

export default function DeployedPage() {
  const auth = useBetttrAuth();
  const [deploys, setDeploys] = useState<DeployRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyMint, setBusyMint] = useState<string | null>(null);
  const [buyAmt, setBuyAmt] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!auth.token) {
      setDeploys([]);
      return;
    }
    try {
      const data = await api<{ deploys: DeployRow[] }>("/wallet/deploys", { token: auth.token });
      setDeploys(data.deploys);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [auth.token]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  const buy = async (mint: string) => {
    if (!auth.token) return;
    const sol = Number(buyAmt[mint] ?? "0.05");
    setBusyMint(mint);
    setStatus(null);
    try {
      const res = await api<{ signature: string }>("/wallet/buy", {
        method: "POST",
        token: auth.token,
        body: { mint, buySol: sol },
      });
      setStatus(`Buy sent · ${res.signature.slice(0, 12)}…`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyMint(null);
    }
  };

  const sell = async (mint: string, percent: number) => {
    if (!auth.token) return;
    setBusyMint(mint);
    setStatus(null);
    try {
      const res = await api<{ signature: string }>("/wallet/sell", {
        method: "POST",
        token: auth.token,
        body: { mint, percent },
      });
      setStatus(`Sell ${percent}% sent · ${res.signature.slice(0, 12)}…`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyMint(null);
    }
  };

  return (
    <div className="deployed-page">
      <div className="deployed-shell">
        <div className="deployed-nav">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/Betttr.png" alt="" width={36} height={36} />
          <strong className="rainbow-text">Deployed tokens</strong>
          <a href="/">← Meta Radar</a>
          <span style={{ marginLeft: "auto", color: "#8e8e9a", fontSize: 13 }}>
            {auth.user ? `@${auth.user.username}` : "Sign in on Meta Radar"}
          </span>
        </div>

        {error && <p className="auth-modal__error">{error}</p>}
        {status && <p className="auth-modal__status">{status}</p>}

        {!auth.token ? (
          <p className="empty">Sign in from Meta Radar to see your deployments.</p>
        ) : !deploys.length ? (
          <p className="empty">No deployed tokens yet — hit DEPLOY on a Building / Hot meta.</p>
        ) : (
          <div className="deployed-list">
            {deploys.map((d) => (
              <article key={d.id} className="deployed-card">
                <TokenImage src={d.image ?? undefined} size={48} priority />
                <div>
                  <div className="deployed-card__title">
                    {d.symbol} <span style={{ color: "#8e8e9a", fontWeight: 500 }}>{d.name}</span>
                    {d.mayhem ? " · MAYHEM" : ""}
                  </div>
                  <div className="deployed-card__sub">{d.mint}</div>
                  <div className="deployed-card__stats">
                    <span>MC ${formatCompact(d.marketCapUsd ?? 0)}</span>
                    <span>Vol1h ${formatCompact(d.volumeUsd1h ?? 0)}</span>
                    <span>Vol24h ${formatCompact(d.volumeUsd24h ?? 0)}</span>
                    <span>{d.txns24h ?? "—"} tx</span>
                    <span>{d.holderCount ?? "—"} holders</span>
                    <span>
                      {d.bonded
                        ? "Graduated"
                        : d.bondingProgressPct != null
                          ? `${d.bondingProgressPct}% bond`
                          : "—"}
                    </span>
                    <span>Dev buy {d.buySol} SOL</span>
                  </div>
                </div>
                <div className="deployed-card__actions">
                  <input
                    value={buyAmt[d.mint] ?? "0.05"}
                    onChange={(e) => setBuyAmt((prev) => ({ ...prev, [d.mint]: e.target.value }))}
                    style={{
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(0,0,0,0.35)",
                      color: "#fff",
                      padding: "7px 8px",
                      fontSize: 12,
                    }}
                    placeholder="SOL"
                  />
                  <button
                    type="button"
                    className="deployed-buy"
                    disabled={busyMint === d.mint}
                    onClick={() => void buy(d.mint)}
                  >
                    Buy
                  </button>
                  <button
                    type="button"
                    className="deployed-sell"
                    disabled={busyMint === d.mint}
                    onClick={() => void sell(d.mint, 50)}
                  >
                    Sell 50%
                  </button>
                  <button
                    type="button"
                    className="deployed-sell"
                    disabled={busyMint === d.mint}
                    onClick={() => void sell(d.mint, 100)}
                  >
                    Sell 100%
                  </button>
                  <a
                    href={`https://pump.fun/coin/${d.mint}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 11, color: "#a8a8b3", textAlign: "center" }}
                  >
                    pump.fun ↗
                  </a>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
