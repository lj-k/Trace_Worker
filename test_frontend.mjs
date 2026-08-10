import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
import { Suite, assert, ok, eq, gt, setupDownloads, exportSvg, exportPngSize } from './tf.mjs';

const TRACE='/root/uploads/1785823039623993868-trace.txt';
const HTML='/workspace/trace-pipeline-viewer.html';

const b=await chromium.launch({headless:true});
const ctx=await b.newContext({viewport:{width:1600,height:900}});
const page=await ctx.newPage();
const errs=[];
page.on('pageerror',e=>errs.push('PAGEERR: '+(e.stack||e.message)));
page.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });

const suite=new Suite('trace-pipeline-viewer 前端完整回归（v0.06.10）');

// 加载 trace
await page.goto('file://'+HTML); await page.waitForTimeout(150);
await page.evaluate(async(t)=>{const dt=new DataTransfer();dt.items.add(new File([new Blob([t])],'x.txt'));document.getElementById('filePick').files=dt.files;document.getElementById('filePick').dispatchEvent(new Event('change'));},readFileSync(TRACE,'utf-8'));
await page.waitForFunction(()=>typeof S!=='undefined'&&S.raw&&S.raw.length>0,{timeout:8000});
await setupDownloads(page);

// A. 启动
suite.test('启动后全局对象 S 已加载且 trace 解析成功', async(pg)=>{
  const n=await pg.evaluate(()=>S.raw.length);
  gt(n,0,'S.raw 应为非空');
});

// B. 6 个视图切换
for(const p of ['timeline','pipeline','table','stats','dict','access']){
  suite.test('切换视图到 '+p+' 生效（仅目标 pane 为 on）', async(pg)=>{
    await pg.evaluate(pp=>switchPane(pp),p);
    await pg.waitForTimeout(80);
    const r=await pg.evaluate(pp=>{
      const on=document.querySelector('.pane[data-p="'+pp+'"]').classList.contains('on');
      const others=[...document.querySelectorAll('.pane')].filter(t=>t.dataset.p!==pp&&t.classList.contains('on')).length;
      return {pane:S.pane, on, others};
    },p);
    eq(r.pane,p);
    assert(r.on,'目标 pane 应为 on');
    eq(r.others,0,'不应有其它 pane 同时为 on');
  });
}

// C. 关于弹窗（本轮修复重点）
suite.test('关于弹窗[加载态]：可打开、内容无真实 canvas/svg、关闭按钮最顶层、点击可关闭', async(pg)=>{
  await pg.click('#btnAbout'); await pg.waitForTimeout(150);
  const open=await pg.evaluate(()=>document.getElementById('aboutModal').classList.contains('on'));
  assert(open,'应已打开');
  const rogue=await pg.evaluate(()=>document.querySelectorAll('#aboutBody canvas,#aboutBody svg').length);
  eq(rogue,0,'关于内容不应含真实 canvas/svg（changelog 已转义）');
  const topClose=await pg.evaluate(()=>{const btn=document.getElementById('aboutClose');const r=btn.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===btn;});
  assert(topClose,'关闭按钮应为最顶层、可被点击');
  await pg.click('#aboutClose'); await pg.waitForTimeout(120);
  const closed=await pg.evaluate(()=>!document.getElementById('aboutModal').classList.contains('on'));
  assert(closed,'点击关闭后应关闭');
});
suite.test('关于弹窗[初始未加载页]：层次正确（modal z > loader z）、关闭按钮最顶层、可关闭', async(pg)=>{
  const p2=await pg.context().newPage(); await p2.setViewportSize({width:1600,height:900});
  await p2.goto('file://'+HTML); await p2.waitForTimeout(150);
  await p2.click('#btnAbout'); await p2.waitForTimeout(150);
  const r=await p2.evaluate(()=>{
    const on=document.getElementById('aboutModal').classList.contains('on');
    const mz=parseInt(getComputedStyle(document.getElementById('aboutModal')).zIndex);
    const lz=parseInt(getComputedStyle(document.getElementById('loader')).zIndex);
    const loaderVisible=!document.getElementById('loader').classList.contains('hide');
    const btn=document.getElementById('aboutClose'); const br=btn.getBoundingClientRect();
    const topClose=document.elementFromPoint(br.x+br.width/2,br.y+br.height/2)===btn;
    return {on,mz,lz,loaderVisible,topClose};
  });
  assert(r.on,'初始页应可打开关于');
  gt(r.mz,r.lz,'关于弹窗 z-index 应高于加载遮罩（修复初始页遮挡）');
  assert(r.topClose,'初始页关闭按钮应为最顶层');
  await p2.click('#aboutClose'); await p2.waitForTimeout(120);
  const closed=await p2.evaluate(()=>!document.getElementById('aboutModal').classList.contains('on'));
  assert(closed,'初始页点击关闭后应关闭');
  await p2.close();
});
suite.test('关于弹窗：关闭后可再次打开', async(pg)=>{
  await pg.click('#btnAbout'); await pg.waitForTimeout(100);
  await pg.click('#aboutClose'); await pg.waitForTimeout(100);
  await pg.click('#btnAbout'); await pg.waitForTimeout(100);
  const open=await pg.evaluate(()=>document.getElementById('aboutModal').classList.contains('on'));
  assert(open,'再次打开应成功');
  await pg.click('#aboutClose'); await pg.waitForTimeout(100);
  const closed=await pg.evaluate(()=>!document.getElementById('aboutModal').classList.contains('on'));
  assert(closed,'再次关闭应成功');
});

// D. 悬浮提示（无原生 title / 无闪烁 / 层次正确）
suite.test('交互元素无原生 title（已清除，避免原生 tooltip 闪烁）', async(pg)=>{
  await pg.evaluate(()=>{switchPane('stats');}); await pg.waitForTimeout(150);
  await pg.evaluate(()=>{switchPane('dict');}); await pg.waitForTimeout(150);
  const n=await pg.evaluate(()=>{const sel='button,input,select,textarea,.tab,.tagrow,.chip,.sec>h3,a[href],.lgi,.vtrow,.card,.kv';return [...document.querySelectorAll(sel)].filter(el=>el.title).length;});
  eq(n,0,'不应有原生 title');
});
suite.test('悬浮 #btnSvg 显示 #tip，且 #tip pointer-events:none（不拦截点击）', async(pg)=>{
  await pg.hover('#btnSvg'); await pg.waitForTimeout(120);
  const r=await pg.evaluate(()=>{const t=document.getElementById('tip');const cs=getComputedStyle(t);return {disp:cs.display,pe:cs.pointerEvents,txt:t.textContent};});
  assert(r.disp!=='none','#tip 应显示');
  assert(/SVG/.test(r.txt),'#tip 文本应包含 SVG 说明');
  eq(r.pe,'none','#tip 必须 pointer-events:none 以免拦截点击');
  const title=await pg.evaluate(()=>document.getElementById('btnSvg').title);
  eq(title,'','悬浮后按钮不应有原生 title（不会触发整窗闪烁）');
});
suite.test('层次：#tip z-index < .modal z-index（弹窗始终在最上）', async(pg)=>{
  const r=await pg.evaluate(()=>({tip:parseInt(getComputedStyle(document.getElementById('tip')).zIndex),modal:parseInt(getComputedStyle(document.getElementById('aboutModal')).zIndex)}));
  gt(r.modal,r.tip,'关于弹窗应高于悬浮提示');
});

// E. SVG 导出（真矢量 + 良构 + 无重复 viewBox）
// 每个用例内部先切回有画布的 timeline 视图，使 full/crop 走单画布矢量路径（恰好 1 个根 <svg> viewBox）；
// 若停留在无画布的 pane（如 dict），exportCanvasSvg 会回退到整页导出（foreignObject 含多个画布 → 多个 viewBox），属正常行为。
for(const mode of ['page','full','crop']){
  suite.test('SVG 导出['+mode+']：XML 良构 + 真矢量（无 <image>）+ 含矢量图元', async(pg)=>{
    await pg.evaluate(()=>{ if(S.pane!=='timeline') switchPane('timeline'); });
    const r=await exportSvg(pg,mode);
    assert(r.ok,'应成功导出 '+mode);
    assert(r.wf,'XML 应良构（无 parsererror）');
    eq(r.hasImg,0,mode+' 不应含位图 <image>（须为真矢量）');
    assert(r.hasPath||r.hasText||r.hasRect,mode+' 应包含矢量图元');
  });
}
suite.test('SVG 导出：full/crop 的 viewBox 仅出现一次（无重复属性 bug）', async(pg)=>{
  await pg.evaluate(()=>{ if(S.pane!=='timeline') switchPane('timeline'); });
  for(const mode of ['full','crop']){
    const r=await exportSvg(pg,mode);
    const cnt=(r.txt.match(/viewBox=/g)||[]).length;
    eq(cnt,1,mode+' 的 viewBox 应只出现一次，实际 '+cnt);
  }
});

// F. PNG 导出（回归）
suite.test('PNG 导出[page]：成功生成非空 PNG', async(pg)=>{
  const r=await exportPngSize(pg,'page');
  assert(r.ok,'应导出 page PNG');
  gt(r.bytes,1000,'PNG 不应为空');
});
suite.test('PNG 导出[crop]：有效区域小于整张画布（去空白）', async(pg)=>{
  const r=await pg.evaluate(()=>{
    if(S.pane!=='access')switchPane('access');
    accResize();accRender();
    const cv=activeCanvas(); const rect=tightCropRect(cv);
    return {fullW:cv.width, fullH:cv.height, cropW:rect?rect.w:0, cropH:rect?rect.h:0};
  });
  gt(r.fullW,0); gt(r.cropW,0);
  assert(r.cropW<r.fullW && r.cropH<r.fullH,'有效区域应小于整张画布');
});

// G. 预取统计
suite.test('统计分析面板包含预取相关指标', async(pg)=>{
  await pg.evaluate(()=>switchPane('stats')); await pg.waitForTimeout(200);
  const txt=await pg.evaluate(()=>document.getElementById('statsBody').textContent);
  assert(/预取/.test(txt),'统计面板应包含预取相关文本');
  assert(/及时有用|及时/.test(txt),'应包含及时有用预取指标');
});

// H. 无运行时错误（收尾）
suite.test('全程无 pageerror / console error', async()=>{
  assert(errs.length===0, errs.slice(0,4).join(' | '));
});

const results=await suite.run(page);
const md=suite.markdown('覆盖：启动 / 6 视图切换 / 关于弹窗(加载态+初始态+重复开关) / 悬浮提示(无原生title·不拦截·层次) / SVG 三模式矢量导出(良构·无image·viewBox唯一) / PNG 导出 / 预取统计。');
writeFileSync('/workspace/前端测试报告.md', md);
console.log(md);
await b.close();
process.exit(suite.summary().fail?1:0);
