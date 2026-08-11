function CreateCampaignModal({ authToken, onClose, onSuccess }: {
  authToken: string;
  onClose: () => void;
  onSuccess: (c: Campaign) => void;
}) {
  const [step,     setStep]     = useState(1);
  const [project,  setProject]  = useState("");
  const [ticker,   setTicker]   = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imgErr,   setImgErr]   = useState(false);
  const [budget,   setBudget]   = useState(10000);
  const [goal,     setGoal]     = useState(5000000);
  const [dripPerK, setDripPerK] = useState(0.01);
  const [saving,   setSaving]   = useState(false);
  const [errMsg,   setErrMsg]   = useState("");

  const step1Valid = project.trim().length > 0;
  const step2Valid = ticker.trim().length > 0 && budget > 0;
  const step3Valid = goal > 0 && dripPerK > 0;
  const canLaunch  = step1Valid && step2Valid && step3Valid && !saving;
  const kPerDrip   = dripPerK > 0 ? Math.round(1 / dripPerK) : 0;
  const STEPS = 3;

  async function save() {
    if (!canLaunch) return;
    setSaving(true); setErrMsg("");
    try {
      const res = await api.createCampaign({
        project: project.trim(),
        logo: ticker.trim(),
        imageUrl: imageUrl.trim() || undefined,
        budgetTotal: budget,
        goal,
        dripPerKViews: dripPerK,
      }, authToken);
      const c = res.campaign;
      onSuccess({
        id: c.id, project: c.project, av: c.logo,
        imageUrl: imageUrl.trim() || undefined,
        budgetTotal: +c.budgetTotal, budgetLeft: +c.budgetLeft,
        goal: +c.goal, verified: +c.verified,
        rateLabel: c.rateLabel, dripHr: +c.dripPerKViews * 100,
        participants: c.participants,
      } as unknown as Campaign);
    } catch (err) {
      setErrMsg((err as Error).message);
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width:"100%", height:48, background:T.el,
    border:`1px solid ${T.border}`, borderRadius:11,
    padding:"0 16px", fontSize:15, color:T.fg,
    outline:"none", fontFamily:"inherit", transition:"border-color 0.2s",
  };

  const stepLabel = ["Identity", "Budget", "Distribution"][step - 1];
  const progPct = ((step - 1) / (STEPS - 1)) * 100;
  const canNext = step === 1 ? step1Valid : step2Valid;

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center"
      initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      style={{ background:"rgba(10,11,14,0.92)", backdropFilter:"blur(28px)", padding:"16px" }}
      onClick={e => e.target === e.currentTarget && !saving && onClose()}>
      <motion.div
        initial={{ opacity:0, scale:0.96, y:20 }}
        animate={{ opacity:1, scale:1, y:0 }}
        exit={{ opacity:0, scale:0.96, y:20 }}
        transition={{ duration:0.3, ease }}
        style={{ width:"100%", maxWidth:480, background:T.surface, border:`1px solid ${T.border}`, borderRadius:24, overflow:"hidden", boxShadow:"0 60px 120px -24px rgba(0,0,0,0.9)" }}>

        {/* Animated progress bar */}
        <div style={{ height:3, background:T.el, position:"relative" }}>
          <motion.div className="rainbow-bg"
            animate={{ width:`${Math.max(4, progPct)}%` }}
            transition={{ duration:0.4, ease }}
            style={{ position:"absolute", inset:"0 auto 0 0", height:"100%" }}/>
        </div>

        {/* Header */}
        <div style={{ padding:"22px 28px 18px", borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div>
            <p style={{ fontSize:11, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.16em", color:T.faint, marginBottom:5 }}>
              Step {step} of {STEPS}
            </p>
            <p style={{ fontSize:22, fontWeight:700, color:T.fg, letterSpacing:"-0.02em", lineHeight:1.1, margin:0 }}>
              {stepLabel}
            </p>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            {[1,2,3].map(s => (
              <div key={s} style={{ width:s===step?22:7, height:7, borderRadius:4, transition:"all 0.3s ease",
                background:s<step?"rgba(255,255,255,0.5)":s===step?"rgba(255,255,255,0.9)":T.border }}/>
            ))}
            <button onClick={onClose} data-cursor-hover style={{ marginLeft:6, background:"none", border:"none", color:T.faint, cursor:"pointer", padding:6, display:"flex", alignItems:"center" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Step content */}
        <div style={{ padding:"28px 28px 20px", minHeight:300 }}>
          <AnimatePresence mode="wait">

            {step === 1 && (
              <motion.div key="s1"
                initial={{ opacity:0, x:30 }} animate={{ opacity:1, x:0 }}
                exit={{ opacity:0, x:-30 }} transition={{ duration:0.2 }}>

                <div style={{ marginBottom:26 }}>
                  <p style={{ fontSize:12, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.13em", color:T.subtle, fontWeight:600, marginBottom:5 }}>Campaign Image</p>
                  <p style={{ fontSize:13, color:T.faint, marginBottom:12, lineHeight:1.5 }}>Optional — paste a direct image URL shown on your campaign card.</p>
                  <div style={{ display:"flex", gap:14, alignItems:"center" }}>
                    <div style={{ width:70, height:70, borderRadius:16, background:T.el, border:`1px solid ${T.border}`, flexShrink:0, overflow:"hidden", display:"flex", alignItems:"center", justifyContent:"center" }}>
                      {imageUrl && !imgErr
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={imageUrl} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} onError={() => setImgErr(true)} onLoad={() => setImgErr(false)}/>
                        : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color:T.faint, opacity:0.4 }}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                      }
                    </div>
                    <input value={imageUrl} onChange={e => { setImageUrl(e.target.value); setImgErr(false); }}
                      placeholder="https://cdn.example.com/logo.png"
                      style={{ ...inputStyle, flex:1 }}
                      onFocus={e => (e.currentTarget.style.borderColor="rgba(255,255,255,0.3)")}
                      onBlur={e => (e.currentTarget.style.borderColor=T.border)}/>
                  </div>
                </div>

                <div>
                  <p style={{ fontSize:12, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.13em", color:T.subtle, fontWeight:600, marginBottom:5 }}>Project Name</p>
                  <p style={{ fontSize:13, color:T.faint, marginBottom:12, lineHeight:1.5 }}>Full brand name — shown as the campaign title across the platform.</p>
                  <input value={project} onChange={e => setProject(e.target.value)}
                    placeholder="e.g. Solana Foundation"
                    autoFocus
                    style={inputStyle}
                    onFocus={e => (e.currentTarget.style.borderColor="rgba(255,255,255,0.3)")}
                    onBlur={e => (e.currentTarget.style.borderColor=T.border)}/>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div key="s2"
                initial={{ opacity:0, x:30 }} animate={{ opacity:1, x:0 }}
                exit={{ opacity:0, x:-30 }} transition={{ duration:0.2 }}>

                <div style={{ marginBottom:26 }}>
                  <p style={{ fontSize:12, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.13em", color:T.subtle, fontWeight:600, marginBottom:5 }}>Ticker Symbol</p>
                  <p style={{ fontSize:13, color:T.faint, marginBottom:12, lineHeight:1.5 }}>Short token symbol shown on your campaign badge — max 6 characters.</p>
                  <input value={ticker}
                    onChange={e => setTicker(e.target.value.toUpperCase().slice(0,6))}
                    placeholder="SOL"
                    autoFocus
                    style={{ ...inputStyle, fontFamily:"var(--font-geist-mono)", letterSpacing:"0.16em", fontSize:20, fontWeight:700, textAlign:"center" }}
                    onFocus={e => (e.currentTarget.style.borderColor="rgba(255,255,255,0.3)")}
                    onBlur={e => (e.currentTarget.style.borderColor=T.border)}/>
                </div>

                <div>
                  <p style={{ fontSize:12, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.13em", color:T.subtle, fontWeight:600, marginBottom:5 }}>Budget (Betttr.xyz)</p>
                  <p style={{ fontSize:13, color:T.faint, marginBottom:12, lineHeight:1.5 }}>Total $Betttr.xyz prize pool distributed to creators across this campaign.</p>
                  <NumInput value={budget} onChange={v => setBudget(Math.max(1, v))} min={1} step={1000}/>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div key="s3"
                initial={{ opacity:0, x:30 }} animate={{ opacity:1, x:0 }}
                exit={{ opacity:0, x:-30 }} transition={{ duration:0.2 }}>

                <div style={{ marginBottom:26 }}>
                  <p style={{ fontSize:12, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.13em", color:T.subtle, fontWeight:600, marginBottom:5 }}>Impression Goal</p>
                  <p style={{ fontSize:13, color:T.faint, marginBottom:12, lineHeight:1.5 }}>Target total views across all creator posts. Campaign closes automatically when reached.</p>
                  <NumInput value={goal} onChange={v => setGoal(Math.max(1, v))} min={1} step={500000}/>
                </div>

                <div>
                  <p style={{ fontSize:12, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.13em", color:T.subtle, fontWeight:600, marginBottom:5 }}>Betttr.xyz per 1K Views</p>
                  <p style={{ fontSize:13, color:T.faint, marginBottom:12, lineHeight:1.5 }}>How much $Betttr.xyz a creator earns per 1,000 verified impressions on their post.</p>
                  <NumInput value={dripPerK} onChange={v => setDripPerK(Math.max(0.001, v))} min={0.001} step={0.001}/>
                  {kPerDrip > 0 && (
                    <p className="rainbow-text" style={{ fontSize:13, fontFamily:"var(--font-geist-mono)", fontWeight:600, marginTop:10, textAlign:"center" }}>
                      {kPerDrip.toLocaleString()}K views = 1 Betttr.xyz
                    </p>
                  )}
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>

        {/* Error */}
        {errMsg && (
          <div style={{ padding:"0 28px 4px" }}>
            <p style={{ fontSize:13, color:"#ff7070", textAlign:"center" }}>{errMsg}</p>
          </div>
        )}

        {/* Footer navigation */}
        <div style={{ padding:"8px 28px 28px", display:"flex", gap:12 }}>
          {step > 1 && (
            <button onClick={() => setStep(s => s-1)} data-cursor-hover
              style={{ flex:1, height:50, borderRadius:13, border:`1px solid ${T.border}`, background:"none", color:T.subtle, fontSize:15, fontWeight:600, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor="rgba(255,255,255,0.22)"; e.currentTarget.style.color=T.fg; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor=T.border; e.currentTarget.style.color=T.subtle; }}>
              Back
            </button>
          )}

          {step < STEPS && (
            <motion.button
              onClick={() => canNext && setStep(s => s+1)}
              disabled={!canNext}
              whileHover={canNext ? { scale:1.01 } : {}}
              whileTap={canNext ? { scale:0.99 } : {}}
              data-cursor-hover
              style={{ flex:step>1?2:1, height:50, borderRadius:13, border:"none",
                background:canNext ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)",
                color:canNext ? T.fg : T.faint,
                fontSize:15, fontWeight:600, cursor:canNext ? "pointer" : "not-allowed",
                fontFamily:"inherit", transition:"background 0.2s" }}>
              Next →
            </motion.button>
          )}

          {step === STEPS && (
            <motion.button onClick={save} disabled={!canLaunch}
              whileHover={canLaunch ? { scale:1.02 } : {}}
              whileTap={canLaunch ? { scale:0.98 } : {}}
              data-cursor-hover
              className={canLaunch ? "rainbow-bg" : ""}
              style={{
                flex:2, height:58, borderRadius:16, border:"none",
                background:!canLaunch ? "rgba(255,255,255,0.05)" : undefined,
                color:canLaunch ? "#080810" : "rgba(255,255,255,0.2)",
                fontWeight:800, fontSize:18, cursor:canLaunch ? "pointer" : "not-allowed",
                display:"flex", alignItems:"center", justifyContent:"center", gap:10,
                fontFamily:"inherit", letterSpacing:"-0.01em",
                boxShadow:canLaunch ? "0 0 60px rgba(200,190,255,0.45), 0 0 24px rgba(180,210,255,0.3)" : "none",
                transition:"box-shadow 0.4s",
              }}>
              {saving
                ? <><motion.span animate={{ rotate:360 }} transition={{ duration:0.9, repeat:Infinity, ease:"linear" }} style={{ display:"inline-block" }}>&#x27F3;</motion.span> Launching…</>
                : <span style={{ display:"flex", alignItems:"center", gap:10, letterSpacing:"-0.01em" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink:0 }}>
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8l7 4-7 4z"/>
                    </svg>
                    Launch Campaign
                  </span>
              }
            </motion.button>
          )}
        </div>

      </motion.div>
    </motion.div>
  );
}
