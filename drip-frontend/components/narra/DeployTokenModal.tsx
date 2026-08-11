"use client";

import { useEffect, useMemo, useState } from "react";
import type { MetaTrack, MetaToken } from "@/lib/narra/types";
import { displayTheme } from "@/lib/narra/displayTheme";
import { TokenImage } from "@/components/ui/TokenImage";
import type { useBetttrAuth } from "@/components/narra/AccountModal";

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

function tickerFromTheme(theme: string) {
  const clean = theme.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return (clean.slice(0, 10) || "MEME").slice(0, 10);
}

function nameFromTheme(theme: string) {
  return displayTheme(theme).slice(0, 32);
}

export function DeployTokenModal({
  open,
  onClose,
  meta,
  auth,
}: {
  open: boolean;
  onClose: () => void;
  meta: MetaTrack | null;
  auth: ReturnType<typeof useBetttrAuth>;
}) {
  const images = useMemo(() => {
    if (!meta) return [] as string[];
    const fromTokens = meta.tokens.map((t) => t.image).filter(Boolean) as string[];
    return Array.from(new Set([...(meta.sampleImages ?? []), ...fromTokens])).slice(0, 12);
  }, [meta]);

  const seedToken: MetaToken | null = meta?.tokens?.[0] ?? null;

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [buySol, setBuySol] = useState("0.1");
  const [mayhem, setMayhem] = useState(false);
  const [quote, setQuote] = useState<{ expectedTokensUi: number; supplyPct: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !meta) return;
    setName(nameFromTheme(meta.theme));
    setSymbol(tickerFromTheme(meta.theme));
    setDescription(`${displayTheme(meta.theme)} meta on Betttr`);
    setWebsite("");
    setTwitter(seedToken?.twitter ?? "");
    setTelegram("");
    setImageUrl(images[0] ?? null);
    setImageBase64(null);
    setBuySol("0.1");
    setMayhem(false);
    setError(null);
    setStatus(null);
  }, [open, meta?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const sol = Number(buySol);
    if (!(sol > 0)) {
      setQuote(null);
      return;
    }
    const t = setTimeout(() => {
      void api<{ expectedTokensUi: number; supplyPct: number }>(
        `/wallet/deploy/quote?sol=${encodeURIComponent(String(sol))}`,
      )
        .then(setQuote)
        .catch(() => setQuote(null));
    }, 250);
    return () => clearTimeout(t);
  }, [buySol, open]);

  if (!open || !meta) return null;

  const onUpload = async (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      setImageBase64(result);
      setImageUrl(result);
    };
    reader.readAsDataURL(file);
  };

  const deploy = async () => {
    if (!auth.token) {
      setError("Sign in to deploy from your Turnkey wallet");
      return;
    }
    if (!imageUrl && !imageBase64) {
      setError("Select or upload an image");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus("Uploading metadata…");
    try {
      setStatus("Creating token + buying on pump.fun…");
      const data = await api<{
        mint: string;
        signature: string;
        expectedTokensUi: number;
        supplyPct: number;
      }>("/wallet/deploy", {
        method: "POST",
        token: auth.token,
        body: {
          name: name.trim(),
          symbol: symbol.trim(),
          description,
          website,
          twitter,
          telegram,
          imageUrl: imageBase64 ? undefined : imageUrl,
          imageBase64: imageBase64 || undefined,
          buySol: Number(buySol),
          mayhem,
          metaId: meta.id,
          metaTheme: meta.theme,
        },
      });
      setStatus(`Deployed ${data.mint.slice(0, 8)}…`);
      window.setTimeout(() => {
        onClose();
        window.location.href = "/deployed";
      }, 900);
    } catch (err) {
      setError((err as Error).message);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="auth-modal deploy-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="auth-modal__edge rainbow-bg" aria-hidden="true" />
        <div className="auth-modal__body">
          <div className="auth-modal__brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logos/Betttr.png" alt="" className="auth-modal__logo" />
            <span className="auth-modal__brand-name rainbow-text">Deploy · Pump</span>
            <button type="button" className="auth-modal__close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>

          <h2 className="auth-modal__title rainbow-text">Launch token</h2>
          <p className="auth-modal__hint">
            Autofilled from <strong>{displayTheme(meta.theme)}</strong> · {meta.stageLabel}. Deploy
            from your Turnkey wallet with an initial buy.
          </p>

          <div className="deploy-images">
            <div className="deploy-images__head">
              <span className="auth-account-label">Image</span>
              <label className="deploy-upload">
                Upload
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
            <div className="deploy-images__grid">
              {images.map((src) => (
                <button
                  key={src}
                  type="button"
                  className={`deploy-image ${imageUrl === src && !imageBase64 ? "selected" : ""}`}
                  onClick={() => {
                    setImageBase64(null);
                    setImageUrl(src);
                  }}
                >
                  <TokenImage src={src} size={56} priority />
                </button>
              ))}
              {imageBase64 && (
                <button type="button" className="deploy-image selected" onClick={() => undefined}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageBase64} alt="" width={56} height={56} />
                </button>
              )}
            </div>
          </div>

          <label className="auth-field">
            <span>Name · {name.length}/32</span>
            <input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} disabled={busy} />
          </label>
          <label className="auth-field">
            <span>Ticker · {symbol.length}/10</span>
            <input
              value={symbol}
              maxLength={10}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              disabled={busy}
            />
          </label>
          <label className="auth-field">
            <span>Description</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} />
          </label>

          <div className="deploy-socials">
            <label className="auth-field">
              <span>Website</span>
              <input value={website} onChange={(e) => setWebsite(e.target.value)} disabled={busy} placeholder="https://" />
            </label>
            <label className="auth-field">
              <span>Twitter</span>
              <input value={twitter} onChange={(e) => setTwitter(e.target.value)} disabled={busy} placeholder="https://x.com/…" />
            </label>
            <label className="auth-field">
              <span>Telegram</span>
              <input value={telegram} onChange={(e) => setTelegram(e.target.value)} disabled={busy} placeholder="https://t.me/…" />
            </label>
          </div>

          <div className="deploy-toggles">
            <button
              type="button"
              className={`deploy-toggle ${mayhem ? "on" : ""}`}
              onClick={() => setMayhem((v) => !v)}
              disabled={busy}
            >
              Mayhem {mayhem ? "ON" : "OFF"}
            </button>
            <span className="deploy-platform">Platform · Pump</span>
          </div>

          <label className="auth-field">
            <span>Dev buy (SOL)</span>
            <input
              value={buySol}
              onChange={(e) => setBuySol(e.target.value)}
              disabled={busy}
              inputMode="decimal"
            />
          </label>
          {quote && (
            <p className="auth-modal__status">
              ≈ {quote.expectedTokensUi.toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens ·{" "}
              {quote.supplyPct.toFixed(3)}% supply
            </p>
          )}

          {error && <p className="auth-modal__error">{error}</p>}
          {status && !error && <p className="auth-modal__status">{status}</p>}

          <button type="button" className="auth-modal__cta" disabled={busy || !auth.token} onClick={() => void deploy()}>
            <span className="auth-modal__cta-glow rainbow-bg" aria-hidden="true" />
            <span className="auth-modal__cta-label">{busy ? "Deploying…" : "DEPLOY"}</span>
          </button>
          {!auth.token && (
            <p className="auth-modal__hint" style={{ marginTop: 10 }}>
              Create an account first to deploy from your Turnkey wallet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
