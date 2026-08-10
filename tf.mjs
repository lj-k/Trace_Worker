// tf.mjs — 极简前端测试框架（零依赖，基于 Playwright）
// 提供：Suite（用例收集+执行+Markdown 报告）、断言助手、下载拦截与 SVG 导出助手。
export class Suite {
  constructor(name){ this.name=name; this.cases=[]; }
  test(name, fn){ this.cases.push({ name, fn }); return this; }
  async run(page){
    const results=[];
    for(const c of this.cases){
      const t0=Date.now();
      try{ await c.fn(page); results.push({ name:c.name, ok:true, ms:Date.now()-t0, err:null }); }
      catch(e){ results.push({ name:c.name, ok:false, ms:Date.now()-t0, err:(e&&e.message)||String(e) }); }
    }
    this.results=results; return results;
  }
  summary(){ const p=this.results.filter(r=>r.ok).length; return { pass:p, fail:this.results.length-p, total:this.results.length }; }
  markdown(extra){
    const s=this.summary();
    let md=`# 前端测试报告 · ${this.name}\n\n`;
    md+=`- 结果：**通过 ${s.pass} / 失败 ${s.fail} / 总计 ${s.total}**\n`;
    md+=`- 执行时间：${new Date().toLocaleString()}\n`;
    if(extra) md+=`- 备注：${extra}\n`;
    md+='\n| # | 测试用例 | 结果 | 耗时 | 说明 |\n|---|---|---|---|---|\n';
    this.results.forEach((r,i)=>{
      md+=`| ${i+1} | ${r.name} | ${r.ok?'✅ 通过':'❌ 失败'} | ${r.ms}ms | ${r.ok?'—':r.err} |\n`;
    });
    return md;
  }
}

// ---- 断言助手 ----
export function assert(cond, msg){ if(!cond) throw new Error(msg||'断言失败'); }
export function ok(cond, msg){ assert(cond, msg); }
export function eq(a,b,msg){ if(a!==b) throw new Error((msg?msg+' ':'')+`期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`); }
export function gt(a,b,msg){ if(!(a>b)) throw new Error((msg?msg+' ':'')+`期望 > ${b}，实际 ${a}`); }

// ---- 下载拦截：覆盖 <a>.click，把下载记录到 window.__dl ----
export async function setupDownloads(page){
  await page.evaluate(()=>{
    window.__dl=[];
    const oc=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){ window.__dl.push({ name:this.download, href:this.href }); return oc.apply(this, arguments); };
  });
}

// ---- 触发 SVG 导出并取回内容做校验 ----
// 返回 { ok, name, wf(良构), hasImg(<image>数), hasPath, hasText, hasRect, hasFO, txt }
export async function exportSvg(page, mode){
  return await page.evaluate(async (mode)=>{
    window.__dl=[];
    document.querySelector('#pngMode').value=mode;
    document.querySelector('#btnSvg').click();
    await new Promise(r=>setTimeout(r,600));
    const last=window.__dl.filter(d=>d.name.endsWith('.svg')).pop();
    if(!last) return { ok:false };
    const txt=await (await fetch(last.href)).text();
    const doc=new DOMParser().parseFromString(txt,'image/svg+xml');
    const perr=doc.querySelector('parsererror');
    return {
      ok:true, name:last.name,
      wf:!perr,
      hasImg:doc.getElementsByTagName('image').length,
      hasPath:txt.includes('<path'),
      hasText:txt.includes('<text'),
      hasRect:txt.includes('<rect'),
      hasFO:txt.includes('foreignObject'),
      txt
    };
  }, mode);
}

// ---- 触发 PNG 导出并取回尺寸 ----
export async function exportPngSize(page, mode){
  return await page.evaluate(async (mode)=>{
    window.__dl=[];
    document.querySelector('#pngMode').value=mode;
    document.querySelector('#btnPng').click();
    await new Promise(r=>setTimeout(r,800));
    const last=window.__dl.filter(d=>d.name.endsWith('.png')).pop();
    if(!last) return { ok:false };
    const blob=await (await fetch(last.href)).blob();
    return { ok:true, name:last.name, bytes:blob.size };
  }, mode);
}
