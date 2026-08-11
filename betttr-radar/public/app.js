let state = null;
let selectedId = null;
let es = null;
let metaClickBound = false;
let lastMetaSig = '';
let loaderDismissed = false;
let progressTimer = null;

const STAGE_CLASS = {
  spark: 'spark',
  naming: 'spark',
  recognition: '',
  copycat: 'copycat',
  momentum: 'momentum',
  peak: 'momentum',
  fade: 'fade',
};

function setLoaderStep(stepId, status) {
  const row = document.getElementById(`loader-${stepId}`);
  if (!row) return;
  row.classList.remove('active', 'done');
  if (status === 'loading') row.classList.add('active');
  if (status === 'done') row.classList.add('done');
  const action = row.querySelector('.loader-action');
  if (!action) return;
  if (status === 'loading') {
    action.innerHTML = '<span class="loader-wait">Connecting…</span>';
  } else if (status === 'done') {
    action.innerHTML = '<span class="loader-check">✓ Connected</span>';
  } else {
    action.innerHTML = '<span class="loader-wait">Waiting…</span>';
  }
}

function animateProgressBar() {
  const fill = document.getElementById('progressFill');
  if (!fill || progressTimer) return;
  let w = 0;
  progressTimer = setInterval(() => {
    if (loaderDismissed) {
      clearInterval(progressTimer);
      progressTimer = null;
      return;
    }
    w = Math.min(w + 1.5, 92);
    fill.style.width = `${w}%`;
  }, 60);
}

function dismissLoader() {
  if (loaderDismissed) return;
  loaderDismissed = true;
  setLoaderStep('geyser', 'done');
  setLoaderStep('x', 'done');
  setLoaderStep('meta', 'done');
  document.getElementById('progressFill')?.style.setProperty('width', '100%');
  setTimeout(() => {
    document.getElementById('loader')?.classList.add('loader-out');
    document.getElementById('appRoot')?.classList.add('app-visible');
    setTimeout(() => document.getElementById('loader')?.remove(), 550);
  }, 700);
}

function runLoaderSequence() {
  setLoaderStep('geyser', 'loading');
  setTimeout(() => setLoaderStep('geyser', 'done'), 1400);
  setTimeout(() => setLoaderStep('x', 'loading'), 1600);
  setTimeout(() => setLoaderStep('x', 'done'), 2800);
  setTimeout(() => setLoaderStep('meta', 'loading'), 3000);
}

function reportToState(report) {
  return {
    metas: report.metas ?? null,
    launches: report.launches ?? [],
    sparks: report.sparks ?? [],
    geyserStats: report.geyserStats ?? {},
    geyserEnabled: report.geyserEnabled,
    live: report.live ?? {
      connected: false,
      feeds: { geyser: false, tweetstream: false, tweetstreamAccounts: [] },
    },
  };
}

async function loadInitial() {
  runLoaderSequence();
  animateProgressBar();

  const res = await fetch('/api/report');
  const report = await res.json();
  if (report.error) {
    document.getElementById('heroMeta').innerHTML =
      `<p class="empty">${report.error}<br/>Run <code>npm run scan</code> in narra/</p>`;
    setLoaderStep('meta', 'done');
    setTimeout(dismissLoader, 1200);
    return;
  }
  state = reportToState(report);
  connectStream();
  bindMetaSelection();
  startAgeTick();
  render();
}

function bindMetaSelection() {
  if (metaClickBound) return;
  metaClickBound = true;

  for (const id of ['formingList', 'activeList', 'timelineFeed']) {
    document.getElementById(id)?.addEventListener('click', (e) => {
      const item = e.target.closest('[data-meta-id]');
      if (!item?.dataset.metaId) return;
      selectMeta(item.dataset.metaId);
    });
  }
}

function getSelectedMeta(metas) {
  if (!metas || !selectedId) return null;
  return findMeta(metas, selectedId);
}

function selectMeta(id) {
  if (!id || !state?.metas) return;
  const meta = findMeta(state.metas, id);
  if (!meta) return;
  selectedId = id;
  renderDetail(meta);
  renderHero(state.metas);
  renderStageRail(state.metas);
  document.querySelectorAll('.meta-item.selected').forEach((el) => el.classList.remove('selected'));
  document.querySelectorAll(`.meta-item[data-meta-id="${CSS.escape(id)}"]`).forEach((el) => {
    el.classList.add('selected');
  });
}

function findMeta(metas, id) {
  if (!id) return null;
  return metas.emerging?.find((m) => m.id === id)
    ?? metas.forming.find((m) => m.id === id)
    ?? metas.active.find((m) => m.id === id)
    ?? metas.fading?.find((m) => m.id === id)
    ?? metas.all.find((m) => m.id === id);
}

function resolveSelectedMeta(metas) {
  const current = getSelectedMeta(metas);
  if (current) return current;
  return metas.active[0] ?? metas.forming[0] ?? metas.emerging?.[0] ?? metas.all[0] ?? null;
}

function metaSignature(metas) {
  return `${metas.generatedAt}|${metas.dominantStage}|${metas.formingCount}|${metas.activeMetaCount}|${metas.emerging?.length ?? 0}`;
}

function connectStream() {
  if (es) es.close();
  es = new EventSource('/api/stream');

  es.addEventListener('init', (e) => {
    const data = JSON.parse(e.data);
    const feeds = data.feeds ?? {};
    state = {
      metas: data.metas,
      launches: data.launches ?? [],
      sparks: data.sparks ?? [],
      geyserStats: data.geyserStats ?? {},
      geyserEnabled: data.geyserEnabled,
      live: {
        connected: data.connected,
        feeds: data.feeds,
        liveLaunches: data.liveLaunches,
        liveSparks: data.liveSparks,
        lastLaunchAt: data.lastLaunchAt,
        lastSparkAt: data.lastSparkAt,
      },
    };
    setLoaderStep('geyser', feeds.geyser ? 'done' : (data.geyserEnabled === false ? 'done' : 'loading'));
    setLoaderStep('x', feeds.tweetstream ? 'done' : 'loading');
    setLoaderStep('meta', 'done');
    setTimeout(dismissLoader, 700);
    render();
  });

  es.addEventListener('launch', (e) => {
    const data = JSON.parse(e.data);
    if (data.metas) state.metas = data.metas;
    if (data.sparks) state.sparks = data.sparks;
    if (data.launches) state.launches = data.launches;
    else if (data.launch) state.launches = [data.launch, ...(state.launches ?? [])].slice(0, 500);
    if (data.geyserStats) state.geyserStats = data.geyserStats;
    if (data.liveLaunches != null) state.live = { ...state.live, liveLaunches: data.liveLaunches };
    render(true);
  });

  es.addEventListener('spark', (e) => {
    const data = JSON.parse(e.data);
    if (data.metas) state.metas = data.metas;
    if (data.sparks) state.sparks = data.sparks;
    else if (data.spark) {
      state.sparks = [data.spark, ...(state.sparks ?? [])].slice(0, 100);
    }
    render(true);
  });

  es.addEventListener('refresh', (e) => {
    const data = JSON.parse(e.data);
    if (data.metas) state.metas = data.metas;
    if (data.sparks) state.sparks = data.sparks;
    if (data.launches) state.launches = data.launches;
    if (data.geyserStats) state.geyserStats = data.geyserStats;
    render();
  });

  es.onerror = () => {
    setFeedStatus('geyserStatus', 'off', 'SSE reconnecting…');
  };

  setTimeout(() => dismissLoader(), 6000);
}

function mergeState(data) {
  if (!state) state = {};
  if (data.metas) state.metas = data.metas;
  if (data.launches) state.launches = data.launches;
  if (data.sparks) state.sparks = data.sparks;
  if (data.live) state.live = data.live;
  if (data.feeds) state.live = { ...state.live, feeds: data.feeds };
  if (data.connected != null) {
    state.live = { ...state.live, connected: data.connected, feeds: data.feeds };
  }
}

function setFeedStatus(id, kind, label) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `status-pill glass-pill ${kind}`;
  el.querySelector('.label').textContent = label;
}

function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function fmtAge(sec) {
  if (sec == null || sec < 0) return '—';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

function startAgeTick() {
  if (window.__narraAgeTick) return;
  window.__narraAgeTick = setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    document.querySelectorAll('[data-ts]').forEach((el) => {
      const ts = Number(el.dataset.ts);
      if (!ts) return;
      el.textContent = fmtAge(now - ts);
    });
  }, 1000);
}

function decayMeter(m, compact) {
  const trendClass = m.volumeTrend ?? 'cooling';
  const rate = m.dyingRate ?? 0;
  const volLine = m.totalVolumeUsd1h > 0 || m.totalVolumeUsd24h > 0
    ? `$${formatCompact(m.totalVolumeUsd1h)}/1h vol · $${formatCompact(m.totalVolumeUsd24h)}/24h`
    : `${m.launchRateNow ?? 0}/hr now · ${m.launchRatePeak ?? 0}/hr peak`;
  if (compact) {
    return `
      <div class="decay-meter compact">
        <div class="decay-bar" title="Trend decay ${rate}%"><div class="decay-fill ${trendClass}" style="width:${rate}%"></div></div>
        <span class="decay-pct ${trendClass}">${rate}%</span>
      </div>`;
  }
  return `
    <div class="decay-meter">
      <div class="decay-head">
        <span>Trend decay</span>
        <span class="decay-pct ${trendClass}">${rate}% · ${trendClass}</span>
      </div>
      <div class="decay-bar"><div class="decay-fill ${trendClass}" style="width:${rate}%"></div></div>
      <div class="decay-sub">${volLine}${m.totalTxns24h ? ` · ${m.totalTxns24h} txns/24h` : ''}</div>
    </div>`;
}

function fmtRel(hours) {
  if (hours < 1) return `${Math.round(hours * 60)}m ago`;
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function render(flashNew) {
  const metas = state.metas;
  if (!metas) return;

  const live = state.live ?? {};
  const feeds = live.feeds ?? {};

  setFeedStatus(
    'geyserStatus',
    feeds.geyser ? 'live' : 'off',
    feeds.geyser
      ? `Geyser · ${state.geyserStats?.perMinute ?? live.liveLaunches ?? 0}/min · ${state.launches?.length ?? 0} stored`
      : state.geyserEnabled === false
        ? 'Geyser disabled'
        : live.connected
          ? 'Geyser reconnecting…'
          : 'Geyser connecting…',
  );
  setFeedStatus(
    'xStatus',
    feeds.tweetstream ? 'live' : 'off',
    feeds.tweetstream ? `X live · ${(state.sparks ?? []).length} sparks` : 'X connecting…',
  );

  document.getElementById('metaStats').textContent =
    `${state.launches?.length ?? metas.totalLaunches} creates · ${state.geyserStats?.perMinute ?? 0}/min · ${metas.activeMetaCount} active · ${metas.formingCount} forming · ${capitalize(metas.dominantStage)}`;

  const sig = metaSignature(metas);
  const metaChanged = sig !== lastMetaSig;
  lastMetaSig = sig;

  const selected = resolveSelectedMeta(metas);
  selectedId = selected?.id ?? null;

  renderHero(metas, metaChanged || flashNew);
  renderStageRail(metas, metaChanged || flashNew);
  renderForming(metas, flashNew);
  renderActive(metas);
  renderSparks();
  renderLaunches();
  renderTimeline(metas);

  document.getElementById('formingCount').textContent = metas.formingCount;
  document.getElementById('activeCount').textContent = metas.activeMetaCount;

  if (selected) {
    renderDetail(selected);
  } else {
    document.getElementById('metaDetail').innerHTML =
      '<p class="empty">Select a meta from Forming or Active</p>';
  }
}

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function renderHero(metas, pulse) {
  const top = getSelectedMeta(metas) ?? metas.active[0] ?? metas.forming[0] ?? metas.emerging?.[0] ?? metas.all[0];
  const el = document.getElementById('heroMeta');
  if (!top) {
    el.innerHTML = `<p class="hero-loading">${metas.insight ?? 'No metas in lookback window'}</p>`;
    return;
  }

  el.innerHTML = `
    <div class="hero-inner${pulse ? ' pulse' : ''}">
      <div class="hero-theme">"${top.theme}"</div>
      <div class="hero-stats">
        <div class="hero-stat"><span class="val">${top.launchCount}</span><span class="lbl">tok</span></div>
        <div class="hero-stat"><span class="val">${top.velocityPerHour}/h</span></div>
        <div class="hero-stat"><span class="val" data-ts="${top.firstSeen}">${fmtAge(top.firstSeenAgoSec)}</span><span class="lbl">since 1st</span></div>
        <div class="hero-stat"><span class="val" data-ts="${top.lastSeen}">${fmtAge(top.lastSeenAgoSec)}</span><span class="lbl">last seen</span></div>
      </div>
      <div class="stage-badge">
        <span class="num">${top.stageIndex + 1}/7</span>
        <span class="name">${top.stageLabel}</span>
      </div>
    </div>
  `;
}

function formatCompact(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function renderStageRail(metas, pulse) {
  const top = getSelectedMeta(metas) ?? metas.active[0] ?? metas.forming[0] ?? metas.emerging?.[0] ?? metas.all[0];
  const current = top?.stageIndex ?? 0;

  document.getElementById('stageRail').innerHTML = `
    <div class="stage-pipeline${pulse ? ' pulse' : ''}">
      ${metas.stages.map((s, i) => {
        let cls = 'stage-step';
        if (i < current) cls += ' done';
        else if (i === current) cls += ' current';
        else cls += ' future';
        return `
          <div class="${cls}">
            <div class="step-num">${i + 1}</div>
            <div class="step-name">${s.label}</div>
          </div>`;
      }).join('')}
    </div>
  `;
}

function imageStrip(images, max = 6) {
  if (!images?.length) return '';
  return `<div class="meta-images">${images.slice(0, max).map((url) =>
    `<img src="${escapeHtml(url)}" alt="" loading="lazy" class="meta-thumb" />`,
  ).join('')}${images.length > max ? `<span class="meta-more">+${images.length - max}</span>` : ''}</div>`;
}

function metaCard(m, extraClass) {
  return `
    <div class="meta-item ${extraClass ?? ''} ${selectedId === m.id ? 'selected' : ''}"
         data-meta-id="${escapeHtml(m.id)}">
      ${imageStrip(m.sampleImages)}
      <div class="row1">
        <span class="theme">"${m.theme}"</span>
        <span class="stage-pill ${STAGE_CLASS[m.stage] ?? ''}">${m.stageLabel}</span>
      </div>
      <div class="row2 meta-timers">
        <span class="age-tag">1st <strong data-ts="${m.firstSeen}">${fmtAge(m.firstSeenAgoSec)}</strong></span>
        <span class="age-tag">last <strong data-ts="${m.lastSeen}">${fmtAge(m.lastSeenAgoSec)}</strong></span>
      </div>
      <div class="row2">
        <strong>${m.launchCount}</strong> tokens · ${m.velocityPerHour}/hr
        ${m.totalVolumeUsd24h ? ` · $${formatCompact(m.totalVolumeUsd24h)} vol` : ''}
      </div>
      ${decayMeter(m, true)}
      <div class="psych">${m.psychologyLabel}</div>
    </div>`;
}

function renderForming(metas, flash) {
  const el = document.getElementById('formingList');
  const clusters = [...(metas.emerging ?? []), ...metas.forming];
  if (!clusters.length) {
    el.innerHTML = '<p class="empty">Watching for 2+ token clusters…</p>';
    return;
  }
  el.innerHTML = clusters.map((m) =>
    metaCard(m, `${m.isEmerging ? 'emerging' : 'new-forming'}${flash ? ' flash' : ''}`),
  ).join('');
}

function renderActive(metas) {
  const el = document.getElementById('activeList');
  if (!metas.active.length) {
    el.innerHTML = '<p class="empty">No active metas in the last 6 hours</p>';
    return;
  }
  el.innerHTML = metas.active.map((m) => metaCard(m)).join('');
}

function renderDetail(m) {
  document.getElementById('metaDetail').innerHTML = `
    <div class="detail-section">
      <div class="detail-theme">"${m.theme}"</div>
      <div class="detail-timers">
        <span class="age-tag">Narrative first seen <strong data-ts="${m.firstSeen}">${fmtAge(m.firstSeenAgoSec)}</strong> ago</span>
        <span class="age-tag">Last token <strong data-ts="${m.lastSeen}">${fmtAge(m.lastSeenAgoSec)}</strong> ago</span>
        <span class="age-tag">Span ${m.spanHours}h</span>
      </div>
      ${decayMeter(m, false)}
      <div class="detail-grid">
        <div class="detail-stat"><div class="val">${m.stageLabel}</div><div class="lbl">Stage</div></div>
        <div class="detail-stat"><div class="val">${m.launchCount}</div><div class="lbl">Coins</div></div>
        <div class="detail-stat"><div class="val">${m.launchRateNow}/h</div><div class="lbl">Launch rate</div></div>
        <div class="detail-stat"><div class="val">$${formatCompact(m.totalVolumeUsd1h)}</div><div class="lbl">Vol 1h</div></div>
      </div>
    </div>

    <div class="detail-section">
      <h3>Psychology</h3>
      <p style="color:var(--accent)">${m.psychologyLabel}</p>
    </div>

    <div class="detail-section">
      <h3>Deploying</h3>
      <div class="deploy-grid">
        ${m.tokens.slice(0, 10).map((t) => `
          <a class="deploy-card" href="https://pump.fun/coin/${t.mint}" target="_blank" rel="noopener">
            ${t.image
              ? `<img src="${escapeHtml(t.image)}" alt="" class="deploy-img" loading="lazy" />`
              : `<div class="deploy-img placeholder">?</div>`}
            <div class="deploy-label">${escapeHtml(t.symbol ?? t.name ?? t.mint.slice(0, 6))}</div>
            ${t.blockTime ? `<div class="deploy-age" data-ts="${t.blockTime}">${fmtAge(t.ageSec)}</div>` : ''}
            ${t.volumeUsd24h ? `<div class="deploy-mcap">$${formatCompact(t.volumeUsd24h)}</div>` : ''}
          </a>
        `).join('')}
      </div>
    </div>
  `;
}

function renderLaunches() {
  const launches = state.launches ?? [];
  const el = document.getElementById('launchFeed');
  const countEl = document.getElementById('launchCount');
  const rateEl = document.getElementById('launchRate');
  if (!el) return;

  countEl.textContent = launches.length;
  const gs = state.geyserStats ?? {};
  if (rateEl) {
    rateEl.textContent =
      `${gs.perMinute ?? 0} creates/min · ${gs.createsParsed ?? 0} parsed from ${gs.pumpTxSeen ?? 0} pump txs`;
  }

  if (!launches.length) {
    el.innerHTML = '<p class="empty">Waiting for CreateV2 stream…</p>';
    return;
  }

  el.innerHTML = launches.slice(0, 60).map((l) => {
    const label = l.symbol || l.name || l.mint.slice(0, 8);
    const sub = l.name && l.symbol && l.name !== l.symbol ? l.name : l.mint.slice(0, 16) + '…';
    const ageSec = l.blockTime ? Math.floor(Date.now() / 1000) - l.blockTime : null;
    return `
    <div class="launch-row">
      ${l.image
        ? `<img src="${escapeHtml(l.image)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'placeholder-img',textContent:'?'}))" />`
        : `<div class="placeholder-img">?</div>`}
      <div class="launch-meta">
        <div class="sym">${escapeHtml(label)}
          ${l.isCreateV2 ? '<span class="v2-tag">V2</span>' : ''}</div>
        <div class="name-line">${escapeHtml(sub)}</div>
      </div>
      <div class="launch-side">
        ${l.blockTime ? `<span class="age-tag launch-age" data-ts="${l.blockTime}">${fmtAge(ageSec)}</span>` : ''}
        ${l.volumeUsd1h ? `<span class="vol-tag">$${formatCompact(l.volumeUsd1h)}</span>` : ''}
        <a href="https://pump.fun/coin/${l.mint}" target="_blank" rel="noopener" title="Open on pump.fun">↗</a>
      </div>
    </div>`;
  }).join('');
}

function renderSparks() {
  const sparks = state.sparks ?? [];
  const el = document.getElementById('sparkList');
  const countEl = document.getElementById('sparkCount');
  if (!el) return;
  countEl.textContent = sparks.length;

  if (!sparks.length) {
    el.innerHTML = '<p class="empty">Waiting for posts from watched X accounts…</p>';
    return;
  }

  el.innerHTML = sparks.slice(0, 20).map((s) => `
    <div class="spark-item">
      <div class="handle">@${s.handle} · ${s.kind}</div>
      <div class="text">${escapeHtml(s.text.slice(0, 140))}${s.text.length > 140 ? '…' : ''}</div>
      <div class="time">${fmtTime(s.receivedAt)} ${s.link ? `· <a href="${s.link}" target="_blank" rel="noopener">view</a>` : ''}</div>
    </div>
  `).join('');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderTimeline(metas) {
  const events = [];
  for (const s of state.sparks ?? []) {
    events.push({
      at: s.receivedAt,
      stage: 'spark',
      theme: s.handle,
      label: s.text.slice(0, 100),
      metaId: null,
      isSocial: true,
    });
  }
  for (const m of [...(metas.emerging ?? []), ...metas.forming, ...metas.active]) {
    for (const ev of m.timeline) {
      events.push({ ...ev, theme: m.theme, metaId: m.id });
    }
  }
  events.sort((a, b) => b.at - a.at);

  const el = document.getElementById('timelineFeed');
  if (!events.length) {
    el.innerHTML = '<p class="empty">No timeline events yet</p>';
    return;
  }

  el.innerHTML = events.slice(0, 50).map((ev) => `
    <div class="timeline-event"${ev.metaId ? ` data-meta-id="${escapeHtml(ev.metaId)}"` : ''}>
      <span class="time">${fmtTime(ev.at)}</span>
      <span class="label">
        <span class="stage-tag">${ev.stage}</span>
        ${ev.isSocial ? `<strong>@${ev.theme}</strong>` : `<strong>"${ev.theme}"</strong>`} — ${escapeHtml(ev.label)}
      </span>
    </div>
  `).join('');
}

loadInitial();
