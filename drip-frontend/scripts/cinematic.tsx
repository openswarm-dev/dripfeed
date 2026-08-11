// ─── Cinematic intro ─────────────────────────────────────────────────────────
function CinematicIntro({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<"in"|"pulse"|"grow"|"out">("in");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("pulse"),  500);
    const t2 = setTimeout(() => setPhase("grow"),  1400);
    const t3 = setTimeout(() => setPhase("out"),   2000);
    const t4 = setTimeout(onComplete,              2800);
    return () => [t1, t2, t3, t4].forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logoVariants: Record<string, { opacity: number | number[]; scale: number | number[]; filter: string }> = {
    in:    { opacity:1, scale:1,                        filter:"blur(0px)" },
    pulse: { opacity:1, scale:[1, 1.07, 0.96, 1.12, 1], filter:"blur(0px)" },
    grow:  { opacity:1, scale:5,                        filter:"blur(8px)" },
    out:   { opacity:0, scale:7,                        filter:"blur(20px)" },
  };

  const dur = phase==="in" ? 0.55 : phase==="pulse" ? 0.9 : phase==="grow" ? 0.65 : 0.75;
  const logoEase =
    phase==="pulse" ? "easeInOut" :
    phase==="grow"  ? [0.2,0,0.8,1] as [number,number,number,number] :
                      [0.16,1,0.3,1] as [number,number,number,number];

  return (
    <motion.div
      animate={{ opacity: phase === "out" ? 0 : 1 }}
      transition={{ duration: phase === "out" ? 0.75 : 0.01 }}
      style={{ position:"fixed", inset:0, zIndex:9999, background:T.bg,
        display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none" }}>

      {/* Ambient glow */}
      <motion.div
        animate={{ opacity: phase==="pulse" || phase==="grow" ? 1 : 0, scale: phase==="grow" ? 3 : 1 }}
        transition={{ duration: 0.8 }}
        style={{ position:"absolute", width:400, height:400, borderRadius:"50%",
          background:"radial-gradient(circle, rgba(200,180,255,0.15) 0%, rgba(180,210,255,0.08) 40%, transparent 70%)",
          pointerEvents:"none" }}/>

      {/* Logo */}
      <motion.div
        initial={{ opacity:0, scale:0.7, filter:"blur(8px)" }}
        animate={logoVariants[phase]}
        transition={{ duration: dur, ease: logoEase }}>
        <Image src="/logos/Betttr.png" alt="Betttr.xyz" width={160} height={120}
          style={{ objectFit:"contain", display:"block" }}/>
      </motion.div>
    </motion.div>
  );
}

