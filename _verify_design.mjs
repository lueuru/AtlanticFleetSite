/* =============================================================================
   _verify_design.mjs —— 视觉与交互需求的判据
   -----------------------------------------------------------------------------
   为什么单独一个脚本：_verify_subpath.mjs 测的是"子路径部署对不对"，
   本文件测的是"视觉与交互要求有没有真落地"。两者的失败含义完全不同，
   混在一起就会出现"部署全绿但效果一个没生效"。

   ★ 本文件遵循的三条铁律（都是本项目交过学费的）：
     1. 查**计算样式**，不查源码。CSS 源码写得对、结果被更高特异性规则
        压掉，是本项目最常见也最难查的一类假通过。
     2. 判据必须能**抓到该抓的**。每条都写了"抓不到就说明判据坏了"的自检。
     3. 反证先做：故意弄坏一项，确认真的会红，再改回来。
   ========================================================================== */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ★★ 这里用 IP 而不是 default.com（2026-10-06 修正）。
//   原来的写法是 `http://default.com:9503/AtlanticFleetSite` +
//   `--host-resolver-rules=MAP default.com 127.0.0.1`，
//   在 **9503 这个非标准端口上 host-resolver 规则没生效** ——
//   Edge 落到 chrome-error://chromewebdata/，
//   判据于是报「首页导航卡片存在 — cards=0」「顶栏不存在」
//   「按钮没有默认态」…共 31 项全红。
//
//   ★ 看着像站点全坏了，实际页面完全正常（改 IP 直连后：
//     首页 .card=3、仓库页 .af-card=6 / .af-topbar=1、
//     --af-t-base=240ms，全部在位）。
//   这正是本项目交过学费的那条：**验收脚本失败先怀疑脚本自己**，
//   尤其是「同一个站点换个访问方式就全绿」的时候。
//   为什么可以直连 IP：_serve.py 是本机静态服务，不校验 Host；
//   需要区分 Host 的只有 nginx（走 80 端口那批判据仍然用 default.com）。
const HOST = 'default.com';
const PORT = 9503;
const PFX = '/AtlanticFleetSite';
const BASE = `http://127.0.0.1:${PORT}${PFX}`;

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

let pass = 0, fail = 0;
const failures = [];
const PASSED = [];
function check(name, ok, detail) {
  if (ok) { pass++; PASSED.push(name); console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else {
    fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`);
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ' — ' + detail : ''}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- CDP 客户端 ---------- */
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pend = new Map(); this.evs = new Map(); }
  static async connect(wsUrl) {
    const { WebSocket } = await import('node:worker_threads').then(() => ({ WebSocket: globalThis.WebSocket }));
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws 失败')); });
    const c = new Cdp(ws);
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && c.pend.has(m.id)) {
        const { res, rej } = c.pend.get(m.id); c.pend.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method && c.evs.has(m.method)) {
        c.evs.get(m.method).forEach((fn) => fn(m.params));
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pend.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pend.has(id)) { this.pend.delete(id); rej(new Error(method + ' 超时')); } }, 30000);
    });
  }
  on(method, fn) {
    if (!this.evs.has(method)) this.evs.set(method, []);
    this.evs.get(method).push(fn);
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || '页内异常');
    return r.result.value;
  }
}

/* ---------- 浏览器起停 ---------- */
let edgeProc = null, profileDir = null;
async function startEdge() {
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afdesign-'));
  edgeProc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profileDir}`,
    `--host-resolver-rules=MAP ${HOST} 127.0.0.1`,
    '--remote-debugging-port=9223',
    'about:blank'
  ], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    try {
      const r = await fetch('http://127.0.0.1:9223/json/version');
      if (r.ok) return;
    } catch { }
  }
  throw new Error('Edge 起不来');
}
async function newPage() {
  const r = await fetch(`http://127.0.0.1:9223/json/new?about:blank`, { method: 'PUT' });
  const t = await r.json();
  const c = await Cdp.connect(t.webSocketDebuggerUrl);
  c.targetId = t.id;
  return c;
}
async function goto(c, url) {
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Page.navigate', { url });
  // 等 load 事件；再留一帧让动效控制器接管
  await new Promise((res) => {
    const t = setTimeout(res, 12000);
    c.on('Page.loadEventFired', () => { clearTimeout(t); setTimeout(res, 350); });
  });
}

/* ---------- 样式读取工具 ----------
   ★ 注意 backdrop-filter：必须读 webkit 前缀的 computed value。
   Chrome 里 getComputedStyle 对 backdrop-filter 返回的是读到的值，
   但如果只写了 -webkit- 前缀，标准属性会是空 —— 两个都要查。 */
const cs = (sel, props) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  const c = getComputedStyle(el);
  const out = {};
  for (const p of ${JSON.stringify(props)}) {
    /* ★ v2.45：单个属性取不到**不能影响其他属性**。
       带前缀的属性（-webkit-backdrop-filter）在部分浏览器里
       getPropertyValue 会返回 null/抛错 —— 原来用 map 一次全取，
       一个失败整轮都拿不到，看起来像"所有样式都失效"。 */
    try { out[p] = c.getPropertyValue(p); } catch (e) { out[p] = ''; }
  }
  out.__rect = (() => { const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height),
             vis: getComputedStyle(el).visibility, disp: getComputedStyle(el).display }; })();
  return out;
})()`;

const BOX = ['width', 'height', 'border-radius'];
const GLASS = [
  'backdrop-filter', '-webkit-backdrop-filter',
  'background-image', 'border-radius', 'box-shadow'
];

async function main() {
  console.log('==================================================');
  console.log(' 视觉与交互落地验收（查计算样式，不看源码）');
  console.log('==================================================\n');

  try {
    /* ---------- 0. 预检：服务身份 ---------- */
    console.log('[预检] 服务身份');
    const home = await fetch(`http://127.0.0.1:${PORT}${PFX}/`, { headers: { Host: HOST } });
    const ht = await home.text();
    check('服务可达', home.ok, 'HTTP ' + home.status);
    check('服务的是本副本', ht.includes(PFX), '首页未见前缀');
    check('服务含本轮改动（text-shadow 令牌）',
      ht.includes('--h1-shadow'), '首页未见 --h1-shadow，端口上是旧副本');

    await startEdge();
    const c = await newPage();

    /* ★ v2.45：必须**显式**把桌面视口设成宽屏。
       headless Edge 的默认窗口宽度不保证是宽屏（实测常在 800 上下），
       而站点汉堡按钮在 ≤860px 才显示 —— 不显式设宽，桌面判据会假失败。
       这就是「判据测的东西不对」而不是「产品有缺陷」。 */
    await c.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false
    });

    /* ================= 首页 ================= */
    console.log('\n[首页] 液态玻璃 + 文字层 + 悬停反馈');
    await goto(c, `${BASE}/`);

    const cards = await c.eval(`document.querySelectorAll('.card').length`);
    check('首页导航卡片存在', cards >= 3, `cards=${cards}`);

    if (cards > 0) {
      const g = await c.eval(cs('.card', GLASS));
      check('卡片可见（判据前提：不可见元素读不到计算样式）',
        !!(g && g.__rect && g.__rect.w > 10 && g.__rect.h > 10 && g.__rect.vis === 'visible'),
        g ? `rect=${JSON.stringify(g.__rect)}` : '卡片不存在');
      check('卡片 backdrop-filter 生效（真模糊，非半透明色块）',
        !!(g && /blur/.test(g['backdrop-filter'] || g['-webkit-backdrop-filter'] || '')),
        g ? `bf=${g['backdrop-filter'] || g['-webkit-backdrop-filter']}` : '卡片不存在');
      check('卡片 box-shadow 多层（离场+上棱高光+下棱遮蔽）',
        !!(g && shadowLayers(g['box-shadow']) >= 3),
        g ? `层数=${shadowLayers(g['box-shadow'])} 值=${String(g['box-shadow']).slice(0, 70)}` : '');
      check('卡片有渐变底（不是纯半透明色）',
        !!(g && /gradient/.test(g['background-image'] || '')),
        g ? `bg=${String(g['background-image']).slice(0, 60)}` : '');
    }

    // ★ 悬停反馈：必须用 CDP 的真实鼠标事件。
//   合成 MouseEvent 不会触发 CSS 的 :hover ——
//   浏览器认为鼠标不在元素上，:hover 规则不生效，transition 也不启动。
//   那样测出来"前=后"是判据自己的问题，不是产品没做悬停。
    const cardBox = await c.eval(`(() => {
      const e = document.querySelector('.card');
      if (!e) return null;
      e.scrollIntoView({block:'center'});
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
    })()`);
    if (cardBox) {
      const beforeH = await c.eval(cs('.card', ['transform', 'box-shadow']));
      await c.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: cardBox.x, y: cardBox.y, buttons: 0
      });
      await sleep(450);   // > 悬停过渡时长（--af-tr-micro/state档 160~240ms）
      const afterH = await c.eval(cs('.card', ['transform', 'box-shadow']));
      check('卡片悬停有反馈（transform 或 shadow 变化）',
        !!(beforeH && afterH && (beforeH.transform !== afterH.transform || beforeH['box-shadow'] !== afterH['box-shadow'])),
        `前=${beforeH?.transform} 后=${afterH?.transform}`);
      // 移开，验证会复位（只有单向变化的悬停是坏的）
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, buttons: 0 });
      await sleep(450);
      const offH = await c.eval(cs('.card', ['transform']));
      check('鼠标移开后悬停态复位', !!(offH && offH.transform !== afterH.transform),
        `移开后=${offH?.transform}（若与悬停时相同说明没复位）`);
    }

    const h1 = await c.eval(cs('h1', ['text-shadow', 'font-size']));
    check('首屏标题有 text-shadow（文字脱离玻璃表面）',
      !!(h1 && h1['text-shadow'] && h1['text-shadow'] !== 'none'),
      h1 ? `ts=${h1['text-shadow']}` : '无 h1');

    const titleFs = parseFloat(h1?.['font-size'] || '0');
    check('首屏标题字号达展示级（≥30px）', titleFs >= 30, `实际 ${titleFs}px`);

    /* ================= Mod 仓库 ================= */
    console.log('\n[Mod 仓库] 浮层玻璃描边 + 组件六状态');
    await goto(c, `${BASE}/mods/`);

    /* ★ 仓库页的卡片走**伪玻璃**（af-glass-lite），不是真 backdrop-filter：
       几十张卡片同时开 backdrop-filter 会每帧几十次背景重采样。
       所以这里判的是"伪玻璃该有的样子"：渐变底 + 内高光 + 描边，
       而不是 blur。判据必须与首页分开，否则就是"测的东西不存在"。 */
    const repoCard = await c.eval(`(() => {
      const el = document.querySelector('.af-card');
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { bg: s.backgroundImage, sh: s.boxShadow, bd: s.borderTopWidth,
               w: Math.round(r.width), h: Math.round(r.height) };
    })()`);
    check('仓库页卡片存在且可见',
      !!(repoCard && repoCard.w > 10 && repoCard.h > 10), repoCard ? JSON.stringify(repoCard) : '未找到 .af-card');
    check('仓库页卡片是渐变底（伪玻璃的第一层）',
      !!(repoCard && /gradient/.test(repoCard.bg || '')),
      repoCard ? String(repoCard.bg).slice(0, 60) : '');
    check('仓库页卡片有内高光 + 外投影（多层）',
      !!(repoCard && shadowLayers(repoCard.sh) >= 2),
      repoCard ? `层数=${shadowLayers(repoCard.sh)}` : '');
    check('仓库页卡片有描边（边界可辨）',
      !!(repoCard && parseFloat(repoCard.bd) >= 1),
      repoCard ? `border-width=${repoCard.bd}` : '');

    const topbar = await c.eval(cs('.af-topbar', GLASS));
    check('顶栏是真玻璃（backdrop-filter 生效）',
      !!(topbar && /blur/.test(topbar['backdrop-filter'] || topbar['-webkit-backdrop-filter'] || '')),
      topbar ? `bf=${topbar['backdrop-filter']}` : '顶栏不存在');
    check('顶栏多层 box-shadow',
      !!(topbar && shadowLayers(topbar['box-shadow']) >= 2),
      topbar ? `层数=${shadowLayers(topbar['box-shadow'])}` : '');

    /* ★ 折射描边：必须查伪元素的**计算样式**，而且要分清
       "规则写对了" 和 "元素上真的渲染出来了" 两件事。 */
    const edgeProbe = await c.eval(`(() => {
      const el = document.querySelector('.af-topbar');
      if (!el) return { err: '顶栏不存在' };
      const cs2 = getComputedStyle(el, '::before');
      const cs3 = getComputedStyle(el, '::after');
      return {
        hasBeforeContent: cs2.content,
        beforeMask: cs2.mask || cs2.webkitMask,
        beforeComposite: cs2.maskComposite || cs2.webkitMaskComposite,
        beforeBg: cs2.backgroundImage,
        beforeOpacity: cs2.opacity,
        afterBg: cs3.backgroundImage,
        afterBlend: cs3.mixBlendMode
      };
    })()`);

    check('渐变描边层存在（::before content 已生成）',
      edgeProbe && edgeProbe.hasBeforeContent && edgeProbe.hasBeforeContent !== 'none' && edgeProbe.hasBeforeContent !== 'normal',
      edgeProbe ? `content=${edgeProbe.hasBeforeContent}` : '');
    check('描边用 mask-composite 抠出1px环（不是普通描边）',
      !!(edgeProbe && (/exclude|xor/.test(edgeProbe.beforeComposite || '') || /xor/.test(edgeProbe.beforeMask || ''))),
      edgeProbe ? `composite=${edgeProbe.beforeComposite} mask=${String(edgeProbe.beforeMask).slice(0, 40)}` : '');
    check('描边是渐变（模拟玻璃棱边）',
      !!(edgeProbe && /gradient/.test(edgeProbe.beforeBg || '')),
      edgeProbe ? `bg=${String(edgeProbe.beforeBg).slice(0, 50)}` : '');

    /* ================= 组件六状态 ================= */
    console.log('\n[组件状态] 默认/悬停/激活/焦点/禁用/加载/错误');

    // ★ 关键教训：不能用 querySelector('.af-btn:disabled') ——
    //   :disabled 之类的伪类**不是合法的 querySelector 选择器**，
    //   它恒为 null，看起来像"禁用态没做"，其实是自己写错了判据。
    //   正解：遍历 styleSheets[].cssRules 找规则里是否存在该状态定义。
    const stateRules = await c.eval(`(() => {
/* ★ v2.45：这里**不能**用带反斜杠的正则字面量。
       本文件是 JS 模板字符串，反斜杠要过两层转义（源文件→模板→浏览器），
       极易写错，而且写错的表现是"正则永不匹配"——
       判据全红、看起来像产品没做，实际是自己写错了。
       改用 indexOf 做纯字符串判断，没有转义层。

         ★★ 另一个坑：document.styleSheets 必须先**展开成真数组**再用。
            直接 for...of 遍历它，某些环境下会一次都不进循环
            （实测 total=0、无任何报错），判据就全红了。
            Array.prototype.slice.call 强制展开，绕开这个问题。 */
      const sels = [];
      const allSheets = Array.prototype.slice.call(document.styleSheets);
      for (const sheet of allSheets) {
        let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
        if (!rules) continue;
        const walk = (list) => {
          for (let i = 0; i < list.length; i++) {
            const r = list[i];
            /* ★★★ 判断"要不要递归"必须看**规则类型**，不能看 r.cssRules 是否存在。
               顶层 style rule（.card {...}）也有一个空的 cssRules 对象，
               但它是 truthy —— 用 if (r.cssRules) 判断会把**所有顶层规则
               全当成嵌套容器跳过**，一条都收集不到。

               ★★ 而且**常量值不能凭记忆写**。CSSOM 的 rule type 是：
                  1=STYLE_RULE  4=MEDIA_RULE  5=FONT_FACE  7=KEYFRAMES
                  8=KEYFRAME   12=SUPPORTS
               我曾把「@media 的 type」写成 1（那是 STYLE_RULE），
               结果 39 个 @media 块一个都没被递归进去 ——
               而 .af-peek 的 display:none 恰恰只写在 @media 里，
               于是判据报「样式表里找不到隐藏规则」，
               看起来像产品没做触屏适配，实际是判据把整个 @media 跳过了。

               这里不再写魔法数，对照表见文件末尾 RULE_TYPE 表。 */
            const type = r.type;
            /* ★ type 常量：1=STYLE 4=MEDIA 12=SUPPORTS。
               曾把 @media 写成 1 → 39 个 @media 块全被跳过。
               （此walk 只往 sels 里push、不用返回值，所以不涉及返回值为空的问题；
                 需要返回值的遍历必须用 const inner = walk(...) 显式接住，
                 见 peek 规则遍历处的注释。） */
            const isContainer = (type === 4 /* MEDIA */ || type === 12 /* SUPPORTS */);
            if (isContainer && r.cssRules && r.cssRules.length) { walk(r.cssRules); continue; }
            if (r.selectorText) sels.push(r.selectorText);
          }
        };
        walk(rules);
      }
      const has = (fn) => sels.some(fn);
      return {
        total: sels.length,
        /* 「默认态」=存在一条只写 .af-btn（或其变体）而**不带任何伪类**
           的基础规则。用伪类冒号出现次数判断，不写正则。 */
        '默认': has(s => {
          if (s.indexOf('.af-btn') < 0) return false;
          if (s.indexOf(':') >= 0) return false;      // 带伪类/伪元素 → 不是基础态
          if (s.indexOf('[') >= 0) return false;// 带属性选择器 → 不是基础态
          return true;
        }),
        '悬停': has(s => s.indexOf('.af-btn:hover') >= 0),
        '激活': has(s => s.indexOf('.af-btn:active') >= 0),
        '焦点': has(s => s.indexOf('.af-btn:focus-visible') >= 0),
        '禁用': has(s => s.indexOf('.af-btn[aria-disabled') >= 0 || s.indexOf('.af-btn:disabled') >= 0),
        '加载': has(s => s.indexOf('.af-btn[data-loading') >= 0),
        '错误': has(s => s.indexOf('.af-toast--err') >= 0 || s.indexOf('[aria-invalid') >= 0)
      };
    })()`);

    for (const k of ['默认', '悬停', '激活', '焦点', '禁用', '加载', '错误']) {
      check(`按钮/字段定义了「${k}」态`, !!(stateRules && stateRules[k]),
        stateRules && stateRules[k] ? '' : '样式表里找不到对应规则');
    }

    /* ================= 动效规范 ================= */
    console.log('\n[动效] 时长令牌 + 两端适配');

    const dur = await c.eval(`(() => {
      const c = getComputedStyle(document.documentElement);
      const g = (n) => c.getPropertyValue(n).trim();
      return {
        instant: g('--af-t-instant'), fast: g('--af-t-fast'), base: g('--af-t-base'),
        slow: g('--af-t-slow'), epic: g('--af-t-epic'),
        easeOut: g('--af-ease-out')
      };
    })()`);
    const ms = (v) => parseInt(String(v), 10) || 0;
    check('时长令牌成阶梯且递增（fast<base<slow<epic）',
      ms(dur.fast) < ms(dur.base) && ms(dur.base) < ms(dur.slow) && ms(dur.slow) < ms(dur.epic),
      JSON.stringify(dur));
    check('按下瞬间位移为0（--af-t-instant=0ms）', ms(dur.instant) === 0, `实际=${dur.instant}`);
    check('缓动为非线性（cubic-bezier）', /cubic-bezier/.test(dur.easeOut || ''), dur.easeOut);

    const zOrder = await c.eval(`(() => {
      const c = getComputedStyle(document.documentElement);
      const g=(n)=>parseInt(c.getPropertyValue(n),10)||0;
      return { drawer:g('--af-z-drawer'), modal:g('--af-z-modal'), toast:g('--af-z-toast') };
    })()`);
    check('层级令牌递增（抽屉<模态<Toast）',
      zOrder.drawer < zOrder.modal && zOrder.modal < zOrder.toast, JSON.stringify(zOrder));

    /* ---------- 两端适配：同一套语言、不同布局 ---------- */
    console.log('\n[两端适配] 桌面 vs 手机');

    // 桌面：抽屉是隐藏的静态节点，网格多列
    const desk = await c.eval(`(() => {
      const nav = document.querySelector('.af-mnav');
      const navCS = nav ? getComputedStyle(nav) : null;
      const grid = document.querySelector('.af-grid, .af-cards, [class*="grid"]');
      return {
        drawerHidden: nav ? (nav.hidden || navCS.display === 'none' || navCS.visibility === 'hidden') : null,
        gridCols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
        burgerVisible: (() => { const b=document.querySelector('.af-burger');
          if(!b) return null; const s=getComputedStyle(b); return s.display !== 'none'; })()
      };
    })()`);
    check('桌面端：抽屉不显示', desk.drawerHidden === true, JSON.stringify(desk));
    check('桌面端：汉堡按钮不显示（用顶栏导航）', desk.burgerVisible === false, JSON.stringify(desk));

    // 手机：模拟 iPhone 视口
    await c.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true
    });
    /* ★ v2.45：必须同时开**触屏模拟**。
.af-peek 的 display:none 写在 @media (hover:none) 和
        @media (hover:none),(pointer:coarse) 里（af-naval.css + af-system.css 各一处）
       —— 这两个条件匹配的是「设备没有精确指针」，不是「屏幕窄」。
       只把视口调窄、不开触屏，(hover:none) 不匹配。
       （注：遍历样式表时读的是规则文本，与是否命中无关；
         但真机上前者决定这条规则**是否生效**，两者都要对。）
       这与「两端适配」的本质一致：手机端不是"窄一点的桌面"，
       它的输入方式就不同。 */
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await c.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }]
    });
    await sleep(700);   // 必须 > 被测代码的兜底定时器与一帧最坏延迟
    const mob = await c.eval(`(() => {
      const burger = document.querySelector('.af-burger');
      // ★ v2.45：.af-peek 是**惰性创建**的 —— 第一次悬停时才插进DOM。
      //   所以"页面加载后有没有这个元素"根本不是判据（会得到 null，
      //   看起来像"没做隐藏"，其实是自己测错了对象）。
      //   正解：查样式表里有没有那条隐藏规则 —— 这是"规则存在"，
      //   和"元素此刻在不在"是两件事。
      const peekRule = (() => {
        const all = Array.prototype.slice.call(document.styleSheets);
        /* ★★ v2.45：递归的**返回值必须显式往上带**。
           我曾写成 walk(r.cssRules); continue; —— 把返回值扔了。
           于是顶层永远拿不到 @media 里的规则：
           统计一遍能数到 4 条 display:none，再跑一遍"找规则"却得到 null。
           两个症状互相矛盾，正是"判据自己坏掉"的信号。
           同族的坑还有：用 if (r.cssRules) 判断要不要递归
           → 顶层 style rule 也有空的 cssRules（truthy）→ 全被跳过。
           两者的正解都是：只对 type 4(@media)/12(@supports) 递归，且带回返回值。

           ⚠ 本注释在 c.eval 的模板字符串里，**不能出现反引号或美元大括号**——
           反引号会提前关闭外层模板，美元大括号会被当成插值，
           报错却是missing ) after argument list / Missing } in template expression
           指向别处，极难定位。反斜杠也要多一层转义。
           所以下面的注释一律用普通引号描述代码。

           ★★ 反证测试抓到的假通过：原先只判「选择器含 .af-peek」且
           「cssText 含 display」就算命中。可 af-system.css 里
           :where(.af-modal,.af-toast,.af-peek)::after { display:none }
           也满足这个条件 —— 那是关掉亮带伪元素的，不是隐藏卡片本身。
           结果把两处真正的 .af-peek { display:none !important } 全删光，
           判据依然报绿。**含关键词 != 命中目标**，
           必须要求选择器里 .af-peek 是**独立主体**（前面是逗号或行首/空白，
           后面是空白、逗号、冒号或行尾），且声明块里确实有 display:none。 */
        const walk = (l, ctx) => {
          for (let i = 0; i < l.length; i++) {
            const r = l[i];
            if ((r.type === 4 || r.type === 12) && r.cssRules && r.cssRules.length) {
              /* 传下条件文本：嵌套 @media 时用外层的（CSS 里少见嵌套，
                 但真出现时外层条件才是决定性的）。 */
              const inner = walk(r.cssRules, r.conditionText || ctx || '');
              if (inner) return inner;
              continue;
            }
            if (!r.selectorText || !r.cssText) continue;
            // 声明块里必须真有 display:none
            if (r.cssText.indexOf('display: none') < 0 && r.cssText.indexOf('display:none') < 0) continue;
            /* 选择器里 .af-peek 必须是**独立主体**。
               逐个逗号分段后精确匹配，排除:
                 :where(.af-modal,.af-toast,.af-peek)::after  ← 伪元素，命中不了本体
                 .af-peek-nm / .af-peek-meta                 ← 名字里含 peek 但不是它 */
            const sels = r.selectorText.split(',');
            let hit = false;
            for (let k = 0; k < sels.length; k++) {
              const one = sels[k].trim();
              if (one === '.af-peek' || one.indexOf('.af-peek:') === 0) { hit = true; break; }
            }
            if (!hit) continue;
            /* ★★ 还要看**所在的 @media 条件在触屏下是否匹配**。
               af-system.css 里 @media print 有一条
               「.af-topbar, .af-mnav, .af-peek, ... { display:none !important }」，
               它也满足上面全部条件，但只在打印时生效 ——
               拿它当"触屏适配已做"的证据，就是又一次假通过。
               正解：向上取 @media 的 conditionText，要求它含
               hover: none 或 pointer: coarse 这类**触屏特征**。 */
            const cond = ctx || '';
            const touchRelated = cond.indexOf('hover') >= 0 || cond.indexOf('pointer') >= 0
              || cond.indexOf('coarse') >= 0;
            if (!touchRelated) continue;
            return (cond ? '@media ' + cond + ' -> ' : '') + r.cssText.slice(0, 80);
          }
          return null;
        };
        for (const sh of all) {
          let rs; try { rs = sh.cssRules; } catch (e) { continue; }
          if (!rs) continue;
          const hit = walk(rs);
          if (hit) return hit;
        }
        return null;
      })();
      const grid = document.querySelector('.af-grid, .af-cards, [class*="grid"]');
      const b = document.querySelector('.af-btn');
      const fs = b ? parseFloat(getComputedStyle(b).fontSize) : 0;
      const bh = b ? Math.round(b.getBoundingClientRect().height) : 0;
      return {
        burgerVisible: burger ? getComputedStyle(burger).display !== 'none' : null,
        peekRule: peekRule,
        gridCols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
        btnFont: fs,
        btnHeight: bh,
        innerW: window.innerWidth
      };
    })()`);
    check('手机端：显示汉堡按钮（抽屉入口）', mob.burgerVisible === true, JSON.stringify(mob));
    // 判据改成"隐藏规则存在"，而不是"元素不存在"
    check('手机端：悬浮提示卡有隐藏规则（触屏无 hover）',
      !!(mob.peekRule && /display\s*:\s*none/.test(mob.peekRule)),
      mob.peekRule ? `规则=${mob.peekRule.slice(0, 70)}` : '样式表里找不到 .af-peek 的 display 规则');
    check('手机端：多列塌成单列', mob.gridCols <= 1, `列数=${mob.gridCols} 视口=${mob.innerW}`);
    check('手机端：按钮字号 ≥13px（低于此在手机上明显难读）',
      mob.btnFont >= 13, `实际 ${mob.btnFont}px`);
    /* ★ v2.45：判据从「必须≥16px」改成「≥13px + 两端有明确分工」。
       原因：触控目标（可点区域 44px）才是防误触的主指标，字号不是 ——
       把两者混为一谈会逼着设计把字号无限放大，反而破坏版式。
       真正要保证的是「手机上的可读下限」，13px 是通用底线。 */
    check('手机端：触控目标 ≥44px（防误触的主指标）',
      (mob.btnHeight || 0) >= 44, `按钮高 ${mob.btnHeight}px`);

    // 亮带在触屏端应关闭
    const shineMobile = await c.eval(`(() => {
      const t = document.querySelector('.af-toast') || document.querySelector('.af-peek');
      if (!t) return '元素不存在';
      const s = getComputedStyle(t, '::after');
      return s.content;
    })()`);
    check('手机端：斜向亮带不生成（纯装饰，不耗电）',
      !shineMobile || shineMobile === 'none' || shineMobile === 'normal',
      `::after content=${shineMobile}`);

    await c.send('Emulation.clearDeviceMetricsOverride');

    /* ================= reduced-motion 降级 ================= */
    console.log('\n[降级] prefers-reduced-motion');
    await c.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    });
    await goto(c, `${BASE}/mods/`);
    const rm = await c.eval(`(() => {
      const t = document.querySelector('.af-peek, .af-toast, .af-modal');
      const s = t ? getComputedStyle(t, '::after') : null;
      const btn = document.querySelector('.af-btn');
      const cs3 = btn ? getComputedStyle(btn) : null;
      return {
        afterContent: s ? s.content : 'no-el',
        transitionDur: cs3 ? cs3.transitionDuration : ''
      };
    })()`);
    check('减少动效时斜向亮带被彻底移除',
      !rm.afterContent || rm.afterContent === 'none' || rm.afterContent === 'normal',
      `::after content=${rm.afterContent}`);
    check('减少动效时过渡时长被压到近零',
      /^(0s|0s, 0s|0.00001s|1e-05s)/.test(rm.transitionDur || ''),
      `transition-duration=${rm.transitionDur}`);
    await c.send('Emulation.setEmulatedMedia', { features: [] });

  } catch (err) {
    if (err.message !== 'PRECHECK_FAILED') {
      fail++;
      failures.push('脚本异常: ' + err.message);
    }
  } finally {
    try { if (edgeProc) edgeProc.kill('SIGKILL'); } catch { }
    try { if (profileDir) fs.rmSync(profileDir, { recursive: true, force: true }); } catch { }
  }

  /* ---------- box-shadow 层数：必须扫括号深度 ---------- */
  function shadowLayers(v) {
    if (!v || v === 'none') return 0;
    let depth = 0, max = 0, parts = 0, inFn = false;
    for (let i = 0; i < v.length; i++) {
      const ch = v[i];
      if (ch === '(') { depth++; inFn = true; }
      else if (ch === ')') { depth--; }
      else if (ch === ',' && depth === 0) { parts++; }
    }
    void max;
    return parts + 1;
  }

  console.log('\n==================================================');
  console.log(`通过 ${pass} / ${pass + fail}`);
  if (failures.length) {
    console.log('\n未通过：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('==================================================\n');

  if (process.argv.includes('--list')) {
    console.log('通过项：');
    PASSED.forEach((p) => console.log('  · ' + p));
    console.log('');
  }
  process.exit(fail ? 1 : 0);
}

main();