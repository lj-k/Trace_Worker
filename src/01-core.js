/* ============================================================================
 *  Memory Trace Pipeline Viewer — core
 *  columnar store · incremental parser · live tail sources
 * ==========================================================================*/
'use strict';

/* ------------------------------- helpers -------------------------------- */
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const fmtInt = n => (n | 0).toLocaleString('en-US');

function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(2) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}
function fmtNum(n, d) {
  if (!isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(d ?? 2) + 'G';
  if (a >= 1e6) return (n / 1e6).toFixed(d ?? 2) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(d ?? 1) + 'k';
  return (Math.round(n * 100) / 100).toString();
}
/** 40-bit address -> 0x-prefixed 10 hex digits */
function hexAddr(v) {
  if (v == null || v < 0 || !isFinite(v)) return '—';
  return '0x' + v.toString(16).padStart(10, '0');
}
function hexPC(v) {
  if (v == null || v < 0 || !isFinite(v)) return '—';
  return '0x' + v.toString(16).padStart(4, '0');
}
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a; }
function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
/** stable-ish colour from a string */
function hashColor(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `hsl(${(h >>> 0) % 360},68%,62%)`;
}

/* --------------------------- version & changelog --------------------------- */
const APP_VERSION = '1.1.2';
const APP_CHANGELOG = [
  {
    v: '1.1.2', date: '2025-08-07',
    items: [
      '修复「打开并实时跟进」在 file://（双击打开本页）下仍需手动反复重开文件才能看到更新的问题：新增「半自动跟随」——首次全量载入后，每 4 秒自动重新弹出文件选择框，用户回车重选同一文件即增量追加新行（仅喂入新增字节，已处理仿真重启导致文件变短的情况）。',
      '新增跟随横幅：实时展示 file:// 半自动 / localhost 自动两种模式，含「立即检查 / 暂停跟随 / 停止」按钮，并提示用 serve.py 获得完全免手动的实时跟进。',
      '「载入文件」「拖拽」操作现在会主动停止正在进行的跟随会话。',
    ],
  },
  {
    v: '1.1.1', date: '2025-08-05',
    items: [
      '修复「打开并实时跟进」在 file:// 与不安全上下文下点击无反应的问题：FSA 被屏蔽/挂起时改为原生文件选择框载入离线快照，并提示用 serve.py 启用实时跟进（file:// 下 File 对象在文件被追加后会变不可读，故无法做真·实时，需走 HTTP Range 模式）。',
    ],
  },
  {
    v: '1.1.0', date: '2025-08-05',
    items: [
      '字段语义校准：确认 TYPE 为 one-hot（位 [],[1],[4],[6],[7],[11],[12]）；WRIT=1 与 TYPE 位 6/7 完全对应（已校准）；SRC=01 的 PC 恒为 0000 → 预取路径（已校准）；RESP 位域 valid/hit/done 译码获分布支持（已校准）。',
      '新增版本号与变更记录机制：顶部徽标、状态栏、关于弹窗均展示版本与更新日志。',
      '新增开发文档 / 使用说明文档 / 特性文档 / 变更记录文档 四份文档。',
      '深色主题视觉重构：统一设计变量、优化间距与排版、重做按钮/卡片/模态/图表样式。',
      '总线标签补充 ARID / AWID / UNIQ 字段语义。',
    ],
  },
  {
    v: '1.0.0', date: '2025-08-04',
    items: [
      '初版：列式 TypedArray 存储 + 增量解析 + 三种数据源（静态 / FileSystemAccess / HTTP Range 实时跟进）。',
      '五个视图：流水线泳道、地址-时间散点、事务生命周期、事件表、分析。',
      '字段语义可编辑配置（JSON，本地保存）。',
      '留零写回的只读服务 serve.py（支持 Range / HEAD）。',
    ],
  },
];

/* ------------------------- growable typed array ------------------------- */
class Col {
  constructor(Type, cap = 4096) { this.T = Type; this.a = new Type(cap); this.n = 0; }
  push(v) {
    if (this.n === this.a.length) { const b = new this.T(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = v;
  }
  get(i) { return this.a[i]; }
  set(i, v) { this.a[i] = v; }
  /** keep [from, n) and shift to 0 */
  shiftFrom(from) {
    if (from <= 0) return;
    this.a.copyWithin(0, from, this.n);
    this.n -= from;
  }
}

/* --------------------------- tag presentation --------------------------- */
/** ordering follows the physical dataflow:  core → L2 → prefetcher → bus → core writeback */
const TAG_META = {
  LSU_LD_PIPE3:  { g: 'CORE', l: 'LD 发起 (PIPE3)',  c: '#38bdf8', o: 10, d: 'Load 指令在 LSU 流水 PIPE3/DA 级发起访存，携带 SRC0/SRC1/OFF 地址计算源' },
  LSU_ST_PIPE4:  { g: 'CORE', l: 'ST 发起 (PIPE4)',  c: '#fb923c', o: 20, d: 'Store 指令在 LSU 流水 PIPE4 级发起访存，携带指令编码 CODE' },
  L2C_CMP:       { g: 'L2',   l: 'L2C CMP 流水',     c: '#a78bfa', o: 30, d: 'L2 cache 的 compare / 仲裁流水级，SID 为 SAB 表项号，RESP 为响应' },
  L2_TriPF:      { g: 'PF',   l: 'L2 → TriPF 训练',  c: '#fbbf24', o: 40, d: 'L2 把访存事件送给 Triverse 预取器做训练 / 触发' },
  TriPF_L2:      { g: 'PF',   l: 'TriPF → L2 预取',  c: '#f472b6', o: 50, d: 'Triverse 预取器向 L2 发出预取请求，READY=0 表示被反压' },
  BIU_PAD_AR:    { g: 'BUS',  l: 'AXI AR (读)',      c: '#60a5fa', o: 60, d: 'BIU 向片外发出 AXI 读地址通道请求 —— L2 miss 的外部访存' },
  BIU_PAD_AW:    { g: 'BUS',  l: 'AXI AW (写)',      c: '#f87171', o: 70, d: 'BIU 向片外发出 AXI 写地址通道请求 —— 写回 / 写直达' },
  LSU_LD_DA_fwd: { g: 'CORE', l: 'LD 数据前递',      c: '#2dd4bf', o: 80, d: 'Load 数据在 DA 级前递给消费者' },
  LSU_LD_WB_pg:  { g: 'CORE', l: 'LD 写回 PREG',     c: '#4ade80', o: 90, d: 'Load 数据写回物理寄存器；FROM=DA 直通 / RB 来自 Refill Buffer' },
};
const GROUP_ORDER = { CORE: 0, L2: 1, PF: 2, BUS: 3, OTHER: 4 };
const AUTO_COLORS = ['#e879f9', '#22d3ee', '#a3e635', '#fdba74', '#c4b5fd', '#5eead4', '#fca5a5', '#93c5fd'];

function tagMeta(name, idx) {
  return TAG_META[name] || (TAG_META[name] = {
    g: 'OTHER', l: name, c: AUTO_COLORS[idx % AUTO_COLORS.length], o: 1000 + idx, d: '自动识别的事件类型',
  });
}

/* -------- events that represent a *demand* (core-initiated) access ------- */
const DEMAND_TAGS = new Set(['LSU_LD_PIPE3', 'LSU_ST_PIPE4']);
const PF_REQ_TAG = 'TriPF_L2';
const PF_TRAIN_TAG = 'L2_TriPF';
const BUS_TAGS = new Set(['BIU_PAD_AR', 'BIU_PAD_AW']);

/* flag bits */
const F_DEMAND = 1, F_PFREQ = 2, F_BUS = 4, F_PFTRAIN = 8, F_L2 = 16;

/* ============================================================================
 *  STORE
 * ==========================================================================*/
const S = {
  n: 0,
  time: new Col(Float64Array),
  tag: new Col(Uint8Array),
  addl: new Col(Float64Array),
  pc: new Col(Int32Array),
  iid: new Col(Int16Array),
  row: new Col(Int32Array),
  flag: new Col(Uint8Array),
  nextLine: new Col(Int32Array),   // next event with same cacheline
  prevLine: new Col(Int32Array),
  nextIID: new Col(Int32Array),    // next LSU event with same IID (short window)

  tags: [],                        // [{name, meta, fields:[], cols:[Col], n, count}]
  tagIdx: new Map(),
  strs: [''], strMap: new Map([['', 0]]),

  lastByLine: new Map(),           // addl -> last event index
  lastByIID: new Map(),            // iid  -> last event index
  base: 0,                         // number of events dropped from the head (index offset)

  t0: Infinity, t1: -Infinity,
  periodAuto: 0, deltaHist: new Map(), lastT: -1,
  addrMin: Infinity, addrMax: -Infinity,
  parseMs: 0, bytes: 0, badLines: 0,
  dirty: 0,                        // bumped on every append

  intern(s) {
    let id = this.strMap.get(s);
    if (id === undefined) { id = this.strs.length; this.strs.push(s); this.strMap.set(s, id); }
    return id;
  },
  tagOf(name) {
    let t = this.tagIdx.get(name);
    if (t === undefined) {
      t = this.tags.length;
      this.tags.push({ name, meta: tagMeta(name, t), fields: [], fidx: new Map(), cols: [], count: 0, on: true });
      this.tagIdx.set(name, t);
    }
    return t;
  },
  reset() {
    const keep = ['tags', 'tagIdx', 'strs', 'strMap'];
    this.n = 0;
    for (const k of ['time', 'tag', 'addl', 'pc', 'iid', 'row', 'flag', 'nextLine', 'prevLine', 'nextIID']) this[k].n = 0;
    this.tags = []; this.tagIdx = new Map();
    this.strs = ['']; this.strMap = new Map([['', 0]]);
    this.lastByLine.clear(); this.lastByIID.clear();
    this.base = 0;
    this.t0 = Infinity; this.t1 = -Infinity;
    this.periodAuto = 0; this.deltaHist = new Map(); this.lastT = -1;
    this.addrMin = Infinity; this.addrMax = -Infinity;
    this.parseMs = 0; this.bytes = 0; this.badLines = 0;
    this.dirty++;
    void keep;
  },
  /** field value (string) of event i for field name f, or null */
  field(i, f) {
    const T = this.tags[this.tag.a[i]];
    const fi = T.fidx.get(f);
    if (fi === undefined) return null;
    const id = T.cols[fi].a[this.row.a[i]];
    return id ? this.strs[id] : null;
  },
  /** all fields of event i as [name, value] pairs */
  fieldsOf(i) {
    const T = this.tags[this.tag.a[i]], r = this.row.a[i], out = [];
    for (let k = 0; k < T.fields.length; k++) {
      const id = T.cols[k].a[r];
      if (id) out.push([T.fields[k], this.strs[id]]);
    }
    return out;
  },
  tagName(i) { return this.tags[this.tag.a[i]].name; },
  /** first event index with time >= t (binary search; trace is time-ordered) */
  lowerBound(t) {
    let lo = 0, hi = this.n;
    const a = this.time.a;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < t) lo = m + 1; else hi = m; }
    return lo;
  },
  upperBound(t) {
    let lo = 0, hi = this.n;
    const a = this.time.a;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= t) lo = m + 1; else hi = m; }
    return lo;
  },
  get period() {
    const ov = +($('#inPeriod')?.value || 0);
    return ov > 0 ? ov : (this.periodAuto || 1);
  },
  cyc(t) { return t / this.period; },
};

/* ============================================================================
 *  PARSER  —  "  <time>;<TAG>;K:V;K:V;…"
 * ==========================================================================*/
function parseChunk(text) {
  const t0 = performance.now();
  let p = 0;
  const L = text.length;
  const S_ = S;

  while (p < L) {
    let nl = text.indexOf('\n', p);
    if (nl < 0) nl = L;
    let e = nl;
    if (e > p && text.charCodeAt(e - 1) === 13) e--;      // \r
    if (e > p) parseLine(text, p, e);
    p = nl + 1;
  }
  S_.parseMs += performance.now() - t0;
  S_.dirty++;
}

function parseLine(s, a, b) {
  // skip leading spaces
  while (a < b && s.charCodeAt(a) === 32) a++;
  if (a >= b) return;
  const c0 = s.charCodeAt(a);
  if (c0 === 35 || c0 === 47) return;                      // '#' or '//' comment

  let i = s.indexOf(';', a);
  if (i < 0 || i > b) { S.badLines++; return; }
  const time = +s.slice(a, i);
  if (!isFinite(time)) { S.badLines++; return; }

  let j = s.indexOf(';', i + 1);
  if (j < 0 || j > b) j = b;
  const tagName = s.slice(i + 1, j).trim();
  if (!tagName) { S.badLines++; return; }

  const t = S.tagOf(tagName);
  const T = S.tags[t];
  const idx = S.n;
  const r = T.count;

  // ---- key:value pairs -------------------------------------------------
  let addl = -1, pc = -1, iid = -1;
  let k = j + 1;
  while (k < b) {
    let sc = s.indexOf(';', k);
    if (sc < 0 || sc > b) sc = b;
    if (sc > k) {
      const cl = s.indexOf(':', k);
      if (cl > 0 && cl < sc) {
        const key = s.slice(k, cl).trim();
        const val = s.slice(cl + 1, sc).trim();
        if (key) {
          let fi = T.fidx.get(key);
          if (fi === undefined) {
            fi = T.fields.length;
            T.fields.push(key); T.fidx.set(key, fi);
            const col = new Col(Int32Array, Math.max(4096, T.count + 1));
            col.n = T.count;                                // back-fill previous rows with 0
            T.cols.push(col);
          }
          const col = T.cols[fi];
          while (col.n < r) col.push(0);
          col.push(S.intern(val));
          if (key === 'ADDL') addl = parseInt(val, 16);
          else if (key === 'PC') pc = parseInt(val, 16);
          else if (key === 'IID') iid = parseInt(val, 16);
        }
      }
    }
    k = sc + 1;
  }
  for (const col of T.cols) while (col.n <= r) col.push(0);  // pad missing fields
  T.count++;

  if (!isFinite(addl)) addl = -1;
  if (!isFinite(pc)) pc = -1;
  if (!isFinite(iid)) iid = -1;

  // ---- flags ------------------------------------------------------------
  let fl = 0;
  if (DEMAND_TAGS.has(tagName)) fl |= F_DEMAND;
  if (tagName === PF_REQ_TAG) fl |= F_PFREQ;
  if (tagName === PF_TRAIN_TAG) fl |= F_PFTRAIN;
  if (BUS_TAGS.has(tagName)) fl |= F_BUS;
  if (tagName === 'L2C_CMP') fl |= F_L2;

  // ---- columns ----------------------------------------------------------
  S.time.push(time); S.tag.push(t); S.addl.push(addl);
  S.pc.push(pc); S.iid.push(iid); S.row.push(r); S.flag.push(fl);
  S.nextLine.push(-1); S.prevLine.push(-1); S.nextIID.push(-1);

  // ---- cross links ------------------------------------------------------
  if (addl >= 0) {
    const prev = S.lastByLine.get(addl);
    if (prev !== undefined && prev >= S.base) {
      const pi = prev - S.base;
      S.nextLine.a[pi] = idx; S.prevLine.a[idx] = pi;
    }
    S.lastByLine.set(addl, idx + S.base);
    if (addl < S.addrMin) S.addrMin = addl;
    if (addl > S.addrMax) S.addrMax = addl;
  }
  if (iid >= 0 && tagName.startsWith('LSU_')) {
    const prev = S.lastByIID.get(iid);
    if (prev !== undefined && prev >= S.base) {
      const pi = prev - S.base;
      // only chain if within a plausible in-flight window (IIDs are recycled)
      if (time - S.time.a[pi] < (S.periodAuto || 1e5) * 400) S.nextIID.a[pi] = idx;
    }
    S.lastByIID.set(iid, idx + S.base);
  }

  // ---- time bookkeeping -------------------------------------------------
  if (time < S.t0) S.t0 = time;
  if (time > S.t1) S.t1 = time;
  if (S.lastT >= 0) {
    const d = time - S.lastT;
    if (d > 0 && S.deltaHist.size < 4096) S.deltaHist.set(d, (S.deltaHist.get(d) || 0) + 1);
  }
  S.lastT = time;

  S.n++;
}

/** auto-detect clock period = most frequent positive timestamp delta */
function detectPeriod() {
  let best = 0, bestC = -1;
  for (const [d, c] of S.deltaHist) if (c > bestC || (c === bestC && d < best)) { best = d; bestC = c; }
  if (!best) return;
  // refine: if a smaller delta divides `best` and is reasonably frequent, prefer it
  let g = best;
  for (const [d, c] of S.deltaHist) if (c > bestC * 0.25) g = gcd(g, d);
  S.periodAuto = g > 0 ? g : best;
}

/** drop oldest events to respect the retention cap, then rebuild links */
function trimStore(cap) {
  if (!cap || S.n <= cap) return;
  const drop = S.n - Math.floor(cap * 0.75);
  for (const k of ['time', 'tag', 'addl', 'pc', 'iid', 'row', 'flag', 'nextLine', 'prevLine', 'nextIID']) S[k].shiftFrom(drop);
  S.n -= drop;
  S.base += drop;
  // per-tag columns: count how many rows of each tag were dropped
  const dropped = new Int32Array(S.tags.length);
  // rows are monotonically increasing per tag, so the first surviving row tells us
  const firstRow = new Int32Array(S.tags.length).fill(-1);
  for (let i = 0; i < S.n; i++) { const t = S.tag.a[i]; if (firstRow[t] < 0) firstRow[t] = S.row.a[i]; }
  for (let t = 0; t < S.tags.length; t++) {
    const T = S.tags[t], fr = firstRow[t] < 0 ? T.count : firstRow[t];
    dropped[t] = fr;
    if (fr > 0) { for (const c of T.cols) c.shiftFrom(fr); T.count -= fr; }
  }
  for (let i = 0; i < S.n; i++) S.row.a[i] -= dropped[S.tag.a[i]];
  // rebuild intra-window links
  S.nextLine.a.fill(-1, 0, S.n); S.prevLine.a.fill(-1, 0, S.n); S.nextIID.a.fill(-1, 0, S.n);
  const lastL = new Map(), lastI = new Map();
  for (let i = 0; i < S.n; i++) {
    const ad = S.addl.a[i];
    if (ad >= 0) {
      const p = lastL.get(ad);
      if (p !== undefined) { S.nextLine.a[p] = i; S.prevLine.a[i] = p; }
      lastL.set(ad, i);
    }
    const ii = S.iid.a[i];
    if (ii >= 0 && S.tags[S.tag.a[i]].name.startsWith('LSU_')) {
      const p = lastI.get(ii);
      if (p !== undefined && S.time.a[i] - S.time.a[p] < (S.periodAuto || 1e5) * 400) S.nextIID.a[p] = i;
      lastI.set(ii, i);
    }
  }
  S.lastByLine.clear(); for (const [a, i] of lastL) S.lastByLine.set(a, i + S.base);
  S.lastByIID.clear(); for (const [a, i] of lastI) S.lastByIID.set(a, i + S.base);
}

/* ============================================================================
 *  DATA SOURCES  —  static file / FileSystemAccess handle / HTTP range
 * ==========================================================================*/
const Src = {
  kind: null, name: '', handle: null, url: '',
  offset: 0, pending: '', size: 0,
  timer: null, live: false, paused: false, busy: false,
  err: null, lastGrow: 0,

  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } this.live = false; },

  clear() {
    this.stop();
    this.kind = null; this.name = ''; this.handle = null; this.url = '';
    this.offset = 0; this.pending = ''; this.size = 0; this.paused = false; this.err = null;
  },

  /** feed raw text; keeps a partial trailing line in `pending` */
  feed(text) {
    const s = this.pending + text;
    const cut = s.lastIndexOf('\n');
    if (cut < 0) { this.pending = s; return 0; }
    this.pending = s.slice(cut + 1);
    const body = s.slice(0, cut + 1);
    const before = S.n;
    parseChunk(body);
    S.bytes = this.offset;
    return S.n - before;
  },

  /* -------------------- static (one-shot) file load -------------------- */
  async loadFile(file, onProg) {
    this.clear();
    S.reset();
    this.kind = 'static'; this.name = file.name; this.size = file.size;
    const CH = 1 << 23;                              // 8 MB slices
    const dec = new TextDecoder('utf-8');
    for (let o = 0; o < file.size; o += CH) {
      const buf = await file.slice(o, Math.min(o + CH, file.size)).arrayBuffer();
      this.offset = o + buf.byteLength;
      this.feed(dec.decode(buf, { stream: true }));
      if (onProg) { onProg(this.offset, file.size); await new Promise(r => setTimeout(r)); }
    }
    if (this.pending.trim()) { parseChunk(this.pending + '\n'); this.pending = ''; }
    S.bytes = file.size;
    detectPeriod();
  },

  /* incremental (file:// follow): append only the bytes written since the last load.
   * A File obtained from <input type=file> becomes NotReadableError once the underlying
   * file grows, so the UI must re-open the picker to obtain a FRESH File object; this
   * method then feeds just the appended bytes (and does a full reload if the file shrank).
   * This is the only viable "follow" path when the page runs from file://, where the
   * FileSystemAccess API hangs and fetch() is CORS-blocked. */
  async loadFileIncremental(file, onProg) {
    if (file.size < this.offset) {                  // simulation restarted → full reload
      await this.loadFile(file, onProg);
      return;
    }
    this.kind = 'static'; this.name = file.name; this.size = file.size;
    if (file.size <= this.offset) return 0;         // nothing new yet
    const CH = 1 << 23;                             // 8 MB slices
    const dec = new TextDecoder('utf-8');
    let added = 0;
    for (let o = this.offset; o < file.size; o += CH) {
      const buf = await file.slice(o, Math.min(o + CH, file.size)).arrayBuffer();
      this.offset = o + buf.byteLength;
      added += this.feed(dec.decode(buf, { stream: true }));
      if (onProg) { onProg(this.offset, file.size); await new Promise(r => setTimeout(r)); }
    }
    if (this.pending.trim()) { parseChunk(this.pending + '\n'); this.pending = ''; }
    S.bytes = file.size;
    return added;
  },

  /* ------------- live: FileSystemFileHandle (read-only) ---------------- */
  async openHandle(handle) {
    this.clear(); S.reset();
    this.kind = 'fsa'; this.handle = handle; this.name = handle.name;
    await this.pollFSA(true);
    detectPeriod();
    this.startTimer();
  },
  async pollFSA(initial) {
    const f = await this.handle.getFile();
    this.size = f.size;
    if (f.size < this.offset) {                       // file truncated / simulation restarted
      S.reset(); this.offset = 0; this.pending = '';
      Bus.emit('reset');
    }
    if (f.size === this.offset) return 0;
    const dec = new TextDecoder('utf-8');
    let added = 0;
    const CH = 1 << 23;
    while (this.offset < f.size) {
      const end = Math.min(this.offset + CH, f.size);
      const buf = await f.slice(this.offset, end).arrayBuffer();
      this.offset = end;
      added += this.feed(dec.decode(buf, { stream: true }));
      if (initial && f.size > CH) await new Promise(r => setTimeout(r));
    }
    return added;
  },

  /* --------------------- live: HTTP range polling ---------------------- */
  async openUrl(url, live) {
    this.clear(); S.reset();
    this.kind = 'http'; this.url = url;
    this.name = url.split('/').pop() || url;
    await this.pollHTTP();
    detectPeriod();
    if (live) this.startTimer();
  },
  /** cheap size probe that doesn't trigger a console-error on "nothing new" */
  async probeSize() {
    try {
      const r = await fetch(this.url, { method: 'HEAD', cache: 'no-store' });
      if (!r.ok) return -1;
      const n = +r.headers.get('Content-Length');
      return isFinite(n) ? n : -1;
    } catch (e) { return -1; }
  },
  async pollHTTP() {
    const total = await this.probeSize();
    if (total >= 0) {
      if (total < this.offset) {              // file truncated / simulation restarted
        S.reset(); this.offset = 0; this.pending = '';
        Bus.emit('reset');
      }
      this.size = total;
      if (this.offset >= total) return 0;     // caught up → issue no request at all
    }
    let res;
    try {
      res = await fetch(this.url, {
        headers: this.offset ? { Range: `bytes=${this.offset}-` } : {},
        cache: 'no-store',
      });
    } catch (e) { throw e; }
    if (res.status === 416) return 0;                       // nothing new — quiet retry next tick
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
    const cr = res.headers.get('Content-Range');
    if (cr) {
      const total2 = +cr.split('/')[1];
      if (isFinite(total2)) {
        if (this.size && Math.abs(total2 - this.size) > 4096) {
          S.reset(); this.offset = 0; this.pending = '';
          Bus.emit('reset');
        }
        this.size = total2;
      }
    }
    const txt = await res.text();
    if (res.status === 200 && this.offset > 0) {
      if (txt.length <= this.offset) return 0;
      S.reset(); this.offset = 0; this.pending = '';
      Bus.emit('reset');
    }
    if (!txt) return 0;
    this.offset += new Blob([txt]).size;
    if (!cr) this.size = this.offset;
    return this.feed(txt);
  },

  startTimer() {
    this.stop();
    this.live = true;
    const iv = +($('#selPoll').value || 500);
    this.timer = setInterval(() => this.tick(), iv);
  },
  async tick() {
    if (this.paused || this.busy) return;
    this.busy = true;
    try {
      const before = S.n;
      const n = this.kind === 'fsa' ? await this.pollFSA(false)
        : this.kind === 'http' ? await this.pollHTTP() : 0;
      this.err = null;
      if (n > 0) {
        if (!S.periodAuto) detectPeriod();
        this.lastGrow = Date.now();
        trimStore(+($('#selCap').value || 0));
        Bus.emit('append', { n, before });
      }
    } catch (e) {
      this.err = e.message || String(e);
      Bus.emit('srcerr', this.err);
    } finally { this.busy = false; }
  },
};

/* ------------------------------ event bus ------------------------------- */
const Bus = {
  m: new Map(),
  on(k, f) { (this.m.get(k) || this.m.set(k, []).get(k)).push(f); },
  emit(k, a) { const l = this.m.get(k); if (l) for (const f of l) { try { f(a); } catch (e) { console.error(e); } } },
};

/* ============================================================================
 *  FIELD SEMANTICS  (user-editable; defaults inferred & CALIBRATED from trace)
 *
 *  校准方法：用 trace 全量统计交叉验证每一个推断（见 CHANGELOG / 开发文档）。
 *  标记约定：
 *    · 无标记        —— 已被统计强相关确认（如 WRIT 与 TYPE 位 6/7 完全对应）
 *    · (已校准)      —— 由分布/相关性支持，但位名/子类仍待 RTL 最终确认
 *    · (推测)        —— 纯推断，请按实际 RTL 修正
 * ==========================================================================*/
const DEFAULT_SCHEMA = {
  "_comment": "radix: 值的进制 | bits: one-hot 位名(下标=位号) | enum: 值→含义 | desc: 说明。标 (推测) 的请按实际 RTL 修正。",
  "*": {
    "ADDL":  { radix: 16, desc: "cacheline 首地址 (64B 对齐)" },
    "ADDB":  { radix: 16, desc: "访问所在 bank/块地址" },
    "ADDR":  { radix: 16, desc: "总线请求地址 (AXI ARADDR/AWADDR)" },
    "ABYTE": { radix: 16, desc: "字节级精确地址 (ADDL + 块内偏移)" },
    "PC":    { radix: 16, desc: "触发该事件的指令 PC", enum: {
      "fffe": "无 PC / L2 内部发起",
      "7fff": "预取器内部",
      "0000": "无 PC / 复位值 (常见于 SRC=01 的预取路径)" } },
    "IID":   { radix: 16, desc: "指令 ID (循环复用，仅短窗口内唯一)" },
    "PREG":  { radix: 16, desc: "目的物理寄存器号" },
    "DATA":  { radix: 16, desc: "读回 / 写入的数据" },
    "SIZE":  { radix: 10, enum: { "0": "1B", "1": "2B", "2": "4B", "3": "8B", "4": "16B" }, desc: "访问大小 log2(字节)" },
    "FROM":  { radix: 16, desc: "请求来源端口编号 (L2C_CMP 中为 SAB 源端口；总线标签中为 AXI 主端口)" },
    "LENG":  { radix: 10, desc: "AXI burst 长度 (beats-1)" },
    "BURS":  { radix: 10, enum: { "0": "FIXED", "1": "INCR", "2": "WRAP" }, desc: "AXI burst 类型" },
    "LOCK":  { radix: 10, enum: { "0": "普通", "1": "exclusive" } },
    "CACH":  { radix: 16, desc: "AXI ARCACHE/AWCACHE" },
    "PROT":  { radix: 16, desc: "AXI PROT" },
    "DOMA":  { radix: 10, enum: { "0": "Non-shareable", "1": "Inner", "2": "Outer", "3": "System" }, desc: "ACE shareability domain" },
    "BARR":  { radix: 10, desc: "ACE barrier 类型" },
    "SNOP":  { radix: 16, desc: "ACE snoop 类型" },
    "ARID":  { radix: 16, desc: "AXI 读事务 ID (仅 BIU_PAD_AR)" },
    "AWID":  { radix: 16, desc: "AXI 写事务 ID (仅 BIU_PAD_AW)" },
    "UNIQ":  { radix: 16, desc: "AXI 原子/唯一访问提示 (仅 BIU_PAD_AW)" },
    "MMUr":  { radix: 10, enum: { "0": "MMU 未就绪", "1": "MMU 就绪" } }
  },
  "L2C_CMP": {
    "SID":  { radix: 16, desc: "SAB (Snoop/Access Buffer) 表项号" },
    "TYPE": { radix: 16, desc: "请求类型 one-hot（本 trace 实测恒为单 bit：[],[1],[4],[6],[7],[11],[12]）", enum: {
      "0000": "无类型 / IFU 取指流",
      "0002": "特殊请求 (bit1, 仅 10 次)",
      "0010": "读请求 Read (bit4；SRC=00,WRIT=0 已校准)",
      "0040": "写请求 Store/Write (bit6；WRIT=1 已校准)",
      "0080": "写回 WriteBack/Evict (bit7；WRIT=1 已校准)",
      "0800": "内部清理 / Snoop 类 (bit11, 推测)",
      "1000": "取指 / 预取通路 (bit12, 推测)" } },
    "SRC":  { radix: 16, desc: "请求源：00=需求/内部发起, 01=预取(本 trace 中 SRC=01 的 PC 恒为 0000，已校准)", enum: {
      "00": "需求访存 / L2 内部发起",
      "01": "预取 prefetch (无核心 PC)" } },
    "RESP": { radix: 2, desc: "L2 响应位向量（本 trace 取值 00001/10001/10101，bit2=hit、bit4=done 的分布吻合，已校准）", bits: ["valid", "b1", "hit(已校准)", "b3", "done(已校准)"] },
    "CLCP": { radix: 16, desc: "clear copy 控制" },
    "STCP": { radix: 16, desc: "set copy 控制" },
    "FATA": { radix: 10, enum: { "0": "正常", "1": "致命错误" }, desc: "fatal error" },
    "WRAW": { radix: 10, enum: { "0": "—", "1": "raw 写" }, desc: "write raw" },
    "HPCP": { radix: 10, desc: "高优先级 / copy 提示" },
    "MID":  { radix: 16, desc: "master ID (FROM=5 常与 PC=fffe 同现，为 L2 内部发起)" },
    "CP":   { radix: 10, desc: "copy 标志" },
    "STAL": { radix: 10, enum: { "0": "未阻塞", "1": "流水阻塞" }, desc: "stall" },
    "WRIT": { radix: 10, enum: { "0": "读", "1": "写" }, desc: "读写方向（已校准：WRIT=1 ⟺ TYPE∈{0040,0080}）" }
  },
  "TriPF_L2": {
    "REQS": { radix: 16, desc: "预取请求数 / 请求状态" },
    "READY": { radix: 10, enum: { "0": "被 L2 反压", "1": "被接受" }, desc: "L2 是否接受该预取请求" }
  },
  "L2_TriPF": { "REQS": { radix: 16, desc: "送给预取器的请求属性 / 训练类型" } },
  "LSU_LD_PIPE3": {
    "LCHe": { radix: 16, desc: "LSU cache way / entry one-hot" },
    "SRC0": { radix: 16, desc: "地址计算源操作数 0 (基址)" },
    "SRC1": { radix: 16, desc: "地址计算源操作数 1 (变址)" },
    "OFF":  { radix: 16, desc: "立即数偏移" }
  },
  "LSU_ST_PIPE4": {
    "CODE": { radix: 16, desc: "store 指令编码 (RISC-V 32bit)" },
    "SDIQ": { radix: 16, desc: "store data issue queue 表项 one-hot" },
    "LCHe": { radix: 16, desc: "LSU cache way / entry one-hot" },
    "TYPE": { radix: 10, desc: "store 类型 (与 L2C_CMP.TYPE 不同域，此处为十进制 store 子类型)" },
    "MODE": { radix: 10, desc: "特权 / 访问模式" },
    "ATOM": { radix: 10, enum: { "0": "非原子", "1": "原子操作" } }
  },
  "LSU_LD_WB_pg": { "FROM": { radix: 0, enum: { "DA": "DA 级直接前递", "RB": "来自 Refill Buffer (miss 回填, 与 BIU_PAD_AR 强相关)" }, desc: "写回数据来源" } }
};

let SCHEMA = loadSchema();
function loadSchema() {
  try {
    const j = localStorage.getItem('trace.schema');
    if (j) return JSON.parse(j);
  } catch (e) { /* ignore */ }
  return JSON.parse(JSON.stringify(DEFAULT_SCHEMA));
}
function schemaFor(tag, field) {
  const a = (SCHEMA[tag] || {})[field];
  const b = (SCHEMA['*'] || {})[field];
  return a || b || null;
}
/** human-readable decoding of one field value */
function decodeField(tag, field, val) {
  const sc = schemaFor(tag, field);
  if (!sc) return '';
  const out = [];
  if (sc.enum && sc.enum[val] !== undefined) out.push(sc.enum[val]);
  if (sc.bits) {
    const radix = sc.radix || 2;
    const v = parseInt(val, radix === 2 ? 2 : radix);
    if (isFinite(v)) {
      const on = [];
      for (let i = 0; i < sc.bits.length; i++) if (v & (1 << i)) on.push(sc.bits[i]);
      if (on.length) out.push(on.join('+'));
    }
  }
  if (!out.length && sc.radix === 16 && /^[0-9a-fA-F]+$/.test(val) && val.length <= 8) {
    const v = parseInt(val, 16);
    if (isFinite(v) && v > 9) out.push('= ' + v);
  }
  return out.join(' · ');
}
