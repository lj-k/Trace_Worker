/* ============================================================================
 *  Views — canvas renderers: overview strip · pipeline swimlanes · address/time
 * ==========================================================================*/

/* ------------------------------- viewport ------------------------------- */
const VP = {
  t0: 0, t1: 1,           // visible raw-time window
  y0: 0, y1: 1,           // address-view vertical window (rank or linear units)
  yInit: false,
  width() { return this.t1 - this.t0; },
  set(t0, t1) {
    const span = Math.max(S.t1 - S.t0, 1);
    let w = Math.max(t1 - t0, S.period * 0.5);
    w = Math.min(w, span * 40);
    this.t0 = t0; this.t1 = t0 + w;
  },
  fit() {
    if (!S.n) return;
    const pad = Math.max((S.t1 - S.t0) * 0.02, S.period);
    this.set(S.t0 - pad, S.t1 + pad);
  },
  last(cycles) {
    if (!S.n) return;
    const w = cycles * S.period;
    this.set(S.t1 - w * 0.92, S.t1 + w * 0.08);
  },
  zoomAt(fx, factor) {                       // fx: 0..1 anchor inside window
    const w = this.width(), nw = clamp(w * factor, S.period * 0.5, Math.max((S.t1 - S.t0) * 40, S.period * 1e6));
    const anchor = this.t0 + w * fx;
    this.t0 = anchor - nw * fx; this.t1 = this.t0 + nw;
  },
  panBy(dt) { this.t0 += dt; this.t1 += dt; },
  followLatest() {
    if (!S.n) return;
    const w = this.width();
    this.t1 = S.t1 + w * 0.06; this.t0 = this.t1 - w;
  },
};

/* ------------------------------- filtering ------------------------------ */
const FILT = {
  arr: new Int32Array(1024), n: 0,
  builtN: 0, builtBase: -1, ver: 0,
  pcSet: null, addrSet: null, iidSet: null, lo: -1, hi: -1, q: '', onlySel: false,

  parse() {
    const gset = (s, radix) => {
      s = (s || '').trim(); if (!s) return null;
      const out = new Set();
      for (let p of s.split(/[,\s]+/)) {
        p = p.trim().replace(/^0x/i, ''); if (!p) continue;
        const v = parseInt(p, radix); if (isFinite(v)) out.add(v);
      }
      return out.size ? out : null;
    };
    this.pcSet = gset($('#fPC').value, 16);
    this.addrSet = gset($('#fAddr').value, 16);
    this.iidSet = gset($('#fIID').value, 16);
    const pv = s => { s = (s || '').trim().replace(/^0x/i, ''); const v = parseInt(s, 16); return isFinite(v) ? v : -1; };
    this.lo = pv($('#fAddrLo').value); this.hi = pv($('#fAddrHi').value);
    this.q = ($('#qSearch').value || '').trim().toLowerCase();
    this.onlySel = $('#ckOnlySel').checked;
    this.invalidate();
  },
  invalidate() { this.ver++; this.builtN = 0; this.n = 0; this.builtBase = S.base; },

  pass(i) {
    if (!S.tags[S.tag.a[i]].on) return false;
    const ad = S.addl.a[i];
    if (this.addrSet && !this.addrSet.has(ad)) return false;
    if (this.pcSet && !this.pcSet.has(S.pc.a[i])) return false;
    if (this.iidSet && !this.iidSet.has(S.iid.a[i])) return false;
    if (this.lo >= 0 && !(ad >= this.lo)) return false;
    if (this.hi >= 0 && !(ad < this.hi)) return false;
    if (this.onlySel && SEL.line >= 0 && ad !== SEL.line) return false;
    if (this.q) {
      const q = this.q;
      // structured shortcuts:  pc=1e88 / addr=xxx / iid=05 / tag=L2C
      let ok = false;
      const m = /^(pc|addr|addl|iid|tag)\s*[=:]\s*(.+)$/.exec(q);
      if (m) {
        const v = m[2].replace(/^0x/i, '');
        if (m[1] === 'pc') ok = S.pc.a[i] === parseInt(v, 16);
        else if (m[1] === 'iid') ok = S.iid.a[i] === parseInt(v, 16);
        else if (m[1] === 'tag') ok = S.tags[S.tag.a[i]].name.toLowerCase().includes(v);
        else ok = ad === parseInt(v, 16);
      } else {
        if (S.tags[S.tag.a[i]].name.toLowerCase().includes(q)) ok = true;
        else if (ad >= 0 && ad.toString(16).padStart(10, '0').includes(q)) ok = true;
        else if (S.pc.a[i] >= 0 && S.pc.a[i].toString(16).padStart(4, '0').includes(q)) ok = true;
        else {
          const T = S.tags[S.tag.a[i]], r = S.row.a[i];
          for (let k = 0; k < T.cols.length && !ok; k++) {
            const id = T.cols[k].a[r];
            if (id && S.strs[id].toLowerCase().includes(q)) ok = true;
          }
        }
      }
      if (!ok) return false;
    }
    return true;
  },

  build() {
    if (this.builtBase !== S.base) { this.builtN = 0; this.n = 0; this.builtBase = S.base; }
    if (this.builtN === S.n) return;
    if (this.arr.length < S.n) {
      let c = Math.max(1024, this.arr.length);
      while (c < S.n) c *= 2;
      const b = new Int32Array(c); b.set(this.arr.subarray(0, this.n)); this.arr = b;
    }
    for (let i = this.builtN; i < S.n; i++) if (this.pass(i)) this.arr[this.n++] = i;
    this.builtN = S.n;
  },
  /** indices of visible+filtered events in [t0,t1]; returns {a, s, e} slice of arr */
  range(t0, t1) {
    this.build();
    const a = this.arr, n = this.n, T = S.time.a;
    let lo = 0, hi = n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (T[a[m]] < t0) lo = m + 1; else hi = m; }
    const s = lo;
    hi = n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (T[a[m]] <= t1) lo = m + 1; else hi = m; }
    return { a, s, e: lo };
  },
};

/* ------------------------------ selection ------------------------------- */
const SEL = { ev: -1, line: -1, hover: -1 };

/* ------------------------------ canvas util ----------------------------- */
function cvSetup(cv) {
  const dpr = window.devicePixelRatio || 1;
  const r = cv.parentNode.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, W: w, H: h };
}
function niceStep(range, target) {
  if (!(range > 0)) return 1;
  const raw = range / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}
const UNIT_SCALE = { fs: 1e-15, ps: 1e-12, ns: 1e-9, us: 1e-6 };
/** x-axis value for a raw time, according to the axis mode */
function axVal(t) {
  return $('#selXAxis').value === 'cycle' ? t / S.period : t;
}
function axLabel(t) {
  if ($('#selXAxis').value === 'cycle') return fmtNum(t / S.period, 0);
  const u = $('#selUnit').value;
  if (u === '1' || !UNIT_SCALE[u]) return fmtNum(t, 0);
  const sec = t * UNIT_SCALE[u];
  if (sec >= 1e-3) return (sec * 1e3).toFixed(3) + ' ms';
  if (sec >= 1e-6) return (sec * 1e6).toFixed(3) + ' us';
  if (sec >= 1e-9) return (sec * 1e9).toFixed(3) + ' ns';
  return (sec * 1e12).toFixed(2) + ' ps';
}
function axUnitName() { return $('#selXAxis').value === 'cycle' ? 'cycle' : ($('#selUnit').value === '1' ? 'tick' : $('#selUnit').value); }

/* --------------------------- lane layout -------------------------------- */
let LANES = [], LANE_OF = new Int32Array(256).fill(-1);
function computeLanes() {
  LANES = S.tags.map((T, i) => ({ t: i, T })).filter(x => x.T.on && x.T.count > 0);
  LANES.sort((a, b) =>
    (GROUP_ORDER[a.T.meta.g] ?? 9) - (GROUP_ORDER[b.T.meta.g] ?? 9) ||
    a.T.meta.o - b.T.meta.o);
  LANE_OF.fill(-1);
  LANES.forEach((l, k) => { LANE_OF[l.t] = k; });
}

/* ============================================================================
 *  OVERVIEW STRIP  (full trace density + brush)
 * ==========================================================================*/
const OV = { cache: null, key: '' };
function drawOverview() {
  const cv = $('#cvOv'), { g, W, H } = cvSetup(cv);
  if (!S.n) return;
  const NB = Math.max(60, Math.floor(W));
  const key = `${S.dirty}|${NB}|${FILT.ver}|${S.t0}|${S.t1}`;
  if (OV.key !== key) {
    FILT.build();
    const nl = Math.max(1, LANES.length);
    const bins = new Float32Array(NB * nl);
    const span = Math.max(S.t1 - S.t0, 1);
    for (let k = 0; k < FILT.n; k++) {
      const i = FILT.arr[k];
      const b = Math.min(NB - 1, Math.floor((S.time.a[i] - S.t0) / span * NB));
      const ln = LANE_OF[S.tag.a[i]];
      if (ln >= 0) bins[b * nl + ln]++;
    }
    let mx = 1;
    for (let b = 0; b < NB; b++) { let s = 0; for (let l = 0; l < nl; l++) s += bins[b * nl + l]; if (s > mx) mx = s; }
    OV.cache = { bins, NB, nl, mx }; OV.key = key;
  }
  const { bins, NB: nb, nl, mx } = OV.cache;
  const pad = 3, hh = H - pad * 2 - 11;

  g.fillStyle = '#0a0f16'; g.fillRect(0, 0, W, H);
  for (let b = 0; b < nb; b++) {
    const x = b / nb * W, w = Math.max(1, W / nb + .6);
    let y = H - pad - 11;
    for (let l = 0; l < nl; l++) {
      const v = bins[b * nl + l];
      if (!v) continue;
      const h = v / mx * hh;
      g.fillStyle = LANES[l].T.meta.c;
      g.globalAlpha = .82;
      g.fillRect(x, y - h, w, h);
      y -= h;
    }
  }
  g.globalAlpha = 1;

  // time axis labels
  const span = Math.max(S.t1 - S.t0, 1);
  g.font = '9.5px var(--mono),monospace'; g.fillStyle = '#5f7085'; g.textBaseline = 'bottom';
  const step = niceStep(axVal(S.t0 + span) - axVal(S.t0), 9);
  const a0 = axVal(S.t0), a1 = axVal(S.t1);
  for (let v = Math.ceil(a0 / step) * step; v <= a1; v += step) {
    const x = (v - a0) / (a1 - a0) * W;
    g.fillStyle = '#1d2636'; g.fillRect(x, H - 12, 1, 5);
    g.fillStyle = '#5f7085'; g.textAlign = 'center';
    g.fillText(fmtNum(v, 0), clamp(x, 18, W - 18), H - 1.5);
  }

  // brush = current viewport
  const bx0 = (axVal(VP.t0) - a0) / (a1 - a0) * W, bx1 = (axVal(VP.t1) - a0) / (a1 - a0) * W;
  g.fillStyle = '#0d1117aa';
  g.fillRect(0, 0, clamp(bx0, 0, W), H - 12);
  g.fillRect(clamp(bx1, 0, W), 0, W, H - 12);
  g.strokeStyle = '#4da3ff'; g.lineWidth = 1.5;
  g.strokeRect(clamp(bx0, 0, W) + .5, .5, Math.max(2, clamp(bx1, 0, W) - clamp(bx0, 0, W)), H - 13);
  g.fillStyle = '#4da3ff22'; g.fillRect(clamp(bx0, 0, W), 0, Math.max(2, clamp(bx1 - bx0, 0, W)), H - 12);
}

/* ============================================================================
 *  PIPELINE SWIMLANES
 * ==========================================================================*/
const PIPE = {
  gut: 152, ruler: 22, yoff: 0, laneH: 40,
  hitX: new Float32Array(0), hitY: null, hitI: null, hitN: 0,
  lastFrameMs: 0, visN: 0,
};

function drawPipe() {
  const t0p = performance.now();
  const cv = $('#cvPipe'), { g, W, H } = cvSetup(cv);
  const gut = PIPE.gut, ruler = PIPE.ruler;
  const plotW = W - gut, plotH = H - ruler;

  g.fillStyle = '#0d1117'; g.fillRect(0, 0, W, H);
  if (!S.n) { emptyMsg(g, W, H, '暂无数据 — 请载入 trace 文件'); return; }
  computeLanes();
  if (!LANES.length) { emptyMsg(g, W, H, '所有事件类型都被隐藏了'); return; }

  const n = LANES.length;
  const laneH = PIPE.laneH = clamp(plotH / n, 22, 78);
  const totalH = laneH * n;
  PIPE.yoff = clamp(PIPE.yoff, 0, Math.max(0, totalH - plotH));
  const yoff = PIPE.yoff;

  const t0 = VP.t0, t1 = VP.t1, tw = Math.max(t1 - t0, 1e-9);
  const X = t => gut + (t - t0) / tw * plotW;
  const laneY = k => ruler + k * laneH - yoff + laneH / 2;

  /* ---- lane backgrounds & separators ---- */
  for (let k = 0; k < n; k++) {
    const y = ruler + k * laneH - yoff;
    if (y > H || y + laneH < ruler) continue;
    g.fillStyle = k & 1 ? '#0f151f' : '#0d1117';
    g.fillRect(gut, y, plotW, laneH);
    const prevG = k > 0 ? LANES[k - 1].T.meta.g : null;
    if (LANES[k].T.meta.g !== prevG) {
      g.fillStyle = '#31405a'; g.fillRect(gut, y, plotW, 1);
    } else {
      g.fillStyle = '#161d2b'; g.fillRect(gut, y, plotW, 1);
    }
    // centre guide
    g.fillStyle = '#141c28'; g.fillRect(gut, y + laneH / 2, plotW, 1);
  }

  /* ---- time grid ---- */
  const a0 = axVal(t0), a1 = axVal(t1);
  const step = niceStep(a1 - a0, Math.max(4, Math.floor(plotW / 110)));
  if ($('#ckGrid').checked) {
    g.strokeStyle = '#1a2231'; g.lineWidth = 1; g.beginPath();
    for (let v = Math.ceil(a0 / step) * step; v <= a1; v += step) {
      const x = Math.round(gut + (v - a0) / (a1 - a0) * plotW) + .5;
      g.moveTo(x, ruler); g.lineTo(x, H);
    }
    g.stroke();
  }

  /* ---- collect visible events ---- */
  const { a, s, e } = FILT.range(t0, t1);
  const cnt = e - s;
  PIPE.visN = cnt;
  const density = $('#ckDensity').checked && cnt > 30000;
  const sz = +$('#inSize').value;

  if (PIPE.hitX.length < cnt) {
    PIPE.hitX = new Float32Array(cnt + 1024); PIPE.hitY = new Float32Array(cnt + 1024); PIPE.hitI = new Int32Array(cnt + 1024);
  }
  PIPE.hitN = 0;

  /* ---- links (draw beneath the marks) ---- */
  const selLine = SEL.line;
  if ($('#ckLinks').checked && !density && cnt < 14000) {
    const winCyc = +$('#inLinkWin').value || 4000;
    const maxGap = winCyc * S.period;
    let drawn = 0;
    g.lineWidth = 1;
    for (let k = s; k < e && drawn < 9000; k++) {
      const i = a[k];
      const j = S.nextLine.a[i];
      if (j < 0) continue;
      const dt = S.time.a[j] - S.time.a[i];
      if (dt > maxGap) continue;
      const l1 = LANE_OF[S.tag.a[i]], l2 = LANE_OF[S.tag.a[j]];
      if (l1 < 0 || l2 < 0) continue;
      if (!FILT.pass(j)) continue;
      const x1 = X(S.time.a[i]), y1 = laneY(l1), x2 = X(S.time.a[j]), y2 = laneY(l2);
      if (x2 < gut - 40 || x1 > W + 40) continue;
      const isSel = selLine >= 0 && S.addl.a[i] === selLine;
      if (selLine >= 0 && !isSel) { g.strokeStyle = '#222c3d'; g.globalAlpha = .5; }
      else if (isSel) { g.strokeStyle = '#ffd479'; g.globalAlpha = 1; g.lineWidth = 1.9; }
      else { g.strokeStyle = l2 > l1 ? '#3b5578' : '#4a3d63'; g.globalAlpha = .62; }
      g.beginPath();
      if (Math.abs(y2 - y1) < 1) {
        g.moveTo(x1, y1); g.lineTo(x2, y2);
      } else {
        const mx = (x1 + x2) / 2;
        g.moveTo(x1, y1); g.bezierCurveTo(mx, y1, mx, y2, x2, y2);
      }
      g.stroke();
      // arrow head
      if (Math.abs(x2 - x1) > 6 || Math.abs(y2 - y1) > 6) {
        const ang = Math.atan2(y2 - (y1 + y2) / 2, x2 - (x1 + x2) / 2);
        g.beginPath();
        g.moveTo(x2, y2);
        g.lineTo(x2 - 5 * Math.cos(ang - .5), y2 - 5 * Math.sin(ang - .5));
        g.lineTo(x2 - 5 * Math.cos(ang + .5), y2 - 5 * Math.sin(ang + .5));
        g.closePath(); g.fillStyle = g.strokeStyle; g.fill();
      }
      g.lineWidth = 1;
      drawn++;
    }
    // IID chains inside the core
    if ($('#ckIIDLink').checked) {
      g.globalAlpha = .5; g.strokeStyle = '#2dd4bf'; g.setLineDash([3, 3]);
      let d2 = 0;
      for (let k = s; k < e && d2 < 4000; k++) {
        const i = a[k], j = S.nextIID.a[i];
        if (j < 0 || !FILT.pass(j)) continue;
        const l1 = LANE_OF[S.tag.a[i]], l2 = LANE_OF[S.tag.a[j]];
        if (l1 < 0 || l2 < 0) continue;
        g.beginPath(); g.moveTo(X(S.time.a[i]), laneY(l1)); g.lineTo(X(S.time.a[j]), laneY(l2)); g.stroke();
        d2++;
      }
      g.setLineDash([]);
    }
    g.globalAlpha = 1;
  }

  /* ---- marks ---- */
  if (density) {
    const NB = Math.max(1, Math.floor(plotW));
    const acc = new Float32Array(NB * n);
    for (let k = s; k < e; k++) {
      const i = a[k], ln = LANE_OF[S.tag.a[i]];
      if (ln < 0) continue;
      const b = clamp(Math.floor((S.time.a[i] - t0) / tw * NB), 0, NB - 1);
      acc[b * n + ln]++;
    }
    let mx = 1;
    for (let v = 0; v < acc.length; v++) if (acc[v] > mx) mx = acc[v];
    for (let ln = 0; ln < n; ln++) {
      const yc = laneY(ln), hMax = laneH * .42;
      g.fillStyle = LANES[ln].T.meta.c;
      for (let b = 0; b < NB; b++) {
        const v = acc[b * n + ln];
        if (!v) continue;
        const h = Math.max(1.5, Math.sqrt(v / mx) * hMax);
        g.globalAlpha = .35 + .6 * (v / mx);
        g.fillRect(gut + b, yc - h, 1, h * 2);
      }
    }
    g.globalAlpha = 1;
  } else {
    const showLbl = $('#ckLabels').checked && cnt < 260;
    g.textBaseline = 'bottom'; g.textAlign = 'center'; g.font = '9px var(--mono),monospace';
    for (let k = s; k < e; k++) {
      const i = a[k], ln = LANE_OF[S.tag.a[i]];
      if (ln < 0) continue;
      const x = X(S.time.a[i]), y = laneY(ln);
      if (y < ruler - 8 || y > H + 8) continue;
      const isSel = selLine >= 0 && S.addl.a[i] === selLine;
      const dim = selLine >= 0 && !isSel;
      const c = LANES[ln].T.meta.c;
      const w = isSel ? sz + 2.4 : sz;

      g.globalAlpha = dim ? .2 : 1;
      if (S.flag.a[i] & F_PFREQ) {                 // prefetch request → diamond
        g.fillStyle = c;
        g.beginPath(); g.moveTo(x, y - w - 1); g.lineTo(x + w + 1, y); g.lineTo(x, y + w + 1); g.lineTo(x - w - 1, y);
        g.closePath(); g.fill();
      } else {
        g.fillStyle = c;
        g.fillRect(x - w / 2, y - w, Math.max(1.6, w), w * 2);
      }
      if (isSel) {
        g.globalAlpha = 1; g.strokeStyle = '#ffd479'; g.lineWidth = 1.4;
        g.strokeRect(x - w / 2 - 2.5, y - w - 2.5, Math.max(1.6, w) + 5, w * 2 + 5);
      }
      if (i === SEL.ev) {
        g.globalAlpha = 1; g.strokeStyle = '#fff'; g.lineWidth = 1.6;
        g.strokeRect(x - w / 2 - 4, y - w - 4, Math.max(1.6, w) + 8, w * 2 + 8);
      }
      if (showLbl && !dim) {
        g.globalAlpha = .8; g.fillStyle = '#93a3bb';
        const pc = S.pc.a[i];
        g.fillText(pc >= 0 ? pc.toString(16).padStart(4, '0') : '', x, y - w - 3);
      }
      if (PIPE.hitN < PIPE.hitX.length) {
        PIPE.hitX[PIPE.hitN] = x; PIPE.hitY[PIPE.hitN] = y; PIPE.hitI[PIPE.hitN] = i; PIPE.hitN++;
      }
    }
    g.globalAlpha = 1;
  }

  /* ---- gutter (lane labels) ---- */
  g.fillStyle = '#111823'; g.fillRect(0, 0, gut, H);
  g.fillStyle = '#263043'; g.fillRect(gut - 1, 0, 1, H);
  g.textBaseline = 'middle';
  for (let k = 0; k < n; k++) {
    const y = ruler + k * laneH - yoff, yc = y + laneH / 2;
    if (y > H || y + laneH < ruler) continue;
    const m = LANES[k].T.meta;
    const prevG = k > 0 ? LANES[k - 1].T.meta.g : null;
    if (m.g !== prevG) {
      g.fillStyle = '#31405a'; g.fillRect(0, y, gut, 1);
      g.font = '700 8.5px var(--ui),sans-serif'; g.fillStyle = '#5f7085'; g.textAlign = 'left';
      g.fillText(m.g, 6, y + 6.5);
    }
    g.fillStyle = m.c; g.fillRect(4, yc - 5, 3, 10);
    g.font = '11px var(--ui),sans-serif'; g.textAlign = 'left';
    g.fillStyle = '#dbe4f0';
    let lbl = m.l;
    if (g.measureText(lbl).width > gut - 48) {
      while (lbl.length > 4 && g.measureText(lbl + '…').width > gut - 48) lbl = lbl.slice(0, -1);
      lbl += '…';
    }
    g.fillText(lbl, 12, yc - 4);
    g.font = '9px var(--mono),monospace'; g.fillStyle = '#5f7085';
    g.fillText(fmtInt(LANES[k].T.count), 12, yc + 7);
  }

  /* ---- ruler ---- */
  g.fillStyle = '#111823'; g.fillRect(0, 0, W, ruler);
  g.fillStyle = '#263043'; g.fillRect(0, ruler - 1, W, 1);
  g.font = '10px var(--mono),monospace'; g.textBaseline = 'middle'; g.textAlign = 'center';
  for (let v = Math.ceil(a0 / step) * step; v <= a1; v += step) {
    const x = gut + (v - a0) / (a1 - a0) * plotW;
    if (x < gut + 4) continue;
    g.fillStyle = '#31405a'; g.fillRect(Math.round(x), ruler - 6, 1, 5);
    g.fillStyle = '#93a3bb'; g.fillText(fmtNum(v, 0), x, ruler / 2 - 1);
  }
  g.textAlign = 'left'; g.fillStyle = '#5f7085'; g.font = '9.5px var(--ui),sans-serif';
  g.fillText(axUnitName(), 6, ruler / 2 - 1);

  /* ---- hover crosshair ---- */
  if (MOUSE.in === 'pipe' && MOUSE.x > gut) {
    g.strokeStyle = '#4da3ff66'; g.lineWidth = 1; g.setLineDash([2, 3]);
    g.beginPath(); g.moveTo(MOUSE.x + .5, ruler); g.lineTo(MOUSE.x + .5, H); g.stroke();
    g.setLineDash([]);
    const tv = t0 + (MOUSE.x - gut) / plotW * tw;
    const txt = axLabel(tv);
    g.font = '10px var(--mono),monospace';
    const w = g.measureText(txt).width + 10;
    g.fillStyle = '#4da3ff'; g.fillRect(clamp(MOUSE.x - w / 2, gut, W - w), 1, w, ruler - 4);
    g.fillStyle = '#04121f'; g.textAlign = 'center';
    g.fillText(txt, clamp(MOUSE.x, gut + w / 2, W - w / 2), ruler / 2 - 1);
  }

  /* ---- box select ---- */
  if (MOUSE.box) {
    const x1 = Math.min(MOUSE.box.x0, MOUSE.x), x2 = Math.max(MOUSE.box.x0, MOUSE.x);
    g.fillStyle = '#4da3ff22'; g.fillRect(x1, ruler, x2 - x1, H - ruler);
    g.strokeStyle = '#4da3ff'; g.lineWidth = 1; g.strokeRect(x1 + .5, ruler + .5, x2 - x1, H - ruler - 1);
  }

  PIPE.lastFrameMs = performance.now() - t0p;
}

function emptyMsg(g, W, H, msg) {
  g.fillStyle = '#5f7085'; g.font = '13px var(--ui),sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(msg, W / 2, H / 2);
}

/* ============================================================================
 *  ADDRESS / TIME  scatter
 * ==========================================================================*/
const ADDR = {
  gut: 96, ruler: 22, ranks: null, rankKey: '',
  hitX: new Float32Array(0), hitY: null, hitI: null, hitN: 0,
};
function buildRanks() {
  const key = S.dirty + '|' + S.n;
  if (ADDR.rankKey === key && ADDR.ranks) return ADDR.ranks;
  const set = new Set();
  for (let i = 0; i < S.n; i++) { const a = S.addl.a[i]; if (a >= 0) set.add(a); }
  const arr = Array.from(set).sort((x, y) => x - y);
  const m = new Map();
  arr.forEach((v, i) => m.set(v, i));
  ADDR.ranks = { list: arr, map: m }; ADDR.rankKey = key;
  return ADDR.ranks;
}
function drawAddr() {
  const cv = $('#cvAddr'), { g, W, H } = cvSetup(cv);
  const gut = ADDR.gut, ruler = ADDR.ruler;
  const plotW = W - gut, plotH = H - ruler;
  g.fillStyle = '#0d1117'; g.fillRect(0, 0, W, H);
  if (!S.n) { emptyMsg(g, W, H, '暂无数据'); return; }
  computeLanes();

  const mode = $('#selAddrMode').value;
  const R = buildRanks();
  const yMaxAll = mode === 'rank' ? Math.max(1, R.list.length - 1) : Math.max(1, S.addrMax);
  const yMinAll = mode === 'rank' ? 0 : S.addrMin;
  if (!VP.yInit) { VP.y0 = yMinAll; VP.y1 = yMaxAll; VP.yInit = true; }
  VP.y0 = clamp(VP.y0, yMinAll - (yMaxAll - yMinAll), yMaxAll);
  if (VP.y1 <= VP.y0) VP.y1 = VP.y0 + 1;

  const t0 = VP.t0, t1 = VP.t1, tw = Math.max(t1 - t0, 1e-9);
  const yw = VP.y1 - VP.y0;
  const X = t => gut + (t - t0) / tw * plotW;
  const yOf = ad => mode === 'rank' ? (R.map.get(ad) ?? -1) : ad;
  const Y = v => ruler + plotH - (v - VP.y0) / yw * plotH;

  /* grid */
  const a0 = axVal(t0), a1 = axVal(t1);
  const step = niceStep(a1 - a0, Math.max(4, Math.floor(plotW / 110)));
  g.strokeStyle = '#1a2231'; g.lineWidth = 1; g.beginPath();
  for (let v = Math.ceil(a0 / step) * step; v <= a1; v += step) {
    const x = Math.round(gut + (v - a0) / (a1 - a0) * plotW) + .5;
    g.moveTo(x, ruler); g.lineTo(x, H);
  }
  const ystep = niceStep(yw, Math.max(3, Math.floor(plotH / 46)));
  for (let v = Math.ceil(VP.y0 / ystep) * ystep; v <= VP.y1; v += ystep) {
    const y = Math.round(Y(v)) + .5;
    g.moveTo(gut, y); g.lineTo(W, y);
  }
  g.stroke();

  const { a, s, e } = FILT.range(t0, t1);
  const cnt = e - s;
  if (ADDR.hitX.length < cnt) {
    ADDR.hitX = new Float32Array(cnt + 1024); ADDR.hitY = new Float32Array(cnt + 1024); ADDR.hitI = new Int32Array(cnt + 1024);
  }
  ADDR.hitN = 0;
  const colorMode = $('#selColor').value;
  const selLine = SEL.line;

  /* prefetch → later demand-use connector */
  if ($('#ckPFLine').checked && cnt < 40000) {
    g.strokeStyle = '#f472b6'; g.globalAlpha = .5; g.lineWidth = 1; g.setLineDash([4, 3]);
    let d = 0;
    for (let k = s; k < e && d < 2500; k++) {
      const i = a[k];
      if (!(S.flag.a[i] & F_PFREQ)) continue;
      let j = S.nextLine.a[i], guard = 0;
      while (j >= 0 && guard++ < 24 && !(S.flag.a[j] & F_DEMAND)) j = S.nextLine.a[j];
      if (j < 0) continue;
      const yv = yOf(S.addl.a[i]); if (yv < 0) continue;
      g.beginPath(); g.moveTo(X(S.time.a[i]), Y(yv)); g.lineTo(X(S.time.a[j]), Y(yv)); g.stroke();
      d++;
    }
    g.setLineDash([]); g.globalAlpha = 1;
  }

  /* same-PC stride connectors */
  if ($('#ckStride').checked && cnt < 26000) {
    const byPC = new Map();
    for (let k = s; k < e; k++) {
      const i = a[k];
      if (!(S.flag.a[i] & F_DEMAND)) continue;
      const p = S.pc.a[i]; if (p < 0) continue;
      let l = byPC.get(p); if (!l) byPC.set(p, l = []);
      if (l.length < 4000) l.push(i);
    }
    g.lineWidth = 1; g.globalAlpha = .45;
    for (const [p, l] of byPC) {
      if (l.length < 2) continue;
      g.strokeStyle = hashColor('pc' + p);
      g.beginPath();
      for (let q = 0; q < l.length; q++) {
        const yv = yOf(S.addl.a[l[q]]); if (yv < 0) continue;
        const x = X(S.time.a[l[q]]), y = Y(yv);
        if (q === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  /* points */
  const ps = clamp(+$('#inSize').value * .8, 2, 7);
  for (let k = s; k < e; k++) {
    const i = a[k], ad = S.addl.a[i];
    if (ad < 0) continue;
    const yv = yOf(ad); if (yv < 0) continue;
    const x = X(S.time.a[i]), y = Y(yv);
    if (y < ruler - 4 || y > H + 4) continue;
    const isSel = selLine >= 0 && ad === selLine;
    g.globalAlpha = selLine >= 0 && !isSel ? .16 : .92;
    let c;
    if (colorMode === 'pc') c = S.pc.a[i] >= 0 ? hashColor('pc' + S.pc.a[i]) : '#5f7085';
    else if (colorMode === 'src') c = (S.flag.a[i] & F_PFREQ) ? '#f472b6' : (S.flag.a[i] & F_DEMAND) ? '#38bdf8' : (S.flag.a[i] & F_BUS) ? '#f87171' : '#5f7085';
    else c = S.tags[S.tag.a[i]].meta.c;
    g.fillStyle = c;
    if (S.flag.a[i] & F_PFREQ) {
      g.beginPath(); g.moveTo(x, y - ps); g.lineTo(x + ps, y + ps * .8); g.lineTo(x - ps, y + ps * .8); g.closePath(); g.fill();
    } else {
      g.fillRect(x - ps / 2, y - ps / 2, ps, ps);
    }
    if (isSel) { g.globalAlpha = 1; g.strokeStyle = '#ffd479'; g.lineWidth = 1.3; g.strokeRect(x - ps / 2 - 2, y - ps / 2 - 2, ps + 4, ps + 4); }
    if (i === SEL.ev) { g.globalAlpha = 1; g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.strokeRect(x - ps / 2 - 3.5, y - ps / 2 - 3.5, ps + 7, ps + 7); }
    if (ADDR.hitN < ADDR.hitX.length) { ADDR.hitX[ADDR.hitN] = x; ADDR.hitY[ADDR.hitN] = y; ADDR.hitI[ADDR.hitN] = i; ADDR.hitN++; }
  }
  g.globalAlpha = 1;

  /* Y axis */
  g.fillStyle = '#111823'; g.fillRect(0, 0, gut, H);
  g.fillStyle = '#263043'; g.fillRect(gut - 1, 0, 1, H);
  g.font = '9.5px var(--mono),monospace'; g.textBaseline = 'middle'; g.textAlign = 'right';
  for (let v = Math.ceil(VP.y0 / ystep) * ystep; v <= VP.y1; v += ystep) {
    const y = Y(v);
    if (y < ruler + 4 || y > H - 2) continue;
    g.fillStyle = '#31405a'; g.fillRect(gut - 5, Math.round(y), 4, 1);
    g.fillStyle = '#93a3bb';
    let lbl;
    if (mode === 'rank') {
      const ad = R.list[clamp(Math.round(v), 0, R.list.length - 1)];
      lbl = ad === undefined ? '' : ad.toString(16).padStart(10, '0').replace(/^0+(?=.{6})/, '');
    } else lbl = Math.round(v).toString(16).padStart(10, '0').replace(/^0+(?=.{6})/, '');
    g.fillText(lbl, gut - 8, y);
  }
  g.textAlign = 'left'; g.fillStyle = '#5f7085'; g.font = '9.5px var(--ui),sans-serif';
  g.fillText(mode === 'rank' ? 'cacheline (排名)' : 'cacheline 地址', 5, ruler / 2 - 1);

  /* X ruler */
  g.fillStyle = '#111823'; g.fillRect(gut, 0, W - gut, ruler);
  g.fillStyle = '#263043'; g.fillRect(0, ruler - 1, W, 1);
  g.font = '10px var(--mono),monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let v = Math.ceil(a0 / step) * step; v <= a1; v += step) {
    const x = gut + (v - a0) / (a1 - a0) * plotW;
    if (x < gut + 4) continue;
    g.fillStyle = '#31405a'; g.fillRect(Math.round(x), ruler - 6, 1, 5);
    g.fillStyle = '#93a3bb'; g.fillText(fmtNum(v, 0), x, ruler / 2 - 1);
  }

  if (MOUSE.in === 'addr' && MOUSE.x > gut) {
    g.strokeStyle = '#4da3ff55'; g.setLineDash([2, 3]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(MOUSE.x + .5, ruler); g.lineTo(MOUSE.x + .5, H);
    g.moveTo(gut, MOUSE.y + .5); g.lineTo(W, MOUSE.y + .5); g.stroke(); g.setLineDash([]);
  }
}

/* ---------------------------- hit testing ------------------------------- */
function hitTest(store, x, y, r) {
  let best = -1, bd = r * r;
  for (let k = 0; k < store.hitN; k++) {
    const dx = store.hitX[k] - x, dy = store.hitY[k] - y;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = store.hitI[k]; }
  }
  return best;
}

/* ---------------------------- render loop ------------------------------- */
const MOUSE = { in: null, x: 0, y: 0, box: null };
let rafPending = false;
function requestDraw() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; drawAll(); });
}
function drawAll() {
  const pane = $('.tab.on')?.dataset.pane;
  if (pane === 'pipe') { drawPipe(); drawOverview(); }
  else if (pane === 'addr') drawAddr();
  updateStatus();
}
