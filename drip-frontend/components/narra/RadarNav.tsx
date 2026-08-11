"use client";

import Link from "next/link";
import { AccountModal, useBetttrAuth } from "@/components/narra/AccountModal";
import { capitalize } from "@/lib/narra/format";
import type { NarraState } from "@/lib/narra/types";
import { useState } from "react";

const LOGO_SRC = "/logos/Betttr.png";
export const BOOT_DONE_KEY = "betttr_boot_done";

export function markBootDone() {
  try {
    sessionStorage.setItem(BOOT_DONE_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function isBootDone(): boolean {
  try {
    return sessionStorage.getItem(BOOT_DONE_KEY) === "1";
  } catch {
    return false;
  }
}

export function RadarNav({
  active,
  state,
}: {
  active: "radar" | "deployed";
  state?: NarraState | null;
}) {
  const auth = useBetttrAuth();
  const [accountOpen, setAccountOpen] = useState(false);
  const metas = state?.metas ?? null;
  const launches = state?.launches ?? [];
  const geyserStats = state?.geyserStats;
  const live = state?.live;
  const feeds = live?.feeds;

  return (
    <>
      <nav className="radar-nav">
        <div className="radar-nav__inner">
          <Link href="/" className="radar-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO_SRC} alt="Betttr.xyz" className="radar-brand__logo" />
            <span className="radar-brand__title rainbow-text">Meta Radar</span>
          </Link>
          <div className="radar-status">
            {active === "radar" ? (
              <Link href="/deployed" className="radar-pill radar-pill--link">
                Deployed
              </Link>
            ) : (
              <Link href="/" className="radar-pill radar-pill--link radar-pill--active">
                Meta Feed
              </Link>
            )}
            <div
              className={`radar-pill ${
                feeds?.geyser ? "radar-pill--live" : live?.connected ? "radar-pill--pending" : ""
              }`}
            >
              <span className="radar-pill__dot" />
              <span>
                {feeds?.geyser
                  ? `Geyser · ${geyserStats?.perMinute ?? 0}/min`
                  : live?.connected
                    ? "Geyser reconnecting…"
                    : state?.geyserEnabled === false
                      ? "Geyser disabled"
                      : "Geyser connecting…"}
              </span>
            </div>
            <div className="radar-pill radar-pill--stats">
              {metas
                ? `${launches.length} creates · ${metas.activeMetaCount} active · ${metas.formingCount} forming · ${capitalize(metas.dominantStage)}`
                : "—"}
            </div>
            {auth.user ? (
              <button
                type="button"
                className="radar-account"
                onClick={() => setAccountOpen(true)}
                title={auth.wallet?.address}
              >
                @{auth.user.username}
              </button>
            ) : (
              <button
                type="button"
                className="radar-account radar-account--cta"
                onClick={() => setAccountOpen(true)}
              >
                Create account
              </button>
            )}
          </div>
        </div>
      </nav>
      <AccountModal open={accountOpen} onClose={() => setAccountOpen(false)} auth={auth} />
    </>
  );
}
