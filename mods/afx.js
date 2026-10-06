/* =====================================================================
   afx.js — 动效编排层（v2.27）
   =====================================================================
   依赖（全部 MIT / 可商用，已下载到本地 vendor/，不依赖 CDN）：
     · GSAP 3.13        —— 主时间轴、缓动、stagger
     · ScrollTrigger    —— 滚动触发
     · Motion 12        —— Framer Motion 的同源 vanilla 版（交互补间）
     · Lenis 1.3        —— 平滑滚动

   设计约束（按项目既定原则）：
     1. 全部动效只改 transform / opacity，不触发 layout，避免滚动掉帧。
     2. prefers-reduced-motion 下整层不启用，且必须已有 CSS 兜底 ——
        本文件不负责"能不能看"，只负责"更好看"。库挂了这站照样能用。
     3. 幂等：重复调用不会重复绑定。
     4. 触屏与低性能设备自动降级（不劫持滚动、不做视差）。
     5. 克制：首屏只保留 1 个主时间轴；滚动入场每元素只播一次。
   ===================================================================== */
(function () {
  'use strict';
  var d = document, w = window;
  var AF = w.afNaval || (w.afNaval = {});

  var M = {
    enabled: false,      // 最终是否启用（reduced-motion 时保持 false）
    libs: { gsap: false, st: false, motion: false, lenis: false },
    lenis: null,
    _bound: false
  };
  AF.motion = M;

  function reduced() { return AF.reduced ? AF.reduced() : false; }

  /** 触屏设备不做滚动劫持与视差（避免 iOS 惯性冲突与掉帧） */
  function isTouch() {
    return w.matchMedia && w.matchMedia('(hover: none), (pointer: coarse)').matches;
  }

  /* -----------------------------------------------------------------
     1. 平滑滚动（Lenis）
     说明：只开 smoothWheel。syncTouch 在 iOS 16 以下会异常，
     移动端交给系统原生惯性更稳。
     ----------------------------------------------------------------- */
  function initScroll() {
    if (!w.Lenis || M.lenis) return;
    try {
      M.lenis = new w.Lenis({
        lerp: 0.11,
        smoothWheel: true,
        syncTouch: false,
        // 无障碍：用户系统里说了「减少动效」就彻底关掉平滑
        respectReducedMotion: true
      });

      // GSAP 用 rAF 驱动时间轴，两者必须挂同一个时钟，否则会各走各的
      if (M.libs.gsap) {
        M.lenis.on('scroll', w.ScrollTrigger && w.ScrollTrigger.update);
        w.gsap.ticker.add(function (t) { M.lenis.raf(t * 1000); });
        w.gsap.ticker.lagSmoothing(0);
      } else {
        var raf = function (t) { M.lenis.raf(t); w.requestAnimationFrame(raf); };
        w.requestAnimationFrame(raf);
      }
    } catch (e) {
      M.lenis = null;   // 出错就退回浏览器原生滚动，不影响可用性
    }
  }

  /* -----------------------------------------------------------------
     2. 页面进入
     克制原则：只对首屏区块做一次编排，标题 / 副标题 / 按钮依次错开，
     其余内容交给滚动入场。不要整页元素一起动。
     ----------------------------------------------------------------- */
  function initEnter() {
    var g = w.gsap;
    if (!g) return;
    var scope = d.querySelector('[data-afx-enter]');
    if (!scope) return;

    var items = scope.querySelectorAll('[data-afx-item]');
    if (!items.length) return;

    // 先全部置为初始态，避免闪烁；只有支持动效时才做
    g.set(items, { opacity: 0, y: 18 });

    var tl = g.timeline({ defaults: { duration: 0.62, ease: 'power3.out' } });
    tl.to(items, {
      opacity: 1, y: 0,
      stagger: 0.075,                       // 逐个错开，不整齐划一
      // 同 scanReveal 的坑：clearProps 清掉内联 opacity 后，
      // 带 .af-reveal 类的元素会退回 CSS 的透明态。播完先交还给 .af-in。
      onComplete: function () {
        items.forEach(function (el) {
          if (el.classList.contains('af-reveal')) el.classList.add('af-in');
        });
        g.set(items, { clearProps: 'transform,opacity' });
      }
    });

    // 顶栏/遮罩类元素用 fade，不参与位移
    var fade = scope.querySelectorAll('[data-afx-fade]');
    if (fade.length) {
      g.set(fade, { opacity: 0 });
      tl.fromTo(fade, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'none' }, 0);
    }
    M.enterTl = tl;
  }

  /* -----------------------------------------------------------------
     3. 滚动入场
     一次性的：每个元素只播一次，播完即 kill，不留观察器。
     ★ 与既有 .af-reveal 的分工：afx 启用时由 GSAP ScrollTrigger 接管，
       af-naval 的 IntersectionObserver 入场会被跳过（见 AF.refresh），
       两套同时跑会让元素被两个动画抢着改样式 —— 那样必然抖动。
     ★ 对外暴露 scanReveal()，因为卡片列表是异步渲染的，
       boot 时扫一次不够，每次 render 后都要补扫新增节点。
     ----------------------------------------------------------------- */
  function scanReveal(root) {
    var g = w.gsap, ST = w.ScrollTrigger;
    if (!g || !ST || !M.enabled) return;
    // ★ 选择器要同时覆盖 .af-reveal：卡片是**异步渲染**的，boot 时还不存在，
    //   只认 data-afx-reveal 的话，列表里的卡片永远没人负责显现。
    var scope = root || d;
    var nodes = scope.querySelectorAll('.af-reveal, [data-afx-reveal]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.getAttribute('data-afx-done') === '1') continue;
      el.setAttribute('data-afx-done', '1');

      // 已在视口内（或视口上方）的：直接显示。
      // ★ 这里有个很容易踩的坑：.af-reveal 的 CSS 本身就是 opacity:0，靠 .af-in 变可见。
      //   如果只是 g.set(opacity:1) 然后 clearProps 清掉内联样式，元素会立刻退回
      //   CSS 的透明态 —— 也就是"显示完马上又消失"。实测就踩过这个。
      //   正确做法：把最终态交还给 CSS（加 .af-in），内联样式只清 transform。
      var r = el.getBoundingClientRect();
      if (r.top < w.innerHeight * 0.92) {
        el.classList.add('af-in');
        g.set(el, { clearProps: 'transform' });
        continue;
      }
      g.set(el, { opacity: 0, y: 22 });
      ST.create({
        trigger: el,
        start: 'top 88%',
        once: true,                 // 只触发一次
        onEnter: function (self) {
          var el2 = self.trigger;
          g.to(el2, {
            opacity: 1, y: 0,
            duration: 0.58, ease: 'power3.out',
            onComplete: function () {
              el2.classList.add('af-in');            // 交还给 CSS 的最终可见态
              g.set(el2, { clearProps: 'transform,opacity' });
            }
          });
        }
      });
    }
  }

  /* -----------------------------------------------------------------
     4. 悬停 / 点击反馈
     悬停沿用既有 CSS（磁吸、中心聚焦）——它们已经够好，不重复造。
     这里只补「按压」这一类 CSS 做不到的：按下时轻微缩放 + 回弹。
     ----------------------------------------------------------------- */
  function initPress() {
    var g = w.gsap;
    if (!g) return;
    var sel = '.af-btn, .af-chip, .af-kindchip, .af-cta, button.af-btn';
    d.querySelectorAll(sel).forEach(function (el) {
      if (el.dataset.afxPress) return;
      el.dataset.afxPress = '1';
      el.addEventListener('pointerdown', function () {
        g.to(el, { scale: 0.96, duration: 0.09, ease: 'power2.out' });
      });
      var back = function () {
        g.to(el, { scale: 1, duration: 0.42, ease: 'elastic.out(1, 0.55)' });
      };
      el.addEventListener('pointerup', back);
      el.addEventListener('pointerleave', back);
      // 键盘激活时也要有反馈
      el.addEventListener('keyup', function (e) {
        if (e.key === 'Enter' || e.key === ' ') back();
      });
    });
  }

  /* -----------------------------------------------------------------
     5. Modal 打开 / 关闭（用 Motion 做弹簧，比 CSS 过渡更跟手）
     ★ Motion 有 80KB，而它只在「打开详情弹层」时才用得上 ——
       所以改成**按需加载**：首屏不解析这段 JS，长任务明显变短。
     ★ 加载失败或用户要求减少动效时，自动退回 CSS 过渡（openDetail 里本来就有一份）。
     ----------------------------------------------------------------- */
  function loadMotion(cb) {
    if (w.Motion || w.motion) { cb(); return; }
    if (M._motionState === 'loading' || M._motionState === 'failed') return;
    M._motionState = 'loading';
    var s = d.createElement('script');
    s.src = '/AtlanticFleetSite/vendor/motion.min.js';
    s.onload = function () { M._motionState = 'ready'; cb(); };
    s.onerror = function () {
      M._motionState = 'failed';   // 弹层退回 CSS 动画，功能不受影响
    };
    d.head.appendChild(s);
  }

  function bindModal(selector) {
    var mo = d.querySelector(selector);
    if (!mo || mo.dataset.afxBound) return;
    mo.dataset.afxBound = '1';
    var inner = mo.querySelector('.af-modal') || mo.firstElementChild;
    if (!inner) return;

    // 首次交互时就把 Motion 拉下来，用户点开弹层时通常已经就绪
    var warm = function () { loadMotion(function () {}); };
    mo.addEventListener('pointerenter', warm, { once: true });
    mo.addEventListener('focusin', warm, { once: true });

    var play = function (open, from) {
      var Mtn = w.Motion || w.motion;
      if (!Mtn || !Mtn.animate) return;      // 没就绪就用 CSS 兜底
      if (open && from) {
        // 从来源卡片的位置展开
        var m = inner.getBoundingClientRect();
        var dx = Math.max(-160, Math.min(160, from.x - m.left - m.width / 2));
        var dy = Math.max(-120, Math.min(120, from.y - m.top - m.height / 2));
        Mtn.animate(inner,
          { opacity: [0, 1], transform: ['translate(' + dx + 'px,' + dy + 'px) scale(.9)', 'none'] },
          { duration: 0.34, ease: [0.16, 1, 0.3, 1] });
      } else if (open) {
        Mtn.animate(inner, { opacity: [0, 1], transform: ['scale(.96) translateY(10px)', 'none'] },
          { duration: 0.3, ease: [0.16, 1, 0.3, 1] });
      } else {
        Mtn.animate(inner, { opacity: [1, 0], transform: ['none', 'scale(.98)'] }, { duration: 0.18 });
      }
    };

    mo.addEventListener('afx:open', function (e) {
      var from = e.detail ? e.detail.from : null;
      // 库还没到位就先请求，同时让 CSS 过渡顶上，不让用户等
      if (!(w.Motion || w.motion)) {
        loadMotion(function () { play(true, from); });
        return;
      }
      play(true, from);
    });
    mo.addEventListener('afx:close', function () { play(false, null); });
  }

  /* -----------------------------------------------------------------
     6. 弹层可访问性（第 8 册 §15.5 遗留项 L4）
     要解决三件事：打开后焦点进不来、Esc 关不掉、Tab 还能跑到被遮住的背景上。
     ----------------------------------------------------------------- */
  function bindModalA11y(selector) {
    var mo = d.querySelector(selector);
    if (!mo || mo.dataset.afxA11y) return;
    mo.dataset.afxA11y = '1';

    // Esc 关闭
    mo.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        // ★ CustomEvent 默认 **不冒泡**，而监听器在 document 上。
        //   不显式 bubbles:true 的话 Esc 派发了但没人收到 —— 实测「Esc 关不掉弹层」就是这个原因。
        requestClose(mo);
      }
    });
    // 点遮罩空白处也关（点到弹层本体不关）
    mo.addEventListener('mousedown', function (e) {
      if (e.target === mo) {
        requestClose(mo);
      }
    });
    // 背景在弹层打开期间不可聚焦：inert 为主，aria-hidden 兜底
    // （inert 的浏览器支持是 Chrome 102+/Safari 15.5+/FF112+，老浏览器靠后者）
    mo.__afBg = [];
  }

  /**
   * 请求关闭弹层。
   *
   * ★ v2.38：这里必须自带兜底，不能只发事件。
   *   原来 bindModalA11y 只 dispatchEvent('afx:request-close')，
   *   而真正执行关闭的监听器**只有仓库页有**（index.html:815 的 closeDetail）。
   *   后台页（/admin/）从来没有注册过它 —— 于是 Esc 事件派发了、也确实冒泡到了 document，
   *   但**没有任何人接**。我第一版只把 bindModalA11y 从"缺 GSAP 就早退"里放出来，
   *   实测 Esc 依然关不掉弹层，才定位到这一层：能力接上了，缺的是执行方。
   *
   *   做法：先派发事件（让页面自己的 closeDetail 走完整流程：还原焦点、撤背景 inert），
   *   然后在下一帧检查 —— 若事件派发后弹层**仍然开着**且没有任何监听者接手，
   *   就直接收起遮罩。这保证了：
   *     · 仓库页行为不变（closeDetail 会处理，遮罩已关，兜底不触发）
   *     · 后台页也能关（没有监听者，兜底接手）
   */
  function requestClose(mo) {
    var ev = new CustomEvent('afx:request-close', { bubbles: true });
    mo.dispatchEvent(ev);
    // 事件是同步派发的：若这一行结束时弹层还开着，说明没人处理
    requestAnimationFrame(function () {
      if (mo.classList.contains('show')) {
        mo.classList.remove('show');
        // ★ v2.38：顺手把焦点与背景 inert 也撤掉。
        //   不撤的话弹层是关上了，但背景**仍然不可 Tab**、焦点还停在已经隐藏的元素上
        //   —— 用户会觉得「关掉了但网页好像不能用了」。仓库页走 closeDetail 路径时
        //   已经调过 modalFocus(false)，这里只在兜底路径执行，不会重复。
        try { modalFocus(false); } catch (e) { }
        try { mo.dispatchEvent(new CustomEvent('afx:closed', { bubbles: true })); } catch (e) { }
      }
    });
  }

  /** openDetail / closeDetail 调用它，维护焦点与背景 inert */
  function modalFocus(open, trigger) {
    var mo = d.querySelector('.af-mask');
    if (!mo) return;
    var closeBtn = mo.querySelector('#mClose');
    if (open) {
      M._lastFocus = trigger || d.activeElement;
      if (closeBtn) { try { closeBtn.focus({ preventScroll: true }); } catch (e) { } }
      // 让背景不可 Tab
      var bg = d.querySelector('.af-wrap') || d.body;
      var kids = bg.children;
      for (var i = 0; i < kids.length; i++) {
        if (kids[i] === mo || kids[i].contains && kids[i].contains(mo)) continue;
        if (kids[i].hasAttribute('inert')) continue;
        kids[i].setAttribute('inert', '');
        kids[i].setAttribute('aria-hidden', 'true');
        mo.__afBg.push(kids[i]);
      }
    } else {
      for (var j = 0; j < (mo.__afBg || []).length; j++) {
        mo.__afBg[j].removeAttribute('inert');
        mo.__afBg[j].removeAttribute('aria-hidden');
      }
      mo.__afBg = [];
      if (M._lastFocus && M._lastFocus.focus) {
        try { M._lastFocus.focus({ preventScroll: true }); } catch (e) { }
      }
    }
  }

  /* -----------------------------------------------------------------
     7. 页面跳转过渡（对应用户资料 B2 的「页面跳转 transition」）
     做法：点站内链接 → 极短淡入遮罩 → 跳转；新页读到 sessionStorage 标记就立刻淡出。
     ★ 四条保命措施（第三、四条是补 SEO 隐患）：
       1) 遮罩 2 秒后无条件移除 —— 任何异常都不会把页面永久挡住；
       2) 只拦同源、非下载、非 hash、非新标签的普通左键点击，
          其余情况（Ctrl+点击、外链、锚点）一律走浏览器默认行为。
     ----------------------------------------------------------------- */
  function isCrawler() {
    // ★ 验收开关：?afxnav=1 强制启用跳转过渡。
    //   爬虫防护会把「无头浏览器」也判成爬虫（navigator.webdriver / HeadlessChrome UA），
    //   而本项目的验收脚本全部跑在 headless Edge 里 —— 不给这个开关的话，
    //   跳转过渡在自动化环境里**永远测不到**，只能靠真机人肉验证。
    //   生产环境不会带这个参数，所以不影响爬虫防护本身。
    try {
      if (/[?&]afxnav=1\b/.test(location.search)) return false;
    } catch (e) { /* ignore */ }
    if (navigator.webdriver) return true;              // 自动化 / 无头
    var ua = navigator.userAgent || '';
    return /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|baiduspider|bytespider|headlesschrome/i.test(ua);
  }

  function initNav() {
    if (M.nav) return;
    M.nav = true;
    if (M.mode === 'off' || isCrawler()) return;

    // 真实交互闸门：没发生过任何输入就不接管链接
    var userActed = false;
    var markAct = function () { userActed = true; };
    d.addEventListener('pointerdown', markAct, { once: true, passive: true });
    d.addEventListener('keydown', markAct, { once: true, passive: true });
    d.addEventListener('wheel', markAct, { once: true, passive: true });
    d.addEventListener('touchstart', markAct, { once: true, passive: true });
    M.navUserActed = function () { return userActed; };

    var veil = d.createElement('div');
    veil.className = 'afx-veil';
    d.body.appendChild(veil);

    var armed = false;
    try { armed = sessionStorage.getItem('afx-nav') === '1'; sessionStorage.removeItem('afx-nav'); }
    catch (e) { /* 隐私模式下 sessionStorage 会抛，忽略即可 */ }

    if (armed) {
      // 从上一页带过来的遮罩：先显示再淡出，避免看到"白闪"
      veil.classList.add('afx-veil--on');
      var t0 = w.setTimeout(function () { veil.classList.remove('afx-veil--on'); }, 16);
      void t0;
    }
    // 兜底：无论发生什么，2 秒后必须让遮罩走
    w.setTimeout(function () { veil.classList.remove('afx-veil--on'); }, 2000);

    d.addEventListener('click', function (e) {
      if (!userActed) return;   // 爬虫/无交互环境：不接管链接，否则内部链接会断
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;   // 新标签/下载
      var a = e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || a.hasAttribute('download') || a.target === '_blank') return;
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#' || href.indexOf('//') === 0) return;
      var url;
      try { url = new URL(href, location.href); } catch (err) { return; }
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;  // 同页

      e.preventDefault();
      try { sessionStorage.setItem('afx-nav', '1'); } catch (err) { }
      veil.classList.add('afx-veil--on');
      // 160ms：够看清一次淡入，又不至于让导航"变卡"
      w.setTimeout(function () { location.href = url.href; }, 160);
    }, true);
  }
  function boot() {
    if (M._bound) return;
    M._bound = true;

    // ★ 模式：<html data-afx="full|lite|off">
    //   full —— 仓库页/文档站：全部动效
    //   lite —— 后台这类工具页：只保留按压反馈与弹层，不接管滚动、不做入场编排
    //   off  —— 完全关闭
    // 工具页堆动效会干扰信息读取，这是刻意的取舍。
    M.mode = d.documentElement.getAttribute('data-afx') || 'full';
    if (M.mode === 'off') { AF.motion = M; return; }

    M.libs.gsap = !!w.gsap;
    M.libs.st = !!w.ScrollTrigger;
    M.libs.motion = !!(w.Motion || w.motion);
    M.libs.lenis = !!w.Lenis;

    if (M.libs.gsap && M.libs.st) {
      try { w.gsap.registerPlugin(w.ScrollTrigger); } catch (e) { }
    }

    // 无障碍：系统要求减少动效 → 整层不启用。
    // 此时 CSS 里既有的过渡仍然工作，动效层只是"不做加法"。
    if (reduced()) {
      M.enabled = false;
      AF.motion = M;
      // ★ v2.38：即便不要动效，弹层的 Esc 关闭与焦点管理**必须照常**。
      //   它们不是"动效"，是无障碍。reduced-motion 的用户里有相当一部分
      //   是靠键盘和读屏操作的人，把这两个能力一起关掉是净损失。
      //   bindModal 的 play() 里本来就有「Motion 没就绪就用 CSS 兜底」。
      bindModal('.af-mask');
      bindModalA11y('.af-mask');
      d.dispatchEvent(new CustomEvent('afx:ready', { detail: M }));
      return;
    }

    // ★ 关键前置条件：GSAP + ScrollTrigger 必须真的在。
    //   .af-reveal 的 CSS 是 opacity:0，靠 JS 加 .af-in 才显现。
    //   一旦 afx 宣布启用、af-naval 就跳过了原来的 IntersectionObserver ——
    //   若此时 GSAP 实际没加载，那些元素会**永远保持透明**，等于把内容藏起来了。
    //   所以接管的前提是库真的可用，否则老老实实让位给原实现。
    if (!M.libs.gsap || !M.libs.st) {
      M.enabled = false;
      AF.motion = M;
      // ★ v2.38：后台页（/admin/）只加载 lenis，没加载 gsap/ScrollTrigger，
      //   以前走到这里就直接 return —— 结果后台的弹层**Esc 关不掉**、
      //   打开后焦点不转移、背景不 inert，Tab 会跑到被遮住的背景上。
      //   与其让缺库把无障碍能力一起带走，不如只让位"动效"、保住"行为"。
      bindModal('.af-mask');
      bindModalA11y('.af-mask');
      d.dispatchEvent(new CustomEvent('afx:ready', { detail: M }));
      return;
    }
    M.enabled = true;

    // 接管既有的 .af-reveal：给它们补上标记，交给 ScrollTrigger 负责显现
    if (M.mode === 'full') {
      d.querySelectorAll('.af-reveal').forEach(function (el) {
        if (!el.hasAttribute('data-afx-reveal')) el.setAttribute('data-afx-reveal', '');
      });
      initScroll();
      initEnter();
      scanReveal();
    }
    // lite 模式跳过上面全部：工具页不接管滚动、不做入场编排。
    // 但按压反馈与弹层动效在任何模式都保留 —— 它们只碰 transform，不影响阅读。
    initPress();
    bindModal('.af-mask');
    bindModalA11y('.af-mask');
    initNav();

    AF.motion = M;
    d.dispatchEvent(new CustomEvent('afx:ready', { detail: M }));
  }

  M.boot = boot;
  M.bindModal = bindModal;
  M.modalFocus = modalFocus;
  M.scanReveal = scanReveal;

  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
