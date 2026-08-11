"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import NarraDashboard from "@/components/narra/NarraDashboard";
import Cursor from "@/components/Cursor";
import { useNarra } from "@/lib/narra/useNarra";

const T = { bg: "#111114" } as const;
const LOGO_SRC = "/logos/Betttr.png";
const ease = [0.22, 1, 0.36, 1] as const;

function CinematicIntro({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<"wait" | "in" | "pulse" | "grow" | "out">("wait");
  const [logoReady, setLogoReady] = useState(false);

  useEffect(() => {
    const img = new window.Image();
    img.src = LOGO_SRC;
    const markReady = () => setLogoReady(true);
    img.onload = markReady;
    img.onerror = markReady;
    if (img.complete) markReady();
  }, []);

  useEffect(() => {
    if (!logoReady) return;
    setPhase("in");
    const t1 = setTimeout(() => setPhase("pulse"), 500);
    const t2 = setTimeout(() => setPhase("grow"), 1400);
    const t3 = setTimeout(() => setPhase("out"), 2000);
    const t4 = setTimeout(onComplete, 2800);
    return () => [t1, t2, t3, t4].forEach(clearTimeout);
  }, [logoReady, onComplete]);

  const logoVariants: Record<string, { opacity: number | number[]; scale: number | number[]; filter: string }> = {
    wait:  { opacity: 0, scale: 0.7, filter: "blur(8px)" },
    in:    { opacity: 1, scale: 1, filter: "blur(0px)" },
    pulse: { opacity: 1, scale: [1, 1.07, 0.96, 1.12, 1], filter: "blur(0px)" },
    grow:  { opacity: 1, scale: 5, filter: "blur(8px)" },
    out:   { opacity: 0, scale: 7, filter: "blur(20px)" },
  };

  const dur = phase === "wait" ? 0 : phase === "in" ? 0.55 : phase === "pulse" ? 0.9 : phase === "grow" ? 0.65 : 0.75;

  return (
    <motion.div
      animate={{ opacity: phase === "out" ? 0 : 1 }}
      transition={{ duration: phase === "out" ? 0.75 : 0.01 }}
      style={{
        position: "fixed", inset: 0, zIndex: 10000, background: T.bg,
        display: "flex", alignItems: "center", justifyContent: "center",
        pointerEvents: "none", overflow: "hidden",
      }}
    >
      <motion.div
        initial={false}
        animate={logoVariants[phase]}
        transition={{ duration: dur, ease }}
        style={{ position: "relative", zIndex: 1 }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_SRC} alt="Betttr.xyz" className="intro-logo" />
      </motion.div>
    </motion.div>
  );
}

export default function Page() {
  const { state, loading, error, loaderDone } = useNarra();
  const [introDone, setIntroDone] = useState(false);

  return (
    <div style={{ background: T.bg, minHeight: "100vh", color: "#F4F4F8" }}>
      <Cursor />
      <AnimatePresence>
        {!introDone && (
          <CinematicIntro key="intro" onComplete={() => setIntroDone(true)} />
        )}
      </AnimatePresence>

      {introDone && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, ease }}
          style={{ height: "100vh", overflow: "hidden" }}
        >
          <NarraDashboard
            state={state}
            loading={loading}
            error={error}
            loaderDone={loaderDone || !!error}
            onLoaderDone={() => {}}
          />
        </motion.div>
      )}
    </div>
  );
}
