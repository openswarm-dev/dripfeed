"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { MetaTrack, LaunchRecord } from "@/lib/narra/types";
import { BetttrCard } from "@/components/ui/BetttrCard";
import { TokenImage } from "@/components/ui/TokenImage";
import { PumpFunButton } from "@/components/ui/PumpFunButton";
import { LiveAge } from "@/components/narra/LiveAge";
import { formatCompact } from "@/lib/narra/format";
import { displayTheme } from "@/lib/narra/displayTheme";

type HoverTarget =
  | { kind: "meta"; m: MetaTrack; rect: DOMRect }
  | { kind: "launch"; l: LaunchRecord; rect: DOMRect };

function money(n?: number | null) {
  if (n == null || n <= 0) return "—";
  return `$${formatCompact(n)}`;
}

export function HoverOverlay({
  target,
  onMouseEnter,
  onMouseLeave,
  children,
}: {
  target: HoverTarget | null;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  children: ReactNode;
}) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!target) return;
    const pad = 12;
    const pw = 340;
    const ph = 420;
    let x = target.rect.right + pad;
    let y = target.rect.top;
    if (x + pw > window.innerWidth - pad) {
      x = target.rect.left - pw - pad;
    }
    if (y + ph > window.innerHeight - pad) {
      y = window.innerHeight - ph - pad;
    }
    y = Math.max(pad, y);
    x = Math.max(pad, x);
    setPos({ x, y });
  }, [target]);

  const overlay = target && mounted ? (
    <div
      className="radar-hover-layer"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div
        className="radar-hover-overlay"
        style={{ left: pos.x, top: pos.y }}
      >
        <BetttrCard accent={target.kind === "meta" ? "detail" : "launch"}>
          {target.kind === "meta" ? (
            <MetaOverlayContent m={target.m} />
          ) : (
            <LaunchOverlayContent l={target.l} />
          )}
        </BetttrCard>
      </div>
    </div>
  ) : null;

  return (
    <>
      {children}
      {overlay && createPortal(overlay, document.body)}
    </>
  );
}

function MetaOverlayContent({ m }: { m: MetaTrack }) {
  return (
    <div className="hover-overlay-inner">
      <div className="hover-overlay-head">
        <TokenImage src={m.sampleImages[0]} size={40} priority />
        <div>
          <div className="hover-overlay-title rainbow-text">{displayTheme(m.theme)}</div>
          <div className="hover-overlay-sub">{m.stageLabel} · {m.launchCount} coins</div>
        </div>
      </div>
      <div className="hover-overlay-grid">
        <div><span className="lbl">Vol 1h</span><span className="val">{money(m.totalVolumeUsd1h)}</span></div>
        <div><span className="lbl">Tx 24h</span><span className="val">{m.totalTxns24h || "—"}</span></div>
        <div><span className="lbl">Top mcap</span><span className="val">{money(m.topMarketCapUsd)}</span></div>
        <div><span className="lbl">Deployers</span><span className="val">{m.uniqueCreators}</span></div>
      </div>
      <p className="hover-overlay-psych">{m.psychologyLabel}</p>
      <div className="hover-overlay-tokens">
        {m.tokens.slice(0, 6).map((t) => (
          <div key={t.mint} className="hover-token-chip">
            <TokenImage src={t.image} size={28} priority />
            <span>{t.symbol ?? t.name ?? t.mint.slice(0, 4)}</span>
            <PumpFunButton mint={t.mint} size={22} />
          </div>
        ))}
      </div>
      <div className="hover-overlay-foot">
        <span className="age-tag">First <LiveAge ts={m.firstSeen} /> ago · Newest <LiveAge ts={m.lastSeen} /></span>
      </div>
    </div>
  );
}

function LaunchOverlayContent({ l }: { l: LaunchRecord }) {
  return (
    <div className="hover-overlay-inner">
      <div className="hover-overlay-head">
        <TokenImage src={l.image} size={40} priority />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="hover-overlay-title">{l.symbol ?? l.name ?? "New token"}</div>
          <div className="hover-overlay-sub">{l.primaryNarrative}</div>
        </div>
        <PumpFunButton mint={l.mint} size={28} />
      </div>
      <div className="hover-overlay-grid">
        <div><span className="lbl">Mcap</span><span className="val">{money(l.marketCapUsd)}</span></div>
        <div><span className="lbl">Vol 1h</span><span className="val">{money(l.volumeUsd1h)}</span></div>
        <div><span className="lbl">Tx 24h</span><span className="val">{l.txns24h ?? "—"}</span></div>
        <div>
          <span className="lbl">Bonded</span>
          <span className="val">
            {l.bonded ? "Yes" : l.bondingProgressPct != null ? `${l.bondingProgressPct}%` : "—"}
          </span>
        </div>
        <div><span className="lbl">Holders</span><span className="val">{l.holderCount ?? "—"}</span></div>
        <div><span className="lbl">Vol 24h</span><span className="val">{money(l.volumeUsd24h)}</span></div>
      </div>
      {l.blockTime && (
        <div className="hover-overlay-foot">
          <span className="age-tag">Launched <LiveAge ts={l.blockTime} /> ago</span>
        </div>
      )}
    </div>
  );
}
