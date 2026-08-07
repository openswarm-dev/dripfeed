"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";

const ease = [0.22, 1, 0.36, 1] as const;

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function WalletSelectModal({ open, onClose }: Props) {
  const { wallets, select, connecting } = useWallet();

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Separate detected vs installable
  const detected = wallets.filter(
    w => w.readyState === WalletReadyState.Installed ||
         w.readyState === WalletReadyState.Loadable,
  );
  const installable = wallets.filter(
    w => w.readyState === WalletReadyState.NotDetected,
  );

  function handleSelect(name: string) {
    select(name as Parameters<typeof select>[0]);
    // autoConnect on the provider picks up the selection automatically —
    // calling connect() immediately here throws WalletNotSelectedError
    // because the state update hasn't committed yet.
    onClose();
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            style={{
              position: "fixed", inset: 0, zIndex: 9000,
              background: "rgba(0,0,0,0.72)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
            }}
          />

          {/* Panel */}
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 16 }}
            transition={{ duration: 0.35, ease }}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 9001,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                pointerEvents: "auto",
                width: "100%",
                maxWidth: 420,
                margin: "0 20px",
                borderRadius: 24,
                overflow: "hidden",
                /* holographic glass */
                background: "linear-gradient(145deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)",
                backdropFilter: "blur(32px) saturate(180%)",
                WebkitBackdropFilter: "blur(32px) saturate(180%)",
                border: "1px solid rgba(255,255,255,0.12)",
                boxShadow: "0 40px 100px -20px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.14)",
                position: "relative",
              }}
            >
              {/* Iridescent top bar */}
              <div style={{
                height: 2,
                background: "linear-gradient(90deg, #fff, #e8d8ff, #c8d8ff, #c8f0ff, #e0d8ff, #fff)",
                backgroundSize: "300% 100%",
                animation: "holo-flow 5s linear infinite",
              }}/>

              {/* Corner sheen */}
              <div style={{
                position: "absolute", inset: 0, borderRadius: 24,
                background: "linear-gradient(135deg, rgba(255,255,255,0.07) 0%, transparent 40%)",
                pointerEvents: "none",
              }}/>

              <div style={{ padding: "28px 28px 24px" }}>
                {/* Header */}
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
                  <div>
                    <p style={{ fontSize: 18, fontWeight: 700, color: "#F4F4F8", letterSpacing: "-0.02em", margin: 0 }}>
                      Connect a wallet
                    </p>
                    <p style={{ fontSize: 12, color: "#8888A0", marginTop: 4 }}>
                      on Solana to continue
                    </p>
                  </div>
                  <button
                    onClick={onClose}
                    data-cursor-hover
                    style={{
                      width: 32, height: 32, borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)",
                      background: "rgba(255,255,255,0.06)", color: "#8888A0",
                      fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0, transition: "background 0.2s, color 0.2s",
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.12)";
                      (e.currentTarget as HTMLButtonElement).style.color = "#F4F4F8";
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)";
                      (e.currentTarget as HTMLButtonElement).style.color = "#8888A0";
                    }}
                  >
                    ✕
                  </button>
                </div>

                {/* Detected wallets */}
                {detected.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {detected.map(wallet => (
                      <WalletRow
                        key={wallet.adapter.name}
                        name={wallet.adapter.name}
                        icon={wallet.adapter.icon}
                        badge="Detected"
                        badgeColor="rgba(120,255,160,0.18)"
                        badgeText="#6fffa0"
                        loading={connecting}
                        onClick={() => handleSelect(wallet.adapter.name)}
                      />
                    ))}
                  </div>
                )}

                {/* Installable wallets */}
                {installable.length > 0 && (
                  <>
                    {detected.length > 0 && (
                      <div style={{ height: 1, background: "rgba(255,255,255,0.07)", margin: "16px 0" }}/>
                    )}
                    <p style={{ fontSize: 10, fontFamily: "var(--font-geist-mono)", letterSpacing: "0.14em", textTransform: "uppercase", color: "#44445A", marginBottom: 8 }}>
                      Not installed
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {installable.map(wallet => (
                        <WalletRow
                          key={wallet.adapter.name}
                          name={wallet.adapter.name}
                          icon={wallet.adapter.icon}
                          badge="Install"
                          badgeColor="rgba(255,255,255,0.06)"
                          badgeText="#8888A0"
                          loading={false}
                          onClick={() => window.open(wallet.adapter.url, "_blank")}
                        />
                      ))}
                    </div>
                  </>
                )}

                {/* Empty state */}
                {wallets.length === 0 && (
                  <div style={{ textAlign: "center", padding: "32px 0", color: "#8888A0", fontSize: 13 }}>
                    No wallets found.<br/>Install Phantom or Backpack to continue.
                  </div>
                )}

                {/* Footer */}
                <p style={{ fontSize: 11, color: "#44445A", textAlign: "center", marginTop: 24, fontFamily: "var(--font-geist-mono)" }}>
                  Your keys. Your vault. Non-custodial.
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Individual wallet row ─────────────────────────────────────────────────────
function WalletRow({
  name, icon, badge, badgeColor, badgeText, loading, onClick,
}: {
  name: string;
  icon: string;
  badge: string;
  badgeColor: string;
  badgeText: string;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      onClick={onClick}
      disabled={loading}
      whileHover={{ scale: 1.015 }}
      whileTap={{ scale: 0.985 }}
      data-cursor-hover
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "13px 16px",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.04)",
        cursor: loading ? "wait" : "pointer",
        textAlign: "left",
        transition: "border-color 0.2s, background 0.2s",
        fontFamily: "inherit",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.18)";
        (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.07)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.08)";
        (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)";
      }}
    >
      {/* Wallet icon */}
      {icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={icon} alt={name} width={36} height={36} style={{ borderRadius: 10, flexShrink: 0 }}/>
      ) : (
        <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,0.08)", flexShrink: 0 }}/>
      )}

      {/* Name */}
      <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: "#F4F4F8" }}>{name}</span>

      {/* Badge */}
      <span style={{
        fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20,
        background: badgeColor, color: badgeText,
        fontFamily: "var(--font-geist-mono)",
      }}>
        {badge}
      </span>
    </motion.button>
  );
}
