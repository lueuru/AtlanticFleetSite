/* =============================================================================
   af-motion.js —— 大西洋舰队 Mod 仓库 · 交互与动效编排层
   =============================================================================
   职责划分（与既有文件的边界）：
     af-naval.js  共享 UI 库（主题、磁吸、光标、Toast…）——已有，不动
     afx.js       GSAP 编排（滚动入场、按压、弹层）—— 已有，本文件不重复实现
     af-system.css 设计令牌 + 组件状态 + 液态玻璃 + 响应式 —— 已建
     本文件       ① 统一时长/缓动的**单一取值入口**
                 ② 页面转场（进/出）
                 ③ 滚动联动（进度条 + 导航高亮）
                 ④ 把 CSS 里的组件状态真正接上（加载/错误/禁用）

   ★ 设计原则：**时长只在 CSS 里定义，JS 只读取不定义**。
     反过来做（JS 里写一堆时长常量）会出现两套真值，改 CSS 时 JS 不知道、
     改 JS 时 CSS 不知道，最后两处不一致。这正是本项目此前
     "13 种时长 / 4 种写法不同的同一曲线" 的成因。
   ========================================================================== */

(function (w, d) {
  'use strict';
  if (w.afMotion) return;                 // 防重复加载
  var doc = d.documentElement;

  /* =============================================================================
     0. 环境判定
     ========================================================================== */
  var reduceMQ = w.matchMedia ? w.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var hoverMQ = w.matchMedia ? w.matchMedia('(hover: hover) and (pointer: fine)') : null;

  function reduced() { return !!(reduceMQ && reduceMQ.matches); }
  function finePointer() { return !!(hoverMQ && hoverMQ.matches); }

  /* ★ 断点也从 CSS 读，不在 JS 里另写一份数字。
     两处各写一个 960 是典型的"改了一处忘了另一处"——
     表现为"某些页面在平板上还是桌面布局"。 */
  var BP = { md: 960, sm: 720, lg: 1120 };
  function refreshBreakpoints() {
    var cs = w.getComputedStyle(doc);
    var md = parseFloat(cs.getPropertyValue('--af-bp-md'));
    var sm = parseFloat(cs.getPropertyValue('--af-bp-sm'));
    var lg = parseFloat(cs.getPropertyValue('--af-bp-lg'));
    BP.md = isFinite(md) ? md : 960;
    BP.sm = isFinite(sm) ? sm : 720;
    BP.lg = isFinite(lg) ? lg : 1120;
  }
  refreshBreakpoints();

  function narrow() { return w.innerWidth < BP.md; }
  function isDesktop() { return w.innerWidth >= BP.lg; }
  /* 小屏手机（iPhone SE / 旧安卓）—— 布局要更保守：
     多列一定塌成单列，浮层要更贴边，留白要更小。 */
  function isSmall() { return w.innerWidth < BP.sm; }

  /* =============================================================================
     1. 统一时长/缓动的单一取值入口
     -----------------------------------------------------------------------------
     从 CSS 自定义属性读出计算值。**不写死任何数字**。
     降级值只在「CSS 变量读不到」时用（例如 af-system.css 没加载），
     且与 CSS 里的值保持一致 —— 不一致时会退化成"两套节奏"，所以宁可少功能也要留一致性。
     ========================================================================== */
  var DUR_FALLBACK = {
    instant: 0, fast: 160, base: 240, slow: 420, epic: 680
  };

  function cssNum(name, fallback) {
    // getComputedStyle().getPropertyValue 拿到的是声明值（如 "160ms"）
    var v = w.getComputedStyle(doc).getPropertyValue(name);
    if (!v) return fallback;
    var n = parseFloat(v);
    return isFinite(n) ? n : fallback;
  }

  var T = {
    instant: DUR_FALLBACK.instant,
    fast:    DUR_FALLBACK.fast,
    base:    DUR_FALLBACK.base,
    slow:    DUR_FALLBACK.slow,
    epic:    DUR_FALLBACK.epic
  };
  function refreshDurations() {
    T.instant = cssNum('--af-t-instant', DUR_FALLBACK.instant);
    T.fast    = cssNum('--af-t-fast',    DUR_FALLBACK.fast);
    T.base    = cssNum('--af-t-base',    DUR_FALLBACK.base);
    T.slow    = cssNum('--af-t-slow',    DUR_FALLBACK.slow);
    T.epic    = cssNum('--af-t-epic',    DUR_FALLBACK.epic);
    refreshBreakpoints();
  }
  refreshDurations();
  // 字体加载完成后度量值会变（rem 基准），重读一次
  if (d.fonts && d.fonts.ready && d.fonts.ready.then) {
    d.fonts.ready.then(refreshDurations).catch(function () {});
  }

  /* =============================================================================
     2. 页面转场
     -----------------------------------------------------------------------------
     两条路径：
       ·站内链接* → 淡出遮罩 → 跳转 → 新页淡入（读 sessionStorage 标记）
       ·浏览器后退/前进 → bfcache 恢复时不需要动画（页面本来就是完整的）

     ★ 为什么用「标记 + sessionStorage」而不是「每次都播」：
       新页加载完成后它并不知道自己是「被转场进来的」还是「用户直接敲 URL 进来的」。
       直接敲 URL 时播转场 = 每次刷新都白闪一次，很烦。
       标记让「只有真的发生过跳转的那一次」才放动画。

     ★ 保命措施：遮罩 2 秒后无条件移除。
       任何 JS 异常（包括用户装的 Mod 脚本冲突）都不能把页面永久挡住。
     ========================================================================== */
  var FADE_KEY = 'af-page-fade';
  var _fadeEl = null;

  function fadeEl() {
    if (_fadeEl && _fadeEl.parentNode) return _fadeEl;
    _fadeEl = d.createElement('div');
    _fadeEl.className = 'af-pagefade';
    _fadeEl.setAttribute('aria-hidden', 'true');
    d.body.appendChild(_fadeEl);
    // 保命：不管发生什么，2.4 秒后一定移除遮罩
    setTimeout(function () {
      if (_fadeEl) { _fadeEl.classList.remove('af-pagefade--on'); }
    }, 2400);
    return _fadeEl;
  }

  var _fadeClassTimer = 0;
  function pageFadeIn() {
    if (reduced()) return;
    var el = fadeEl();
    // ★ 原来用「两次连续 requestAnimationFrame」等浏览器把初始帧画完，
    //   再加 class。这个写法在**连续调用**时会失效：
    //   第一帧还没到就来了第二次调用，两次的 rAF 回调排在同一帧里，
    //   第二次调用会看到 class 已在、于是跳过 —— 但此时**没有**任何东西
    //   触发过一次"从无到有"的状态变化，CSS 过渡不会启动，遮罩就停在透明态。
    //   表现是「点链接跳转了，但新页没有淡入」。
    //   改用 setTimeout(0) + 显式清timer：无论调用多少次，
    //   都保证「先有一帧不加 class 的渲染，再加 class」。
    if (_fadeClassTimer) clearTimeout(_fadeClassTimer);
    _fadeClassTimer = setTimeout(function () {
      _fadeClassTimer = 0;
      el.classList.add('af-pagefade--on');
    }, 16);
  }

  function pageFadeOut(cb) {
    if (reduced()) { cb(); return; }
    var el = fadeEl();
    el.classList.add('af-pagefade--on');
    // 等遮罩真的变不透明再跳转，否则转场等于没做
    w.setTimeout(cb, Math.min(T.epic, 420));
  }

  function bindPageFade() {
    // ① 新页：读标记，有则淡入一次，然后立刻清掉（只放一次）
    try {
      if (w.sessionStorage && w.sessionStorage.getItem(FADE_KEY)) {
        w.sessionStorage.removeItem(FADE_KEY);
        pageFadeIn();
      }
    } catch (e) { }

    // ② 站内链接：拦截、淡出、跳转
    d.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;   // 新标签/下载
      if (reduced()) return;
      var a = e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (!href || href.charAt(0) === '#') return;                     // 锚点不转场
      if (a.target === '_blank' || a.hasAttribute('download')) return;
      // 外部链接交给浏览器
      if (/^(https?:)?\/\//i.test(href) || /^(mailto|tel|javascript):/i.test(href)) {
        // 站内绝对地址（http://atlanticfleet.asia/...）仍算站内
        var host = doc.host;
        if (a.host && a.host !== host) return;
      }
      e.preventDefault();
      try { w.sessionStorage.setItem(FADE_KEY, '1'); } catch (err) { }
      pageFadeOut(function () { w.location.href = href; });
    });

    // ③ 页面从后台切回来时，遮罩不能还留着（bfcache 恢复不重播）
    w.addEventListener('pageshow', function (e) {
      if (e.persisted && _fadeEl) _fadeEl.classList.remove('af-pagefade--on');
    });
  }

  /* =============================================================================
     3. 滚动联动
     -----------------------------------------------------------------------------
     两件事，都用 transform（合成层）而不是 height/top（触发重排）：
       ① 顶部 2px 进度条：scaleX(0→1)
       ② 导航当前项高亮：进入视口的那一节给对应链接加 aria-current

     ★ 进度条为什么不放在页面里而是 fixed：
       它是"全局状态指示"，应该像顶栏一样常驻，不随内容滚走。

     ★ 高亮为什么不监听 scroll 事件而是每帧算：
       scroll 事件在快速滚动时每帧触发多次；
       用 rAF 合并成每帧一次，且只读 getBoundingClientRect（会触发重排但
       一次总比几十次好）。这里节点数很少（导航项 < 10），成本可忽略。
     ========================================================================== */
  var _bar = null;
  var _navIO = null;

  function bindScrollProgress() {
    if (!_bar) {
      _bar = d.createElement('div');
      _bar.className = 'af-scrollbar';
      _bar.setAttribute('aria-hidden', 'true');
      d.body.appendChild(_bar);
    }
    var ticking = false;
    function update() {
      ticking = false;
      var h = d.documentElement.scrollHeight - w.innerHeight;
      // ★ h <= 0 时必须提前返回：内容不足一屏时 h 可能是 0 或负数，
      //   除下来会得到 Infinity / -Infinity，transform 变成 NaN → 进度条消失。
      var p = h > 0 ? Math.min(1, Math.max(0, w.scrollY / h)) : 0;
      _bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
      _bar.style.opacity = p > 0.001 ? '1' : '0';
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      w.requestAnimationFrame(update);
    }
    w.addEventListener('scroll', onScroll, { passive: true });
    w.addEventListener('resize', onScroll, { passive: true });
    update();
  }

  /* 导航高亮：IntersectionObserver 观察各 section，把当前 section 的
     id 映射到导航链接上。只在有对应 section 的页面上启用（文档站）。 */
  function bindNavSpy() {
    if (_navIO) { _navIO.disconnect(); _navIO = null; }
    var links = d.querySelectorAll('.af-navlink[href^="#"], nav a[href^="#"]');
    if (!links.length) return;

    var map = {};
    var hasAny = false;
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || '';
      if (href.length < 2) continue;
      map[href.slice(1)] = links[i];
      hasAny = true;
    }
    if (!hasAny) return;

    var visible = {};
    _navIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var id = en.target.id;
        if (!id) return;
        if (en.isIntersecting) visible[id] = en.intersectionRatio;
        else delete visible[id];
      });
      // 选当前可见比例最高的那一节
      var best = null, bestR = 0;
      for (var k in visible) {
        if (visible[k] > bestR) { bestR = visible[k]; best = k; }
      }
      for (var j = 0; j < links.length; j++) {
        links[j].removeAttribute('aria-current');
      }
      if (best && map[best]) {
        map[best].setAttribute('aria-current', 'true');
      }
    }, {
      // ★ 上边界下移 12%、下边界上移 70%：
      //   视口顶部那一条永远有一小截被顶栏盖着，不下移的话标题刚进视口就被顶栏压住，
      //   高亮会"慢半拍"。下边界上移 70% 是为了让下一节开始占据视觉中心时才切换。
      rootMargin: '-12% 0px -70% 0px',
      threshold: [0, 0.15, 0.4, 0.75, 1]
    });

    // 只观察页面里真实存在的 section
    for (var k2 in map) {
      var sec = d.getElementById(k2);
      if (sec) _navIO.observe(sec);
    }
  }

  /* =============================================================================
     3.5 元素入场：按序号递增延迟
     -----------------------------------------------------------------------------
     一排同类的元素（同屏 6~12 张卡片）**同时**淡入会显得像"整块炸出来"，
     依次入场才读得出"这是一个列表"。

     ★ 延迟必须封顶（MAX_STAGGER）。
       递增延迟的常见事故是"越往后等越久"：第 20 个元素要等 20×40=800ms，
       用户会以为页面卡住了。封顶后第 20 个和第 9 个同时出现 ——
       超过一屏的内容本来就在视口外，多等也没有意义。
     步长 42ms / 上限 8 档，是按"一屏能看到几个"倒推的。 */
  var STAGGER_STEP = 42;
  var STAGGER_MAX = 8;

  function bindStagger(root) {
    if (reduced()) {
      // 降级：不播入场，直接给终态。
      // ★ 不能只是不调用 —— .af-enter 的 CSS 初始值是 opacity:0，
      //   不给终态就等于"永远透明"，内容直接消失。
      var all = (root || d).querySelectorAll('.af-enter:not(.af-enter--in)');
      for (var k = 0; k < all.length; k++) all[k].classList.add('af-enter--in');
      return;
    }
    var groups = {};
    var list = (root || d).querySelectorAll('.af-enter');
    if (!list.length || !('IntersectionObserver' in w)) {
      for (var j = 0; j < list.length; j++) list[j].classList.add('af-enter--in');
      return;
    }
    // 同一父容器下的元素算一组，组内序号决定延迟
    for (var i = 0; i < list.length; i++) {
      var key = list[i].parentNode ? (list[i].parentNode.__afStaggerKey ||
        (list[i].parentNode.__afStaggerKey = 'g' + (groups.__n = (groups.__n || 0) + 1))) : 'solo';
      var idx = groups[key] === undefined ? 0 : groups[key];
      groups[key] = idx + 1;
      list[i].style.setProperty('--enter-delay', Math.min(idx, STAGGER_MAX) * STAGGER_STEP + 'ms');
    }

    // 复用同一个观察器：每次调用都 new 一个的话，动态插入内容会攒出一堆
    // 观察器，且它们还观察着已被替换掉的脱离文档的节点（不会自动回收）。
    if (!staggerIO) {
      staggerIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          en.target.classList.add('af-enter--in');
          staggerIO.unobserve(en.target);
        });
      }, {
        // 提前 10% 触发：等元素完全进入视口才播，视觉上会"慢半拍"
        rootMargin: '0px 0px -10% 0px',
        threshold: 0.01
      });
    }
    for (var m2 = 0; m2 < list.length; m2++) {
      if (!list[m2].classList.contains('af-enter--in')) staggerIO.observe(list[m2]);
    }
  }
  var staggerIO = null;

  /* =============================================================================
     4. 组件状态接线
     -----------------------------------------------------------------------------
     CSS 定了六种状态，但**加载态和错误态需要 JS 提供触发条件**。
     这里提供两个显式 API，让业务代码调用：

       afMotion.loading(btn, true/false)   按钮进入/退出加载态（自动禁用防重复点击）
       afMotion.error(el, message | null)  给字段挂错误文案 + aria-invalid

     ★ 为什么不用自动检测：
       「什么时候该显示 loading」是业务知识（这个请求代表什么），
       库猜不出来。让业务显式声明，比库去嗅探 DOM 可靠得多。
     ========================================================================== */
  function setLoading(btn, on) {
    if (!btn) return;
    if (on) {
      btn.setAttribute('data-loading', '1');
      btn.setAttribute('aria-busy', 'true');
      // 不用 disabled：disabled 会让元素从 Tab 序列里消失，
      // 键盘用户提交后就"不知道自己在哪、也无法取消"。
      // 改用 pointer-events:none（CSS 里已写） + aria-busy 表达状态。
    } else {
      btn.removeAttribute('data-loading');
      btn.removeAttribute('aria-busy');
    }
  }

  function setError(field, msg) {
    if (!field) return;
    if (!msg) {
      field.removeAttribute('data-error');
      var c = field.querySelector('.af-errtext');
      if (c) c.textContent = '';
      var inp = field.querySelector('.af-input, .af-textarea, input, textarea');
      if (inp) inp.removeAttribute('aria-invalid');
      return;
    }
    field.setAttribute('data-error', '');
    // 错误文案节点不存在就建一个 —— 保证「有错误一定有文案」，
    // 不会出现 aria-invalid 有了但用户看不到任何解释。
    var box = field.querySelector('.af-errtext');
    if (!box) {
      box = d.createElement('div');
      box.className = 'af-errtext';
      box.setAttribute('role', 'alert');    // 屏幕阅读器会立即播报
      field.appendChild(box);
    }
    box.textContent = msg;
    var inp2 = field.querySelector('.af-input, .af-textarea, input, textarea');
    if (inp2) {
      inp2.setAttribute('aria-invalid', 'true');
      // 把焦点送到出错字段：键盘用户不会因为一条看不见的错误而停在原地
      try { inp2.focus({ preventScroll: false }); } catch (e) { inp2.focus(); }
    }
  }

  /* =============================================================================
     5. 组件状态自动接线（页面加载时扫一遍）
     -----------------------------------------------------------------------------
     覆盖那些「标记了就能生效」的情况：
       data-loading="1"  → 自动补 aria-busy（HTML 里可能漏写）
       [aria-invalid]    → 自动找到所属 .af-field 并挂 data-error
       .af-field>.af-errtext 已存在 → 父级自动加 data-error
     ========================================================================== */
  function wireStates(root) {
    var scope = root || d;
    var l = scope.querySelectorAll ? scope.querySelectorAll('[data-loading="1"]') : [];
    for (var i = 0; i < l.length; i++) {
      l[i].setAttribute('aria-busy', 'true');
    }
    // 反向：aria-invalid 的输入框，其 .af-field 父级要挂 data-error
    var inv = scope.querySelectorAll ? scope.querySelectorAll('[aria-invalid="true"]') : [];
    for (var j = 0; j < inv.length; j++) {
      var f = inv[j].closest ? inv[j].closest('.af-field') : null;
      if (f) f.setAttribute('data-error', '');
    }
  }

  /* =============================================================================
     6. 启动
     ========================================================================== */
  function boot() {
    refreshDurations();
    wireStates(d);
    bindPageFade();
    bindScrollProgress();
    bindNavSpy();
    bindStagger(d);
    // 字体加载后度量值会变，导航区块位置也变了 → 重新观察
    if (d.fonts && d.fonts.ready && d.fonts.ready.then) {
      d.fonts.ready.then(function () { refreshDurations(); bindNavSpy(); })
        .catch(function () { });
    }
    /* ★ v2.45：视口尺寸变了要重读断点与时长。
       以前只在启动和字体就绪时读一次，于是：
         · 手机横竖屏一换，narrow()/isDesktop() 仍按旧断点判断
           → 抽屉该开不开、该关不关；
         · CSS 里窄屏断点会改 --af-s-* 间距，JS 侧的 T 时长也随主题变，
           旋转后动效时长与 CSS 写的不一致（表现为动画忽然变快/变慢）。
       refreshDurations() 本来就导出了（外部可调），但**全站没有任何
       resize 监听调用它** —— 能力在、接线缺。 */
    var rt = 0;
    w.addEventListener('resize', function () {
      // 去抖：拖窗口时 resize 每秒能触发几十次，getComputedStyle 不便宜
      clearTimeout(rt);
      rt = setTimeout(function () {
        refreshDurations();
        bindNavSpy();          // 区块位置随字号/间距变了，重新计算高亮目标
      }, 160);
    }, { passive: true });
  }

  /* ---------- 对外 API ---------- */
  w.afMotion = {
    // 时长（ms）。改 CSS 变量即可全站生效，这里只做只读暴露
    T: T,
    refreshDurations: refreshDurations,

    // 判定
    reduced: reduced,
    finePointer: finePointer,
    narrow: narrow,
    isDesktop: isDesktop,
    isSmall: isSmall,
    breakpoints: BP,

    // 页面转场
    pageFadeIn: pageFadeIn,
    pageFadeOut: pageFadeOut,

    // 入场编排
    stagger: bindStagger,

    // 组件状态
    loading: setLoading,
    error: setError,
    wire: wireStates,

    // 重新接线（动态插入内容后调用）
    refresh: function (root) {
      wireStates(root);
      bindStagger(root);
      bindNavSpy();
    },

    boot: boot
  };

  if (d.readyState === 'loading') {
    d.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window, document);
