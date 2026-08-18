/* ============================================================================
 *  UI — interactions, detail panel, tables, transactions, analytics
 * ==========================================================================*/

/* --------------------------- generic modal ------------------------------ */
function openModal(id) { $('#' + id).classList.add('on'); }
function closeModal(id) { $('#' + id).classList.remove('on'); }
$$('[data-close]').forEach(b => b.onclick = () => closeModal(b.dataset.close));
$$('.modal').forEach(m => m.addEventListener('mousedown', e => { if (e.target === m) m.classList.remove('on'); }));

/* ------------------------------ sidebar --------------------------------- */
$$('.grp>h4').forEach(h => h.onclick = () => h.parentNode.classList.toggle('col'));

function renderTagList() {
  const host = $('#tagList');
  computeLanes();
  const all = S.tags.map((T, i) => ({ T, i })).sort((a, b) =>
    (GROUP_ORDER[a.T.meta.g] ?? 9) - (GROUP_ORDER[b.T.meta.g] ?? 9) || a.T.meta.o - b.T.meta.o);
  host.innerHTML = all.map(({ T, i }) => `
    <div class="tagrow ${T.on ? '' : 'off'}" data-t="${i}" title="${esc(T.meta.d)}">
      <span class="sw" style="background:${T.meta.c}"></span>
      <span class="nm">${esc(T.name)}</span>
      <span class="n">${fmtInt(T.count)}</span>
    </div>`).join('') || '<div class="dim" style="font-size:11.5px">尚未载入数据</div>';
  $$('.tagrow', host).forEach(r => r.onclick = () => {
    const T = S.tags[+r.dataset.t];
    T.on = !T.on;
    r.classList.toggle('off', !T.on);
    FILT.invalidate(); OV.key = ''; requestDraw(); scheduleAnalytics();
  });
  $('#tagCnt').textContent = S.tags.length ? S.tags.length + ' 类' : '';
}
$('#bTagAll').onclick = () => { S.tags.forEach(T => T.on = true); renderTagList(); FILT.invalidate(); OV.key = ''; requestDraw(); };
$('#bTagNone').onclick = () => { S.tags.forEach(T => T.on = false); renderTagList(); FILT.invalidate(); OV.key = ''; requestDraw(); };
$('#bTagInv').onclick = () => { S.tags.forEach(T => T.on = !T.on); renderTagList(); FILT.invalidate(); OV.key = ''; requestDraw(); };

function updateSideStats() {
  $('#sFile').textContent = Src.name || '—';
  $('#sFile').className = Src.name ? 'mono' : 'dim';
  $('#sMode').textContent = { static: '离线', fsa: '实时·文件句柄', http: '实时·HTTP' }[Src.kind] || '—';
  $('#sMode').className = Src.kind === 'static' ? '' : Src.kind ? 'mono' : 'dim';
  $('#sBytes').textContent = fmtBytes(S.bytes) + (Src.size ? ' / ' + fmtBytes(Src.size) : '');
  $('#sEvents').textContent = fmtInt(S.n);
  if (S.n) {
    $('#sSpan').textContent = fmtNum((S.t1 - S.t0) / S.period, 0) + ' cyc';
    $('#sPeriod').textContent = fmtInt(S.period) + ' tick';
  }
  $('#srcCnt').textContent = S.badLines ? S.badLines + ' 行异常' : '';
  $('#pParse').textContent = S.parseMs.toFixed(0) + ' ms';
  if (!$('#inPeriod').value && S.periodAuto) $('#inPeriod').value = S.periodAuto;
}

/* ------------------------------- status --------------------------------- */
function updateStatus() {
  const d = $('#stDot'), t = $('#stText');
  if (Src.err) { d.className = 'dot err'; t.textContent = '错误: ' + Src.err; }
  else if (Src.live && !Src.paused) {
    d.className = 'dot live';
    const age = Src.lastGrow ? ((Date.now() - Src.lastGrow) / 1000).toFixed(0) + 's 前' : '等待中';
    t.textContent = `实时跟进中 · 最近新增 ${age}`;
  } else if (Src.live && Src.paused) { d.className = 'dot pause'; t.textContent = '已暂停'; }
  else if (S.n) { d.className = 'dot'; t.textContent = '离线分析'; }
  else { d.className = 'dot'; t.textContent = '就绪'; }

  FILT.build();
  $('#stEv').textContent = S.n ? `${fmtInt(FILT.n)} / ${fmtInt(S.n)} 事件` : '';
  $('#fHit').textContent = S.n ? fmtInt(FILT.n) : '—';
  $('#stWin').textContent = S.n ? `窗口 ${fmtNum(VP.t0 / S.period, 0)} → ${fmtNum(VP.t1 / S.period, 0)} cyc` : '';
  $('#lbWin').textContent = S.n ? `${fmtNum((VP.t1 - VP.t0) / S.period, 0)} cycle 宽 · ${axLabel(VP.t0)} → ${axLabel(VP.t1)}` : '—';
  $('#pFrame').textContent = PIPE.lastFrameMs.toFixed(1) + ' ms';
  $('#pVis').textContent = fmtInt(PIPE.visN);
  updateSideStats();
}

/* ---------------------------- tooltip ----------------------------------- */
const TIP = $('#tip');
function showTip(i, cx, cy) {
  const t = S.time.a[i], tag = S.tagName(i);
  const rows = S.fieldsOf(i).map(([k, v]) => {
    const dec = decodeField(tag, k, v);
    return `<tr><td class="k">${esc(k)}</td><td>${esc(v)}${dec ? ` <span style="color:#ffb454">${esc(dec)}</span>` : ''}</td></tr>`;
  }).join('');
  TIP.innerHTML =
    `<div><b>${esc(tag)}</b> <span class="k">#${i + S.base}</span></div>
     <div class="k">t=${fmtInt(t)} · cycle ${fmtNum(t / S.period, 0)}</div>
     <table>${rows}</table>
     <div class="k" style="margin-top:4px;border-top:1px solid #263043;padding-top:3px">点击选中 · 追踪该 cacheline</div>`;
  TIP.style.display = 'block';
  const r = TIP.getBoundingClientRect();
  TIP.style.left = clamp(cx + 15, 4, innerWidth - r.width - 6) + 'px';
  TIP.style.top = clamp(cy + 15, 4, innerHeight - r.height - 6) + 'px';
}
function hideTip() { TIP.style.display = 'none'; }

/* --------------------------- detail panel ------------------------------- */
function renderDetail() {
  const host = $('#detailBody');
  const i = SEL.ev;
  if (i < 0 || i >= S.n) {
    host.innerHTML = '<div class="dim" style="font-size:11.5px;line-height:1.8">在任意视图中点击一个事件<br>可查看其全部字段、译码结果，<br>以及所属 cacheline 的流水链路。</div>';
    return;
  }
  const tag = S.tagName(i), meta = S.tags[S.tag.a[i]].meta, t = S.time.a[i];
  let h = `<div style="display:flex;align-items:center;gap:7px;margin-bottom:8px">
      <span style="width:10px;height:10px;border-radius:3px;background:${meta.c}"></span>
      <b class="mono">${esc(tag)}</b><span class="pill">${esc(meta.g)}</span></div>
    <div class="dim" style="font-size:11px;line-height:1.65;margin-bottom:9px">${esc(meta.d)}</div>
    <div class="dfield"><span class="k">时间</span><span class="v">${fmtInt(t)} <em>cycle ${fmtNum(t / S.period, 0)}</em></span></div>
    <div class="dfield"><span class="k">序号</span><span class="v">#${i + S.base}</span></div>`;

  h += '<div class="dsec">原始字段</div>';
  for (const [k, v] of S.fieldsOf(i)) {
    const dec = decodeField(tag, k, v);
    h += `<div class="dfield"><span class="k">${esc(k)}</span><span class="v">${esc(v)}${dec ? `<em>${esc(dec)}</em>` : ''}</span></div>`;
  }

  /* cacheline lifecycle chain */
  const line = S.addl.a[i];
  if (line >= 0) {
    let head = i, guard = 0;
    const gapMax = (+$('#inTxnGap').value || 3000) * S.period;
    while (S.prevLine.a[head] >= 0 && guard++ < 4000 &&
      S.time.a[head] - S.time.a[S.prevLine.a[head]] <= gapMax) head = S.prevLine.a[head];
    const chain = [];
    let c = head; guard = 0;
    while (c >= 0 && guard++ < 400) {
      chain.push(c);
      const nx = S.nextLine.a[c];
      if (nx < 0 || S.time.a[nx] - S.time.a[c] > gapMax) break;
      c = nx;
    }
    h += `<div class="dsec">Cacheline ${hexAddr(line)} 事务链路 · ${chain.length} 步</div><div class="chain">`;
    const t0 = S.time.a[chain[0]];
    chain.forEach((k, idx) => {
      const m = S.tags[S.tag.a[k]].meta;
      const dt = (S.time.a[k] - t0) / S.period;
      h += `${idx ? '<div class="arrow">│</div>' : ''}
        <div class="ci ${k === i ? 'cur' : ''}" data-ev="${k}">
          <span class="sw" style="background:${m.c}"></span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis">${esc(S.tagName(k))}</span>
          <span class="t">+${fmtNum(dt, 0)}</span></div>`;
    });
    h += '</div>';
    h += `<div style="margin-top:9px;display:flex;gap:6px">
       <button class="btn sm grow" id="dSelLine">聚焦该 cacheline</button>
       <button class="btn sm grow" id="dZoomTxn">缩放到事务</button></div>`;
  }
  host.innerHTML = h;
  $$('.ci', host).forEach(el => el.onclick = () => selectEvent(+el.dataset.ev, true));
  const b1 = $('#dSelLine'); if (b1) b1.onclick = () => { SEL.line = line; $('#ckOnlySel').checked = true; FILT.parse(); renderSelBox(); requestDraw(); };
  const b2 = $('#dZoomTxn'); if (b2) b2.onclick = () => zoomToLine(line);
}

function renderSelBox() {
  const host = $('#selBox');
  if (SEL.line < 0) { host.innerHTML = '<div class="dim" style="font-size:11.5px">点击任意事件以追踪其 cacheline 的完整流水生命周期</div>'; return; }
  let cnt = 0, first = -1, last = -1;
  for (let i = 0; i < S.n; i++) if (S.addl.a[i] === SEL.line) { cnt++; if (first < 0) first = i; last = i; }
  host.innerHTML = `
    <div class="stat"><span class="muted">地址</span><b class="mono" style="color:#ffd479">${hexAddr(SEL.line)}</b></div>
    <div class="stat"><span class="muted">事件数</span><b>${fmtInt(cnt)}</b></div>
    <div class="stat"><span class="muted">首次</span><b>${first >= 0 ? fmtNum(S.time.a[first] / S.period, 0) + ' cyc' : '—'}</b></div>
    <div class="stat"><span class="muted">末次</span><b>${last >= 0 ? fmtNum(S.time.a[last] / S.period, 0) + ' cyc' : '—'}</b></div>
    <div style="display:flex;gap:6px;margin-top:8px">
      <button class="btn sm grow" id="sbZoom">全览该行</button>
      <button class="btn sm grow" id="sbClr">取消选中</button></div>`;
  $('#sbZoom').onclick = () => { if (first >= 0) { VP.set(S.time.a[first] - S.period * 40, S.time.a[last] + S.period * 40); requestDraw(); } };
  $('#sbClr').onclick = () => { SEL.line = -1; SEL.ev = -1; $('#ckOnlySel').checked = false; FILT.parse(); renderSelBox(); renderDetail(); requestDraw(); };
}

function selectEvent(i, keepLine) {
  SEL.ev = i;
  if (i >= 0 && !keepLine) SEL.line = S.addl.a[i] >= 0 ? S.addl.a[i] : -1;
  $('#gSel').classList.remove('col');
  renderDetail(); renderSelBox();
  if (FILT.onlySel) FILT.parse();
  requestDraw();
}
function zoomToLine(line) {
  let f = -1, l = -1;
  for (let i = 0; i < S.n; i++) if (S.addl.a[i] === line) { if (f < 0) f = i; l = i; }
  if (f < 0) return;
  const gapMax = (+$('#inTxnGap').value || 3000) * S.period;
  let a = SEL.ev >= 0 ? SEL.ev : f, b = a, g = 0;
  while (S.prevLine.a[a] >= 0 && g++ < 4000 && S.time.a[a] - S.time.a[S.prevLine.a[a]] <= gapMax) a = S.prevLine.a[a];
  g = 0;
  while (S.nextLine.a[b] >= 0 && g++ < 4000 && S.time.a[S.nextLine.a[b]] - S.time.a[b] <= gapMax) b = S.nextLine.a[b];
  const pad = Math.max((S.time.a[b] - S.time.a[a]) * .18, S.period * 12);
  VP.set(S.time.a[a] - pad, S.time.a[b] + pad);
  $('#ckFollow').checked = false;
  requestDraw();
}

/* ========================= canvas interactions =========================== */
function bindCanvas(wrapSel, cvSel, which) {
  const wrap = $(wrapSel), cv = $(cvSel);
  let drag = null;

  const local = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, r }; };
  const gut = () => which === 'pipe' ? PIPE.gut : ADDR.gut;
  const store = () => which === 'pipe' ? PIPE : ADDR;

  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const { x, y } = local(e);
    const plotW = cv.clientWidth - gut();
    if (which === 'addr' && (e.ctrlKey || e.metaKey)) {          // vertical zoom
      const ruler = ADDR.ruler, plotH = cv.clientHeight - ruler;
      const fy = 1 - clamp((y - ruler) / plotH, 0, 1);
      const yw = VP.y1 - VP.y0, f = e.deltaY > 0 ? 1.22 : 1 / 1.22;
      const anchor = VP.y0 + yw * fy, nw = Math.max(1, yw * f);
      VP.y0 = anchor - nw * fy; VP.y1 = VP.y0 + nw;
    } else if (which === 'pipe' && e.shiftKey) {                 // vertical lane scroll
      PIPE.yoff += e.deltaY;
    } else {
      const fx = clamp((x - gut()) / plotW, 0, 1);
      VP.zoomAt(fx, e.deltaY > 0 ? 1.22 : 1 / 1.22);
      $('#ckFollow').checked = false;
    }
    requestDraw();
  }, { passive: false });

  wrap.addEventListener('mousedown', e => {
    const { x, y } = local(e);
    if (e.shiftKey && which === 'pipe') { MOUSE.box = { x0: x }; drag = { box: true }; }
    else drag = { x, y, t0: VP.t0, t1: VP.t1, y0: VP.y0, y1: VP.y1, yoff: PIPE.yoff, moved: 0 };
    cv.style.cursor = 'grabbing';
  });

  wrap.addEventListener('mousemove', e => {
    const { x, y } = local(e);
    MOUSE.in = which; MOUSE.x = x; MOUSE.y = y;
    if (drag && drag.box) { requestDraw(); return; }
    if (drag) {
      drag.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
      const plotW = cv.clientWidth - gut();
      const dt = -(x - drag.x) / plotW * (drag.t1 - drag.t0);
      VP.t0 = drag.t0 + dt; VP.t1 = drag.t1 + dt;
      if (drag.moved > 3) $('#ckFollow').checked = false;
      if (which === 'addr') {
        const plotH = cv.clientHeight - ADDR.ruler;
        const dy = (y - drag.y) / plotH * (drag.y1 - drag.y0);
        VP.y0 = drag.y0 + dy; VP.y1 = drag.y1 + dy;
      } else {
        PIPE.yoff = drag.yoff - (y - drag.y);
      }
      hideTip(); requestDraw(); return;
    }
    const hit = hitTest(store(), x, y, 11);
    if (hit !== SEL.hover) {
      SEL.hover = hit;
      if (hit >= 0) { showTip(hit, e.clientX, e.clientY); $('#stHover').textContent = `${S.tagName(hit)} @ ${hexAddr(S.addl.a[hit])}`; }
      else { hideTip(); $('#stHover').textContent = ''; }
    } else if (hit >= 0) showTip(hit, e.clientX, e.clientY);
    cv.style.cursor = hit >= 0 ? 'pointer' : 'crosshair';
    requestDraw();
  });

  const end = e => {
    if (!drag) return;
    const { x } = local(e);
    if (drag.box && MOUSE.box) {
      const x0 = Math.min(MOUSE.box.x0, x), x1 = Math.max(MOUSE.box.x0, x);
      if (x1 - x0 > 6) {
        const plotW = cv.clientWidth - gut(), w = VP.t1 - VP.t0;
        const a = VP.t0 + (x0 - gut()) / plotW * w, b = VP.t0 + (x1 - gut()) / plotW * w;
        VP.set(a, b); $('#ckFollow').checked = false;
      }
      MOUSE.box = null;
    } else if (drag.moved < 4) {
      const hit = hitTest(store(), local(e).x, local(e).y, 12);
      if (hit >= 0) selectEvent(hit);
      else { SEL.ev = -1; SEL.line = -1; renderDetail(); renderSelBox(); if (FILT.onlySel) FILT.parse(); }
    }
    drag = null; cv.style.cursor = 'crosshair'; requestDraw();
  };
  addEventListener('mouseup', end);
  wrap.addEventListener('mouseleave', () => { MOUSE.in = null; hideTip(); SEL.hover = -1; $('#stHover').textContent = ''; requestDraw(); });
  wrap.addEventListener('dblclick', () => { VP.fit(); requestDraw(); });
}
bindCanvas('#pipeWrap', '#cvPipe', 'pipe');
bindCanvas('#addrWrap', '#cvAddr', 'addr');

/* overview brush */
(() => {
  const wrap = $('#ovwrap'), cv = $('#cvOv');
  let drag = null;
  const posT = e => {
    const r = cv.getBoundingClientRect();
    const f = clamp((e.clientX - r.left) / r.width, 0, 1);
    return S.t0 + f * Math.max(S.t1 - S.t0, 1);
  };
  wrap.addEventListener('mousedown', e => { drag = { t: posT(e), w: VP.width() }; $('#ckFollow').checked = false; });
  addEventListener('mousemove', e => {
    if (!drag) return;
    const t = posT(e);
    if (Math.abs(t - drag.t) > drag.w * .04) VP.set(Math.min(drag.t, t), Math.max(drag.t, t));
    else VP.set(t - drag.w / 2, t + drag.w / 2);
    requestDraw();
  });
  addEventListener('mouseup', () => { drag = null; });
  wrap.style.cursor = 'ew-resize';
})();

/* zoom buttons */
$('#bZoomIn').onclick = () => { VP.zoomAt(.5, 1 / 1.6); requestDraw(); };
$('#bZoomOut').onclick = () => { VP.zoomAt(.5, 1.6); requestDraw(); };
$('#bZoomFit').onclick = () => { VP.fit(); $('#ckFollow').checked = false; requestDraw(); };
$('#bZoomLast').onclick = () => { VP.last(2000); requestDraw(); };

/* keyboard */
addEventListener('keydown', e => {
  if (/input|textarea|select/i.test(e.target.tagName)) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  const w = VP.width();
  switch (e.key) {
    case '+': case '=': VP.zoomAt(.5, 1 / 1.6); break;
    case '-': case '_': VP.zoomAt(.5, 1.6); break;
    case 'ArrowLeft': VP.panBy(-w * (e.shiftKey ? .5 : .12)); $('#ckFollow').checked = false; break;
    case 'ArrowRight': VP.panBy(w * (e.shiftKey ? .5 : .12)); $('#ckFollow').checked = false; break;
    case 'ArrowUp': PIPE.yoff -= 30; break;
    case 'ArrowDown': PIPE.yoff += 30; break;
    case 'f': case 'F': VP.fit(); break;
    case 'l': case 'L': VP.last(2000); break;
    case 'Escape': SEL.ev = -1; SEL.line = -1; $('#ckOnlySel').checked = false; FILT.parse(); renderDetail(); renderSelBox(); break;
    case '/': e.preventDefault(); $('#qSearch').focus(); break;
    default: return;
  }
  e.preventDefault(); requestDraw();
});

/* ------------------------------- tabs ----------------------------------- */
$$('.tab').forEach(t => t.onclick = () => {
  $$('.tab').forEach(x => x.classList.remove('on'));
  $$('.pane').forEach(x => x.classList.remove('on'));
  t.classList.add('on');
  $(`.pane[data-pane="${t.dataset.pane}"]`).classList.add('on');
  if (t.dataset.pane === 'tbl') renderTable();
  if (t.dataset.pane === 'txn') renderTxn();
  if (t.dataset.pane === 'an') renderAnalytics();
  requestDraw();
});
$('#bSide').onclick = () => $('#side').classList.toggle('hide');
$('#bDetail').onclick = () => $('#detail').classList.toggle('hide');

/* ---------------------------- filter inputs ----------------------------- */
let filtTimer = null;
const onFilter = () => {
  clearTimeout(filtTimer);
  filtTimer = setTimeout(() => { FILT.parse(); OV.key = ''; requestDraw(); refreshActivePane(); scheduleAnalytics(); }, 180);
};
['#fPC', '#fAddr', '#fAddrLo', '#fAddrHi', '#fIID', '#qSearch'].forEach(s => $(s).addEventListener('input', onFilter));
$('#ckOnlySel').onchange = () => { FILT.parse(); requestDraw(); refreshActivePane(); };
$('#bClrFilter').onclick = () => {
  ['#fPC', '#fAddr', '#fAddrLo', '#fAddrHi', '#fIID', '#qSearch'].forEach(s => $(s).value = '');
  $('#ckOnlySel').checked = false;
  FILT.parse(); OV.key = ''; requestDraw(); refreshActivePane();
};
['#ckLinks', '#ckIIDLink', '#ckGrid', '#ckLabels', '#ckDensity', '#inLinkWin', '#inSize',
  '#selAddrMode', '#selColor', '#ckPFLine', '#ckStride', '#selXAxis', '#selUnit', '#inPeriod']
  .forEach(s => $(s).addEventListener('input', () => { if (s === '#selAddrMode') VP.yInit = false; OV.key = ''; requestDraw(); }));
$('#selPoll').onchange = () => { if (Src.live) Src.startTimer(); };
$('#selCap').onchange = () => trimStore(+$('#selCap').value || 0);

function refreshActivePane() {
  const p = $('.tab.on')?.dataset.pane;
  if (p === 'tbl') renderTable();
  else if (p === 'txn') renderTxn();
  else if (p === 'an') renderAnalytics();
}

/* ============================ EVENT TABLE ================================ */
const ROWH = 21;
let tblCols = [];
function tableColumns() {
  const base = ['#', 'cycle', 'Tag', 'ADDL', 'PC', 'IID'];
  return base.concat(['字段']);
}
function renderTable() {
  FILT.build();
  const scroll = $('#tblScroll'), vt = $('#vtable'), tb = $('#tEv').querySelector('tbody'), th = $('#tEv').querySelector('thead');
  tblCols = tableColumns();
  th.innerHTML = '<tr>' + tblCols.map(c => `<th>${esc(c)}</th>`).join('') + '</tr>';
  const n = FILT.n;
  $('#tblCnt').textContent = `${fmtInt(n)} 条事件（已过滤）`;
  vt.style.height = (n * ROWH + 30) + 'px';
  const top = scroll.scrollTop;
  const first = Math.max(0, Math.floor((top - 30) / ROWH) - 4);
  const vis = Math.ceil(scroll.clientHeight / ROWH) + 10;
  const rows = [];
  for (let k = first; k < Math.min(n, first + vis); k++) {
    const i = FILT.arr[k], meta = S.tags[S.tag.a[i]].meta;
    const extra = S.fieldsOf(i).filter(([f]) => !['ADDL', 'PC', 'IID'].includes(f))
      .map(([f, v]) => `${f}:${v}`).join(' ');
    rows.push(`<tr data-ev="${i}" class="${i === SEL.ev ? 'sel' : ''}">
      <td class="dim">${i + S.base}</td>
      <td>${fmtNum(S.time.a[i] / S.period, 0)}</td>
      <td style="color:${meta.c}">${esc(S.tagName(i))}</td>
      <td style="color:${S.addl.a[i] === SEL.line ? '#ffd479' : ''}">${S.addl.a[i] >= 0 ? S.addl.a[i].toString(16).padStart(10, '0') : '—'}</td>
      <td>${S.pc.a[i] >= 0 ? S.pc.a[i].toString(16).padStart(4, '0') : '—'}</td>
      <td>${S.iid.a[i] >= 0 ? S.iid.a[i].toString(16).padStart(2, '0') : '—'}</td>
      <td class="dim" style="max-width:900px;overflow:hidden;text-overflow:ellipsis">${esc(extra)}</td></tr>`);
  }
  tb.innerHTML = rows.join('');
  $('#tEv').style.transform = `translateY(${first * ROWH}px)`;
  $$('#tEv tbody tr').forEach(tr => tr.onclick = () => { selectEvent(+tr.dataset.ev); renderTable(); });
}
$('#tblScroll').addEventListener('scroll', () => {
  if ($('.tab.on')?.dataset.pane === 'tbl') {
    if ($('#tblScroll').scrollTop < $('#vtable').clientHeight - $('#tblScroll').clientHeight - 40) $('#ckTblFollow').checked = false;
    renderTable();
  }
});
$('#bTblCsv').onclick = () => {
  FILT.build();
  const N = Math.min(FILT.n, 200000);
  const keys = new Set(['time', 'tag', 'ADDL', 'PC', 'IID']);
  for (const T of S.tags) T.fields.forEach(f => keys.add(f));
  const cols = Array.from(keys);
  const out = [cols.join(',')];
  for (let k = 0; k < N; k++) {
    const i = FILT.arr[k];
    const m = new Map(S.fieldsOf(i));
    out.push(cols.map(c => c === 'time' ? S.time.a[i] : c === 'tag' ? S.tagName(i) : (m.get(c) ?? '')).join(','));
  }
  download(out.join('\n'), 'trace_events.csv');
};
function download(text, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

/* ========================== TRANSACTIONS ================================= */
let TXN = { list: [], key: '', sort: 'start', desc: false };
function buildTxns() {
  FILT.build();
  const gap = (+$('#inTxnGap').value || 3000) * S.period;
  const key = `${S.dirty}|${FILT.ver}|${FILT.n}|${gap}`;
  if (TXN.key === key) return TXN.list;
  const open = new Map(), out = [];
  for (let k = 0; k < FILT.n; k++) {
    const i = FILT.arr[k], ad = S.addl.a[i];
    if (ad < 0) continue;
    const t = S.time.a[i], tag = S.tagName(i), fl = S.flag.a[i];
    let x = open.get(ad);
    if (!x || t - x.tLast > gap) {
      if (x) out.push(x);
      x = { ad, t0: t, tLast: t, n: 0, tags: new Set(), pcs: new Set(),
        tDem: -1, tPF: -1, tPFacc: -1, tBusR: -1, tBusW: -1, tWB: -1, tL2: -1,
        pfBeforeDem: false, demAfterPF: false, sids: new Set(), first: i };
      open.set(ad, x);
    }
    x.n++; x.tLast = t; x.tags.add(tag);
    if (S.pc.a[i] >= 0 && S.pc.a[i] !== 0xfffe && S.pc.a[i] !== 0x7fff && S.pc.a[i] !== 0) x.pcs.add(S.pc.a[i]);
    if (fl & F_DEMAND) { if (x.tDem < 0) x.tDem = t; if (x.tPF >= 0) x.demAfterPF = true; }
    if (fl & F_PFREQ) {
      if (x.tPF < 0) x.tPF = t;
      if (S.field(i, 'READY') === '1' && x.tPFacc < 0) x.tPFacc = t;
      if (x.tDem < 0) x.pfBeforeDem = true;
    }
    if (fl & F_L2) { if (x.tL2 < 0) x.tL2 = t; const sid = S.field(i, 'SID'); if (sid) x.sids.add(sid); }
    if (tag === 'BIU_PAD_AR' && x.tBusR < 0) x.tBusR = t;
    if (tag === 'BIU_PAD_AW' && x.tBusW < 0) x.tBusW = t;
    if (tag === 'LSU_LD_WB_pg') x.tWB = t;
  }
  for (const x of open.values()) out.push(x);
  out.sort((a, b) => a.t0 - b.t0);
  TXN.list = out; TXN.key = key;
  return out;
}
function txnClass(x) {
  const hasPF = x.tPF >= 0, hasBus = x.tBusR >= 0 || x.tBusW >= 0;
  if (hasPF && x.demAfterPF) return 'pfhit';
  if (hasPF && !x.demAfterPF) return 'pfwaste';
  if (hasBus) return 'miss';
  return 'other';
}
const TXN_COLS = [
  { k: 'start', t: '起始 cyc', f: x => fmtNum(x.t0 / S.period, 0), v: x => x.t0 },
  { k: 'dur', t: '时长 cyc', f: x => fmtNum((x.tLast - x.t0) / S.period, 0), v: x => x.tLast - x.t0 },
  { k: 'ad', t: 'Cacheline', f: x => x.ad.toString(16).padStart(10, '0'), v: x => x.ad },
  { k: 'n', t: '事件', f: x => x.n, v: x => x.n },
  { k: 'cls', t: '类别', f: x => ({ pfhit: '<span style="color:#33d17a">预取命中</span>', pfwaste: '<span style="color:#ffb454">预取未用</span>', miss: '<span style="color:#60a5fa">总线访问</span>', other: '<span class="dim">—</span>' })[txnClass(x)], v: x => txnClass(x) },
  { k: 'pcs', t: 'PC', f: x => Array.from(x.pcs).slice(0, 3).map(p => p.toString(16).padStart(4, '0')).join(' ') || '—', v: x => x.pcs.size },
  { k: 'pflead', t: '预取提前量', f: x => x.tPF >= 0 && x.tDem > x.tPF ? fmtNum((x.tDem - x.tPF) / S.period, 0) : '—', v: x => x.tPF >= 0 && x.tDem > x.tPF ? (x.tDem - x.tPF) / S.period : -1 },
  { k: 'd2b', t: '发起→总线', f: x => x.tDem >= 0 && x.tBusR >= 0 ? fmtNum((x.tBusR - x.tDem) / S.period, 0) : '—', v: x => x.tDem >= 0 && x.tBusR >= 0 ? (x.tBusR - x.tDem) / S.period : -1 },
  { k: 'b2w', t: '总线→写回', f: x => x.tBusR >= 0 && x.tWB > x.tBusR ? fmtNum((x.tWB - x.tBusR) / S.period, 0) : '—', v: x => x.tBusR >= 0 && x.tWB > x.tBusR ? (x.tWB - x.tBusR) / S.period : -1 },
  { k: 'sid', t: 'SAB SID', f: x => Array.from(x.sids).slice(0, 3).join(',') || '—', v: x => x.sids.size },
  { k: 'tags', t: '经过阶段', f: x => Array.from(x.tags).map(t => `<span class="pill" style="border-color:${S.tags[S.tagIdx.get(t)].meta.c}55;color:${S.tags[S.tagIdx.get(t)].meta.c}">${esc(t)}</span>`).join(' '), v: x => x.tags.size },
];
function renderTxn() {
  let list = buildTxns();
  const f = $('#selTxnFilter').value;
  if (f !== 'all') list = list.filter(x => {
    const c = txnClass(x);
    if (f === 'miss') return x.tBusR >= 0 || x.tBusW >= 0;
    if (f === 'pf') return x.tPF >= 0;
    return c === f;
  });
  const col = TXN_COLS.find(c => c.k === TXN.sort) || TXN_COLS[0];
  list = list.slice().sort((a, b) => {
    const va = col.v(a), vb = col.v(b);
    const r = va < vb ? -1 : va > vb ? 1 : 0;
    return TXN.desc ? -r : r;
  });
  $('#txnCnt').textContent = `${fmtInt(list.length)} 个事务`;
  const th = $('#tTxn thead'), tb = $('#tTxn tbody');
  th.innerHTML = '<tr>' + TXN_COLS.map(c =>
    `<th data-k="${c.k}">${esc(c.t)}${TXN.sort === c.k ? `<span class="ar">${TXN.desc ? '▼' : '▲'}</span>` : ''}</th>`).join('') + '</tr>';
  const N = Math.min(list.length, 3000);
  const rows = [];
  for (let i = 0; i < N; i++) {
    const x = list[i];
    rows.push(`<tr data-ad="${x.ad}" data-ev="${x.first}" class="${x.ad === SEL.line ? 'sel' : ''}">` +
      TXN_COLS.map(c => `<td>${c.f(x)}</td>`).join('') + '</tr>');
  }
  tb.innerHTML = rows.join('') || '<tr><td colspan="11" class="empty">无匹配事务</td></tr>';
  if (list.length > N) tb.innerHTML += `<tr><td colspan="11" class="empty">仅显示前 ${fmtInt(N)} 行，请用过滤器缩小范围</td></tr>`;
  $$('#tTxn thead th').forEach(h => h.onclick = () => {
    if (TXN.sort === h.dataset.k) TXN.desc = !TXN.desc; else { TXN.sort = h.dataset.k; TXN.desc = true; }
    renderTxn();
  });
  $$('#tTxn tbody tr[data-ad]').forEach(tr => tr.onclick = () => {
    SEL.line = +tr.dataset.ad; selectEvent(+tr.dataset.ev, true); zoomToLine(SEL.line);
    $$('.tab').forEach(x => x.classList.remove('on'));
    $$('.pane').forEach(x => x.classList.remove('on'));
    $('.tab[data-pane=pipe]').classList.add('on'); $('.pane[data-pane=pipe]').classList.add('on');
    requestDraw();
  });
}
$('#inTxnGap').addEventListener('input', () => { TXN.key = ''; renderTxn(); });
$('#selTxnFilter').onchange = renderTxn;
$('#bTxnCsv').onclick = () => {
  const list = buildTxns();
  const hdr = ['start_cycle', 'dur_cycle', 'cacheline', 'events', 'class', 'pcs', 'pf_lead_cycle', 'demand_to_bus', 'bus_to_wb', 'sids', 'stages'];
  const out = [hdr.join(',')];
  for (const x of list) out.push([
    (x.t0 / S.period).toFixed(0), ((x.tLast - x.t0) / S.period).toFixed(0),
    '0x' + x.ad.toString(16), x.n, txnClass(x),
    '"' + Array.from(x.pcs).map(p => p.toString(16)).join(' ') + '"',
    x.tPF >= 0 && x.tDem > x.tPF ? ((x.tDem - x.tPF) / S.period).toFixed(0) : '',
    x.tDem >= 0 && x.tBusR >= 0 ? ((x.tBusR - x.tDem) / S.period).toFixed(0) : '',
    x.tBusR >= 0 && x.tWB > x.tBusR ? ((x.tWB - x.tBusR) / S.period).toFixed(0) : '',
    '"' + Array.from(x.sids).join(' ') + '"',
    '"' + Array.from(x.tags).join(' ') + '"'].join(','));
  download(out.join('\n'), 'trace_transactions.csv');
};

/* ============================= ANALYTICS ================================= */
let anTimer = null;
function scheduleAnalytics() {
  if (!$('#ckAnAuto').checked) return;
  if ($('.tab.on')?.dataset.pane !== 'an') return;
  clearTimeout(anTimer); anTimer = setTimeout(renderAnalytics, 300);
}
function hbars(items, total, colorFn) {
  if (!items.length) return '<div class="empty">无数据</div>';
  const mx = Math.max(...items.map(x => x[1])) || 1;
  return items.map(([k, v]) => `
    <div class="hbar"><div class="lbl" title="${esc(k)}">${esc(k)}</div>
      <div class="tr"><i style="width:${(v / mx * 100).toFixed(1)}%;background:${colorFn ? colorFn(k) : 'var(--acc)'}"></i></div>
      <div class="vv">${fmtInt(v)}${total ? ' · ' + (v / total * 100).toFixed(1) + '%' : ''}</div></div>`).join('');
}
function sparkline(vals, color) {
  if (!vals.length) return '';
  const W = 300, H = 56, mx = Math.max(...vals) || 1;
  const step = W / vals.length;
  let d = '';
  vals.forEach((v, i) => { d += `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(H - v / mx * (H - 6) - 2).toFixed(1)}`; });
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.5"/>
    <path d="${d}L${W},${H}L0,${H}Z" fill="${color}" opacity=".13"/></svg>`;
}
function histCard(title, vals, unit, color) {
  if (!vals.length) return `<div class="card"><h5>${title}</h5><div class="empty">无样本</div></div>`;
  vals.sort((a, b) => a - b);
  const q = p => vals[clamp(Math.floor(p * (vals.length - 1)), 0, vals.length - 1)];
  const NB = 26, lo = q(0), hi = q(.97) || 1;
  const bins = new Array(NB).fill(0);
  for (const v of vals) bins[clamp(Math.floor((v - lo) / Math.max(hi - lo, 1e-9) * NB), 0, NB - 1)]++;
  const mx = Math.max(...bins) || 1;
  const bars = bins.map((b, i) =>
    `<div title="${(lo + (hi - lo) * i / NB).toFixed(0)}~${(lo + (hi - lo) * (i + 1) / NB).toFixed(0)} ${unit}: ${b}" style="flex:1;height:${Math.max(1, b / mx * 62)}px;background:${color};opacity:${.35 + .6 * b / mx};border-radius:1px 1px 0 0"></div>`).join('');
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return `<div class="card"><h5>${title}<span class="hint">${fmtInt(vals.length)} 样本</span></h5>
    <div style="display:flex;align-items:flex-end;gap:1.5px;height:64px;margin:6px 0">${bars}</div>
    <div class="leg" style="justify-content:space-between;font-family:var(--mono)">
      <span>min ${fmtNum(q(0), 0)}</span><span>p50 ${fmtNum(q(.5), 0)}</span>
      <span>p90 ${fmtNum(q(.9), 0)}</span><span>max ${fmtNum(q(1), 0)}</span></div>
    <div class="kpi" style="margin-top:6px"><span class="v" style="font-size:16px">${fmtNum(avg, 1)}</span><span class="u">${unit} 均值</span></div></div>`;
}

function renderAnalytics() {
  const host = $('#anGrid');
  FILT.build();
  if (!S.n) { host.innerHTML = '<div class="empty">载入 trace 后显示统计</div>'; return; }
  const t0 = performance.now();

  /* ---- pass over filtered events ---- */
  const tagCnt = new Map(), pcCnt = new Map(), lineCnt = new Map(), pcAddr = new Map();
  const NB = 90, bins = new Array(NB).fill(0);
  const span = Math.max(S.t1 - S.t0, 1);
  let pfIssued = 0, pfAccepted = 0, pfStalled = 0, demand = 0, busR = 0, busW = 0, l2 = 0, l2stall = 0;
  const respCnt = new Map(), typeCnt = new Map(), sidCnt = new Map();
  for (let k = 0; k < FILT.n; k++) {
    const i = FILT.arr[k], tag = S.tagName(i), fl = S.flag.a[i];
    tagCnt.set(tag, (tagCnt.get(tag) || 0) + 1);
    bins[clamp(Math.floor((S.time.a[i] - S.t0) / span * NB), 0, NB - 1)]++;
    const ad = S.addl.a[i];
    if (ad >= 0) lineCnt.set(ad, (lineCnt.get(ad) || 0) + 1);
    const pc = S.pc.a[i];
    if (fl & F_DEMAND) {
      demand++;
      if (pc >= 0) {
        pcCnt.set(pc, (pcCnt.get(pc) || 0) + 1);
        let l = pcAddr.get(pc); if (!l) pcAddr.set(pc, l = []);
        if (l.length < 6000) l.push(ad);
      }
    }
    if (fl & F_PFREQ) { pfIssued++; if (S.field(i, 'READY') === '1') pfAccepted++; else pfStalled++; }
    if (tag === 'BIU_PAD_AR') busR++;
    if (tag === 'BIU_PAD_AW') busW++;
    if (fl & F_L2) {
      l2++;
      if (S.field(i, 'STAL') === '1') l2stall++;
      const r = S.field(i, 'RESP'); if (r) respCnt.set(r, (respCnt.get(r) || 0) + 1);
      const ty = S.field(i, 'TYPE'); if (ty) typeCnt.set(ty, (typeCnt.get(ty) || 0) + 1);
      const sd = S.field(i, 'SID'); if (sd) sidCnt.set(sd, (sidCnt.get(sd) || 0) + 1);
    }
  }

  /* ---- transaction-derived metrics ---- */
  const txns = buildTxns();
  let pfHit = 0, pfWaste = 0, missTx = 0, coveredMiss = 0;
  const leadV = [], d2bV = [], b2wV = [], durV = [];
  for (const x of txns) {
    const c = txnClass(x);
    if (c === 'pfhit') pfHit++; else if (c === 'pfwaste') pfWaste++;
    if (x.tBusR >= 0 || x.tBusW >= 0) { missTx++; if (x.tPF >= 0) coveredMiss++; }
    if (x.tPF >= 0 && x.tDem > x.tPF) leadV.push((x.tDem - x.tPF) / S.period);
    if (x.tDem >= 0 && x.tBusR > x.tDem) d2bV.push((x.tBusR - x.tDem) / S.period);
    if (x.tBusR >= 0 && x.tWB > x.tBusR) b2wV.push((x.tWB - x.tBusR) / S.period);
    durV.push((x.tLast - x.t0) / S.period);
  }

  /* ---- stride analysis per PC ---- */
  const strideRows = [];
  for (const [pc, list] of Array.from(pcAddr).sort((a, b) => b[1].length - a[1].length).slice(0, 8)) {
    const st = new Map();
    for (let i = 1; i < list.length; i++) {
      const d = list[i] - list[i - 1];
      if (d === 0) continue;
      st.set(d, (st.get(d) || 0) + 1);
    }
    const top = Array.from(st).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const tot = Array.from(st.values()).reduce((a, b) => a + b, 0) || 1;
    strideRows.push({ pc, n: list.length, top, tot });
  }

  const cycSpan = span / S.period;
  const cards = [];

  cards.push(`<div class="card"><h5>📌 概览</h5>
    <div class="kpi"><span class="v">${fmtInt(FILT.n)}</span><span class="u">事件</span><span class="l">共 ${fmtInt(S.n)} 条</span></div>
    <div class="kpi"><span class="v">${fmtInt(lineCnt.size)}</span><span class="u">cacheline</span><span class="l">${fmtBytes(lineCnt.size * 64)} 足迹</span></div>
    <div class="kpi"><span class="v">${fmtNum(cycSpan, 0)}</span><span class="u">cycle 跨度</span><span class="l">${(FILT.n / Math.max(cycSpan, 1) * 1000).toFixed(1)} 事件/千周期</span></div>
    <div class="kpi"><span class="v">${fmtInt(txns.length)}</span><span class="u">事务</span><span class="l">平均 ${(FILT.n / Math.max(txns.length, 1)).toFixed(1)} 事件/事务</span></div>
    <div style="margin-top:9px">${sparkline(bins, '#4da3ff')}</div>
    <div class="dim" style="font-size:10.5px;text-align:center">事件密度随时间分布</div></div>`);

  cards.push(`<div class="card"><h5>🧩 事件类型分布</h5>
    ${hbars(Array.from(tagCnt).sort((a, b) => b[1] - a[1]), FILT.n, k => (S.tags[S.tagIdx.get(k)] || { meta: {} }).meta.c || '#4da3ff')}</div>`);

  const pfTotalTx = pfHit + pfWaste;
  cards.push(`<div class="card"><h5>🎯 预取器效果 <span class="hint">基于 ${PF_REQ_TAG} 与后续需求访存的关联</span></h5>
    <div class="kpi"><span class="v" style="color:#f472b6">${fmtInt(pfIssued)}</span><span class="u">预取请求</span>
      <span class="l">被接受 ${fmtInt(pfAccepted)} · 反压 ${fmtInt(pfStalled)}</span></div>
    <div class="kpi"><span class="v" style="color:#33d17a">${pfTotalTx ? (pfHit / pfTotalTx * 100).toFixed(1) : '—'}<span class="u">%</span></span>
      <span class="u">准确率</span><span class="l">${fmtInt(pfHit)} 有效 / ${fmtInt(pfWaste)} 未用</span></div>
    <div class="kpi"><span class="v" style="color:#60a5fa">${missTx ? (coveredMiss / missTx * 100).toFixed(1) : '—'}<span class="u">%</span></span>
      <span class="u">覆盖率</span><span class="l">${fmtInt(coveredMiss)} / ${fmtInt(missTx)} 总线事务</span></div>
    <div class="kpi"><span class="v" style="color:#ffb454">${leadV.length ? fmtNum(leadV.reduce((a, b) => a + b, 0) / leadV.length, 0) : '—'}</span>
      <span class="u">cycle 平均提前量</span><span class="l">及时性</span></div>
    <div class="bar" style="margin-top:8px;height:8px">
      <i style="width:${pfTotalTx ? pfHit / pfTotalTx * 100 : 0}%;background:linear-gradient(90deg,#33d17a,#2dd4bf)"></i></div>
    <div class="leg" style="margin-top:6px"><span><i style="background:#33d17a"></i>有效预取</span><span><i style="background:#ffb454"></i>未被使用</span></div></div>`);

  cards.push(`<div class="card"><h5>🚌 总线与 L2 活动</h5>
    <div class="kpi"><span class="v" style="color:#60a5fa">${fmtInt(busR)}</span><span class="u">AXI 读</span>
      <span class="l">${fmtBytes(busR * 64)} 估算</span></div>
    <div class="kpi"><span class="v" style="color:#f87171">${fmtInt(busW)}</span><span class="u">AXI 写</span>
      <span class="l">${fmtBytes(busW * 64)} 估算</span></div>
    <div class="kpi"><span class="v" style="color:#a78bfa">${fmtInt(l2)}</span><span class="u">L2 CMP</span>
      <span class="l">阻塞 ${l2 ? (l2stall / l2 * 100).toFixed(1) : 0}%</span></div>
    <div class="kpi"><span class="v">${fmtInt(demand)}</span><span class="u">需求访存</span>
      <span class="l">总线/需求 = ${demand ? ((busR + busW) / demand * 100).toFixed(2) : 0}%</span></div></div>`);

  if (typeCnt.size) cards.push(`<div class="card"><h5>🏷 L2C_CMP TYPE 分布 <span class="hint">语义可在 ⚙ 中配置</span></h5>
    ${hbars(Array.from(typeCnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k + (decodeField('L2C_CMP', 'TYPE', k) ? ' · ' + decodeField('L2C_CMP', 'TYPE', k).replace(/\s*\(推测\)/, '') : ''), v]), l2, () => '#a78bfa')}</div>`);

  if (respCnt.size) cards.push(`<div class="card"><h5>📶 L2C_CMP RESP 分布</h5>
    ${hbars(Array.from(respCnt).sort((a, b) => b[1] - a[1]), l2, () => '#7c5cff')}
    <div class="dim" style="font-size:10.5px;margin-top:7px;line-height:1.6">RESP 为位向量，含义请在字段语义配置中按 RTL 定义。</div></div>`);

  cards.push(`<div class="card"><h5>🔥 热点 PC <span class="hint">按需求访存次数</span></h5>
    ${hbars(Array.from(pcCnt).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([p, v]) => ['0x' + p.toString(16).padStart(4, '0'), v]), demand, k => hashColor('pc' + parseInt(k, 16)))}</div>`);

  cards.push(`<div class="card"><h5>📍 热点 Cacheline</h5>
    ${hbars(Array.from(lineCnt).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([a, v]) => ['0x' + a.toString(16).padStart(10, '0'), v]), FILT.n, () => '#22d3ee')}</div>`);

  cards.push(histCard('⏱ 需求发起 → 总线请求 (cycle)', d2bV, 'cyc', '#60a5fa'));
  cards.push(histCard('⏱ 总线请求 → 数据写回 (cycle)', b2wV, 'cyc', '#4ade80'));
  cards.push(histCard('⏱ 预取提前量 (cycle)', leadV, 'cyc', '#f472b6'));
  cards.push(histCard('⏱ 事务持续时长 (cycle)', durV, 'cyc', '#a78bfa'));

  if (strideRows.length) cards.push(`<div class="card" style="grid-column:span 2"><h5>📐 每 PC 访存步幅 <span class="hint">相邻两次访问的 cacheline 地址差，步幅稳定的 PC 最适合步幅预取</span></h5>
    <table class="gr" style="font-size:11px"><thead><tr><th>PC</th><th>访存次数</th><th>主导步幅</th><th>占比</th><th>次要步幅</th></tr></thead><tbody>
    ${strideRows.map(r => {
      const t0s = r.top[0];
      return `<tr><td style="color:${hashColor('pc' + r.pc)}">0x${r.pc.toString(16).padStart(4, '0')}</td>
        <td>${fmtInt(r.n)}</td>
        <td>${t0s ? (t0s[0] > 0 ? '+' : '') + t0s[0] + ' B' + (Math.abs(t0s[0]) % 64 === 0 ? ` (${t0s[0] / 64} 行)` : '') : '—'}</td>
        <td>${t0s ? (t0s[1] / r.tot * 100).toFixed(0) + '%' : '—'}</td>
        <td class="dim">${r.top.slice(1).map(s => (s[0] > 0 ? '+' : '') + s[0]).join(', ') || '—'}</td></tr>`;
    }).join('')}</tbody></table></div>`);

  host.innerHTML = cards.join('');
  void t0;
}
$('#bAnRefresh').onclick = renderAnalytics;

/* ============================ DATA SOURCES UI ============================ */
function afterLoad(fit) {
  detectPeriod();
  $('#inPeriod').value = S.periodAuto || 1;
  FILT.invalidate(); OV.key = ''; ADDR.rankKey = ''; VP.yInit = false;
  renderTagList();
  if (fit) { if (S.n > 20000) VP.last(3000); else VP.fit(); }
  $('#welcome').classList.add('hide');
  $('#bLive').disabled = !Src.live;
  requestDraw(); refreshActivePane();
}
function toast(msg, bad) {
  $('#stText').textContent = msg;
  $('#stDot').className = 'dot ' + (bad ? 'err' : '');
  console[bad ? 'error' : 'log'](msg);
}

/* --- open with live follow ---
 * Three environments, three behaviours:
 *   1. Secure, non-file:// context  → FileSystemAccess API: real incremental follow.
 *   2. localhost HTTP               → openUrl + Range polling: real incremental follow.
 *   3. file:// (double-clicked HTML)→ FSA hangs, fetch() is CORS-blocked, and a File
 *      picked via <input type=file> becomes unreadable once the trace grows. The only
 *      viable "follow" is SEMI-automatic: load a full snapshot, then re-open the picker
 *      on a timer; the user re-selects the same file and we append just the new bytes.
 *      A banner makes this explicit and points to `serve.py` for hands-free follow. */
let fileInputMode = 'static';          // 'static' | 'live'
let liveReady = false;                 // follow session established (later picks are incremental)
let followTimer = null;                // file:// semi-auto follow timer
const FOLLOW_INTERVAL = 4000;          // ms between picker re-prompts on file://

async function openLive() {
  // FSA only works in a secure, non-file:// context. On file:// its call either rejects
  // or hangs forever (no picker, no error) — which is exactly the "button does nothing"
  // symptom. So detect that up front and go to the usable semi-auto path.
  const fsaUsable = !!window.showOpenFilePicker && window.isSecureContext && location.protocol !== 'file:';
  if (!fsaUsable) { fallbackLive(); return; }
  try {
    const [h] = await window.showOpenFilePicker({
      mode: 'read',
      types: [{ description: 'Trace files', accept: { 'text/plain': ['.txt', '.log', '.trace', '.out'] } }],
      multiple: false,
    });
    stopFollowTimer();
    toast('正在读取…');
    await Src.openHandle(h);
    afterLoad(true);
    Src.live = true;
    showFollowBanner(false);
    toast('实时跟进已启动');
  } catch (e) {
    if (e.name === 'AbortError') return;                 // user cancelled the picker
    fallbackLive();                                       // blocked → semi-auto fallback
  }
}
/* file:// (or otherwise FSA-blocked) follow: open the picker; the onchange handler does
 * a full load on the first pick, then starts the periodic re-open timer. */
function fallbackLive() {
  fileInputMode = 'live';
  liveReady = false;
  $('#fileInput').click();
}
/* periodic re-open of the native picker so the user can re-select the same file and
 * feed the appended bytes. Skipped while the tab is hidden or following is paused. */
function startFollowTimer() {
  stopFollowTimer();
  followTimer = setInterval(() => {
    if (document.hidden || Src.paused) return;
    fileInputMode = 'live';
    $('#fileInput').click();
  }, FOLLOW_INTERVAL);
}
function stopFollowTimer() { if (followTimer) { clearInterval(followTimer); followTimer = null; } }

/* banner shown while a follow session is active (FSA/http = automatic, file:// = semi) */
function showFollowBanner(isFileFollow) {
  const b = $('#followBanner');
  b.classList.add('on');
  b.classList.toggle('semi', !!isFileFollow);
  $('#followTitle').textContent = isFileFollow ? '半自动跟随 · file://' : '实时跟进 · 只读';
  $('#followTxt').innerHTML = isFileFollow
    ? '仿真器写入新行后，<b>重新选择同一 trace 文件</b>即自动追加显示。想完全免手动？在 trace 目录运行 <code>python3 serve.py</code>，再打开它给的 <code>http://localhost:8777/</code>。'
    : '实时跟进中：以只读方式监控文件，自动增量读取仿真器新写入的行。';
  $('#bFollowCheck').style.display = isFileFollow ? '' : 'none';
  $('#bFollowPause').textContent = Src.paused ? '▶ 继续跟随' : '⏸ 暂停跟随';
}
function hideFollowBanner() { $('#followBanner').classList.remove('on'); }

/* stop any active follow (FSA/http timer or file:// semi-auto timer) */
function stopFollow() {
  stopFollowTimer();
  Src.stop();
  liveReady = false;
  fileInputMode = 'static';
  hideFollowBanner();
  $('#bLive').disabled = !Src.live;
}

$('#bOpenLive').onclick = openLive;
$('#wLive').onclick = openLive;
$('#bFollowCheck').onclick = () => { if (liveReady) { fileInputMode = 'live'; $('#fileInput').click(); } };
$('#bFollowPause').onclick = () => $('#bLive').click();
$('#bFollowStop').onclick = stopFollow;

/* --- static file --- */
$('#bOpenFile').onclick = () => { stopFollow(); $('#fileInput').click(); };
$('#wFile').onclick = () => { stopFollow(); $('#fileInput').click(); };
$('#fileInput').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) {
    if (fileInputMode === 'live' && liveReady) return;   // picker dismissed without a pick → keep following
    fileInputMode = 'static'; return;
  }
  if (fileInputMode === 'live') {
    if (!liveReady) {
      // first pick of the follow session → full load, then arm the periodic re-open
      await loadStatic(f);
      liveReady = true; Src.live = true;
      startFollowTimer(); showFollowBanner(true);
      toast('半自动跟随已启动：到点后重新选择同一文件即可载入新增数据（或点本栏「立即检查」）');
    } else {
      // subsequent pick (timer-triggered) → append only the new bytes
      toast('载入新增数据…');
      const added = await Src.loadFileIncremental(f, (o, t) => { $('#stText').textContent = `追加中 ${(o / t * 100).toFixed(0)}%`; updateSideStats(); });
      if (added > 0) { afterLoad(false); toast(`已追加 ${fmtInt(added)} 条新事件（共 ${fmtInt(S.n)}）`); }
      else { toast('暂无新增数据'); }
    }
  } else {
    await loadStatic(f);
  }
  // NB: fileInputMode stays 'live' across picks; the timer re-sets it before each click.
};
async function loadStatic(f) {
  stopFollowTimer();
  toast(`解析 ${f.name} …`);
  $('#welcome').classList.add('hide');
  await Src.loadFile(f, (o, t) => { $('#stText').textContent = `解析中 ${(o / t * 100).toFixed(0)}%  (${fmtBytes(o)})`; updateSideStats(); });
  afterLoad(true);
  toast(`已载入 ${fmtInt(S.n)} 条事件 · ${S.parseMs.toFixed(0)} ms`);
}

/* --- URL --- */
$('#bOpenUrl').onclick = () => { openModal('mUrl'); $('#inUrl').focus(); };
$('#bUrlGo').onclick = async () => {
  const u = $('#inUrl').value.trim();
  if (!u) return;
  closeModal('mUrl');
  toast('连接中…');
  try {
    await Src.openUrl(u, $('#ckUrlLive').checked);
    afterLoad(true);
    toast($('#ckUrlLive').checked ? 'HTTP 实时跟进已启动' : '已载入');
  } catch (e) { toast('连接失败: ' + e.message, true); }
};

/* --- drag & drop --- */
const dz = $('#drop');
let dragDepth = 0;
addEventListener('dragenter', e => { e.preventDefault(); if (++dragDepth === 1) dz.classList.add('on'); });
addEventListener('dragover', e => e.preventDefault());
addEventListener('dragleave', e => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; dz.classList.remove('on'); } });
addEventListener('drop', async e => {
  e.preventDefault(); dragDepth = 0; dz.classList.remove('on');
  const it = e.dataTransfer.items && e.dataTransfer.items[0];
  if (it && it.getAsFileSystemHandle) {                       // keep live capability if possible
    try {
      const h = await it.getAsFileSystemHandle();
      if (h && h.kind === 'file') {
        toast('正在读取…');
        await Src.openHandle(h); afterLoad(true);
        toast('实时跟进已启动（拖入文件句柄）'); return;
      }
    } catch (err) { /* fall through to plain file */ }
  }
  const f = e.dataTransfer.files[0];
  if (f) await loadStatic(f);
});

/* --- live controls --- */
$('#bLive').onclick = () => {
  Src.paused = !Src.paused;
  $('#bLive').textContent = Src.paused ? '▶ 继续' : '⏸ 暂停';
  $('#bLive').classList.toggle('rec', Src.paused);
  const fb = $('#followBanner');
  if (fb.classList.contains('on')) $('#bFollowPause').textContent = Src.paused ? '▶ 继续跟随' : '⏸ 暂停跟随';
  updateStatus();
};
Bus.on('append', () => {
  OV.key = '';
  if ($('#ckFollow').checked) VP.followLatest();
  renderTagList();
  requestDraw();
  const p = $('.tab.on')?.dataset.pane;
  if (p === 'tbl' && $('#ckTblFollow').checked) {
    renderTable();
    $('#tblScroll').scrollTop = $('#vtable').clientHeight;
  } else if (p === 'txn') { TXN.key = ''; renderTxn(); }
  else if (p === 'an') scheduleAnalytics();
});
Bus.on('reset', () => { SEL.ev = -1; SEL.line = -1; FILT.invalidate(); OV.key = ''; ADDR.rankKey = ''; toast('检测到文件被重写，已重新开始'); });
Bus.on('srcerr', m => toast('轮询错误: ' + m, true));

/* --------------------------- schema modal ------------------------------- */
$('#bSchema').onclick = () => { $('#taSchema').value = JSON.stringify(SCHEMA, null, 2); openModal('mSchema'); };
$('#bSchemaSave').onclick = () => {
  try {
    SCHEMA = JSON.parse($('#taSchema').value);
    localStorage.setItem('trace.schema', JSON.stringify(SCHEMA));
    closeModal('mSchema'); renderDetail(); refreshActivePane();
    toast('字段语义已保存');
  } catch (e) { alert('JSON 解析失败：' + e.message); }
};
$('#bSchemaReset').onclick = () => { $('#taSchema').value = JSON.stringify(DEFAULT_SCHEMA, null, 2); };

/* ------------------------------- help ----------------------------------- */
$('#bHelp').onclick = () => { $('#helpBody').innerHTML = HELP_HTML; openModal('mHelp'); };

/* ------------------------------- about ---------------------------------- */
$('#bAbout').onclick = () => { renderAbout(); openModal('mAbout'); };
function renderAbout() {
  $('#aboutVer').textContent = 'v' + APP_VERSION;
  $('#aboutBody').innerHTML = `
    <div class="aboutp">
      <b>Memory Trace Pipeline Viewer</b> — CPU 访存 trace 流水线可视化 / 实时跟进工具。
      把 <code>Time;Tag;K:V;…</code> 格式的仿真访存 trace 以流水泳道呈现
      LSU → L2C → 预取器 → 总线 的完整数据流，可随仿真器写入实时跟进（全程只读）。
    </div>
    <div class="dsec">版本与变更记录</div>
    <div id="changelog">${APP_CHANGELOG.map(c => `
      <div class="rel">
        <div class="relh"><span class="rv">v${esc(c.v)}</span><span class="rd">${esc(c.date)}</span></div>
        <ul>${c.items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>`).join('')}</div>
    <div class="dsec">文档</div>
    <div class="aboutp">开发文档、使用说明、特性说明与变更记录见交付目录下的
      <code>DEV.md</code> / <code>USAGE.md</code> / <code>FEATURES.md</code> / <code>CHANGELOG.md</code>。</div>`;
}
const HELP_HTML = `
<h5>trace 格式</h5>
每行一个事件：<code>&lt;时间&gt;;&lt;Tag&gt;;KEY:VAL;KEY:VAL;…</code>，例如
<code>105850000;BIU_PAD_AR;ADDL:0000000000;PC:0000;…</code>。
解析器完全按数据驱动：任何新的 Tag 与字段都会自动出现在泳道与表格里，无需改代码。
<code>ADDL</code>（cacheline 首地址）是串起整条流水的主键，<code>PC</code>、<code>IID</code> 用于关联指令。

<h5>三种打开方式</h5>
<table>
<tr><th>方式</th><th>是否实时</th><th>要求</th></tr>
<tr><td>📡 打开并实时跟进</td><td>是，增量读取新追加的行</td><td>页面运行在 https 或 localhost（用 <code>serve.py</code> 起服务）</td></tr>
<tr><td>🌐 URL</td><td>是，HTTP Range 轮询</td><td>服务器支持范围请求</td></tr>
<tr><td>📂 载入文件 / 拖拽</td><td>否，一次性</td><td>任意环境，含 <code>file://</code></td></tr>
</table>
全程<b>只读</b>：只调用只读文件句柄与 GET 请求，绝不会写回 trace 文件，不影响仿真器。
若仿真器把文件截断重写，前端会自动检测并从头开始。

<h5>视图</h5>
<b>🔗 流水线</b>　横轴时间、纵轴按 CORE → L2 → PF → BUS 分组的泳道。
同一 cacheline 的相邻事件之间画带箭头的连线，于是一次访存如何从 LSU 流到 L2、触发预取、发到总线、再写回，一眼可见。
顶部密度条是全局缩略图，拖动即可定位。<br>
<b>📈 地址-时间</b>　横轴时间、纵轴 cacheline 地址。步幅/流式访问会呈现为斜线；预取点（三角）跑在需求点前面多远，直接反映及时性。<br>
<b>🧾 事务生命周期</b>　按 cacheline 聚合成事务，给出预取提前量、发起→总线、总线→写回等延迟，可排序、可导出 CSV。<br>
<b>📊 分析</b>　预取准确率/覆盖率/及时性、总线流量、热点 PC 与 cacheline、每 PC 步幅分布、各类延迟直方图。

<h5>操作</h5>
<table>
<tr><th>操作</th><th>效果</th></tr>
<tr><td>滚轮</td><td>以光标为锚缩放时间轴</td></tr>
<tr><td>Ctrl+滚轮（地址视图）</td><td>缩放地址轴</td></tr>
<tr><td>Shift+滚轮（流水线）</td><td>纵向滚动泳道</td></tr>
<tr><td>拖拽</td><td>平移</td></tr>
<tr><td>Shift+拖拽（流水线）</td><td>框选时间区间并放大</td></tr>
<tr><td>单击事件</td><td>选中；高亮其 cacheline 的全部流水事件</td></tr>
<tr><td>双击</td><td>全览</td></tr>
<tr><td><kbd>+</kbd> <kbd>-</kbd> <kbd>←</kbd> <kbd>→</kbd></td><td>缩放 / 平移</td></tr>
<tr><td><kbd>F</kbd> / <kbd>L</kbd></td><td>全览 / 跳到最新 2000 周期</td></tr>
<tr><td><kbd>/</kbd></td><td>聚焦搜索框</td></tr>
<tr><td><kbd>Esc</kbd></td><td>清除选中</td></tr>
</table>

<h5>搜索语法</h5>
支持 <code>pc=1e88</code>、<code>addr=00000ede00</code>、<code>iid=05</code>、<code>tag=L2C</code>，或直接输入任意子串做全字段匹配。

<h5>字段语义（⚙）</h5>
TYPE / RESP / SRC 这类编码的含义随 RTL 而变，工具内置的默认解释是<b>基于数据统计的推测</b>。
点 ⚙ 可用 JSON 定义每个字段的进制、one-hot 位名和枚举值；保存后详情面板与分析页会用你的定义显示。配置存在浏览器本地。

<h5>时间轴</h5>
时钟周期由相邻时间戳差值的众数自动推断（本 trace 为 100000 tick），可在左栏「周期长度」手动修正；
X 轴可切换为周期数或实际时间。`;

/* ---------------------------- demo data --------------------------------- */
function genDemo() {
  const L = [];
  let t = 100000000;
  const P = 100000;
  const push = (dt, s) => { t += dt * P; L.push(`${String(t).padStart(22)};${s}`); };
  const hx = (v, w) => (v >>> 0).toString(16).padStart(w, '0');
  const h40 = v => v.toString(16).padStart(10, '0');

  let base = 0x2000, pfAhead = 0;
  for (let iter = 0; iter < 620; iter++) {
    for (let j = 0; j < 8; j++) {
      const addr = base + j * 64;
      const line = addr & ~63;
      const iid = (iter * 8 + j) & 0x7f;
      const pc = 0x1ea8;
      push(1, `LSU_LD_PIPE3;PC:${hx(pc, 4)};PREG:${hx((iid % 60) + 1, 2)};ADDL:${h40(line)};ADDB:${h40(addr & ~15)};ABYTE:${h40(addr)};IID:${hx(iid, 2)};LCHe:001;SRC0:${h40(addr).padStart(16, '0')};SRC1:0000000000000000;OFF:000;`);
      const miss = (j === 0);
      push(1, `L2C_CMP;ADDL:${h40(line)};SID:${hx(iter % 32, 2)};TYPE:0010;SRC:00;CLCP:0;STCP:0;FATA:0;WRAW:0;HPCP:${miss ? 1 : 0};MID:0;FROM:5;PC:${hx(pc, 4)};CP:0;RESP:${miss ? '00001' : '10101'};STAL:${miss ? 1 : 0};WRIT:0;`);
      if (miss) {
        push(1, `L2_TriPF;ADDL:${h40(line)};PC:${hx(pc, 4)};REQS:02;`);
        pfAhead = line + 64 * 4;
        push(1, `TriPF_L2;ADDL:${h40(pfAhead)};REQS:1;READY:${Math.random() < .1 ? 0 : 1};`);
        push(2, `BIU_PAD_AR;USER:2;SNOP:1;SIZE:4;PROT:3;LOCK:0;LENG:3;ARID:${hx(iter % 24, 2)};DOMA:1;CACH:f;BURS:2;BARR:2;ADDL:${h40(line)};ADDB:${h40(line)};ADDR:${h40(line)};FROM:3;PC:${hx(pc, 4)};`);
        push(18 + Math.floor(Math.random() * 26), `LSU_LD_WB_pg;FROM:RB;PREG:${hx((iid % 60) + 1, 2)};ADDL:${h40(line)};ADDB:${h40(addr & ~15)};ABYTE:${h40(addr)};DATA:${h40(addr ^ 0x5a5a)};IID:${hx(iid, 2)};`);
      } else {
        push(1, `LSU_LD_DA_fwd;PC:${hx(pc, 4)};PREG:${hx((iid % 60) + 1, 2)};ADDL:${h40(line)};ADDB:${h40(addr & ~15)};ABYTE:${h40(addr)};DATA:${h40(addr ^ 0x5a5a)};IID:${hx(iid, 2)};`);
        push(1, `LSU_LD_WB_pg;FROM:DA;PREG:${hx((iid % 60) + 1, 2)};ADDL:${h40(line)};ADDB:${h40(addr & ~15)};ABYTE:${h40(addr)};DATA:${h40(addr ^ 0x5a5a)};IID:${hx(iid, 2)};`);
      }
      if (j % 3 === 2) {
        const sa = 0x40000 + iter * 32 + j * 8;
        push(1, `LSU_ST_PIPE4;PC:1e88;CODE:00f72023;TYPE:0;SIZE:2;MODE:0;ATOM:0;ADDL:${h40(sa & ~63)};ADDB:${h40(sa & ~15)};ABYTE:${h40(sa)};IID:${hx((iid + 3) & 0x7f, 2)};LCHe:002;SDIQ:001;MMUr:1;`);
        push(1, `L2C_CMP;ADDL:${h40(sa & ~63)};SID:${hx((iter + 7) % 32, 2)};TYPE:0040;SRC:00;CLCP:0;STCP:1;FATA:0;WRAW:1;HPCP:0;MID:0;FROM:6;PC:1e88;CP:0;RESP:10001;STAL:0;WRIT:1;`);
        if (iter % 5 === 0) push(2, `BIU_PAD_AW;ADDL:${h40(sa & ~63)};ADDB:${h40(sa & ~15)};ADDR:${h40(sa & ~15)};BARR:0;BURS:1;CACH:f;DOMA:1;AWID:0b;LENG:3;LOCK:0;PROT:3;SIZE:4;SNOP:1;UNIQ:0;USER:1;FROM:6;PC:1e88;`);
      }
    }
    base += 512;
    if (iter % 90 === 89) base = 0x2000 + ((iter / 90) | 0) * 0x8000;   // stream restart
  }
  return L.join('\n') + '\n';
}
$('#wDemo').onclick = async () => {
  toast('生成示例数据…');
  $('#welcome').classList.add('hide');
  Src.clear(); S.reset();
  Src.kind = 'static'; Src.name = 'demo_trace.txt';
  const txt = genDemo();
  Src.size = txt.length; Src.offset = txt.length;
  parseChunk(txt);
  S.bytes = txt.length;
  afterLoad(true);
  toast(`示例数据已生成 · ${fmtInt(S.n)} 条事件`);
};

/* ------------------------------ boot ------------------------------------ */
/* expose internals for DevTools poking: TV.S / TV.FILT / TV.VP … */
window.TV = { S, VP, FILT, SEL, Src, Bus, LANES: () => LANES, buildTxns, txnClass,
  get schema() { return SCHEMA; }, redraw: requestDraw, version: APP_VERSION };
window.S = S;                      // convenience alias

/* version stamping */
document.title = `Memory Trace Pipeline Viewer v${APP_VERSION}`;
$('#verBadge').textContent = 'v' + APP_VERSION;
$('#stVer').textContent = 'v' + APP_VERSION;
$('#aboutVer').textContent = 'v' + APP_VERSION;

new ResizeObserver(() => requestDraw()).observe($('#panes'));
addEventListener('resize', () => requestDraw());
renderTagList();
updateStatus();
setInterval(() => { if (Src.live) updateStatus(); }, 1000);

/* auto-connect: ?url=… &live=1 */
(async () => {
  const q = new URLSearchParams(location.search);
  const u = q.get('url') || q.get('trace');
  if (u) {
    $('#welcome').classList.add('hide');
    toast('连接 ' + u + ' …');
    try { await Src.openUrl(u, q.get('live') !== '0'); afterLoad(true); toast('已连接'); }
    catch (e) { toast('连接失败: ' + e.message, true); $('#welcome').classList.remove('hide'); }
  }
})();
requestDraw();
