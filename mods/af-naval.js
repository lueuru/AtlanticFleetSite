/* ============================================================
   AF Naval Ops UI —— 共享前端运行时
   提供：背景层渲染（海图网格 / 雷达扫描）、滚动入场、
         数字滚动、Toast、毛玻璃工具
   用法：<script src="/AtlanticFleetSite/mods/af-naval.js"></script> 然后 afNaval.boot()
   ============================================================ */
(function (w, d) {
  'use strict';

  var AF = {};
  /* af:static-mode 静态部署标记（由 static_api_offline.py 注入） */
  AF.STATIC = true;
  // 从本脚本自身的 URL 反推部署前缀：af-naval.js 位于 <BASE>/mods/af-naval.js
  AF.BASE = (function () {
    var p = '';
    try {
      var m = String(document.currentScript && document.currentScript.src || '')
        .match(/^(https?:\/\/[^/]+)(\/[^/]*)?(\/mods)?\/af-naval\.js/);
      if (m) p = m[2] || '';
    } catch (e) { }
    return p;                       // '' 表示挂在域名根路径
  })();


  /* 是否要跑重动效：小屏 / 省流 / 用户要求减弱动效 时关掉
     （毛玻璃要有东西可模糊才好看，所以极光层保留，只有粒子和光标会关） */
  AF.reduced = function () {
    try {
      if (w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
    } catch (e) { }
    return false;
  };
  AF.isSmall = function () { return w.innerWidth < 760; };

  /* ---------- 背景层：极光光斑 + 海图网格 + 雷达扫描 + 粒子星网 ---------- */
  AF.mountBackground = function () {
    if (d.querySelector('.af-bg')) return;
    var bg = d.createElement('div');
    bg.className = 'af-bg';
    bg.setAttribute('aria-hidden', 'true');

    /* 1) 极光：三团大尺寸彩色光斑缓慢漂移。
          这是让「毛玻璃」真正看得见的关键 —— 玻璃必须有东西可模糊，
          铺在纯色背景上的玻璃只是一块灰方块。 */
    var aurora = d.createElement('div');
    aurora.className = 'af-aurora';
    aurora.innerHTML =
      '<span class="af-blob af-blob--1"></span>' +
      '<span class="af-blob af-blob--2"></span>' +
      '<span class="af-blob af-blob--3"></span>' +
      '<span class="af-blob af-blob--4"></span>';
    bg.appendChild(aurora);

    /* 2) 粒子帆（canvas）：缓慢上浮的光点 + 近邻连线，海战声呐质感 */
    if (!AF.reduced() && !AF.isSmall()) {
      var cv = d.createElement('canvas');
      cv.className = 'af-particles';
      bg.appendChild(cv);
      AF.mountParticles(cv);
    }

    /* 3) 海图网格 + 雷达扫描 */
    var scope = d.createElement('div');
    scope.className = 'af-radar-scope';
    var sweep = d.createElement('div');
    sweep.className = 'af-radar-sweep';
    bg.appendChild(scope);
    bg.appendChild(sweep);

    d.body.insertBefore(bg, d.body.firstChild);
  };

  /* ---------- 粒子星网 ---------- */
  // ★ 取色必须从 CSS 变量读，跟着主题走。
  //   之前写死荧光青 rgba(224,177,92,1 / rgba(120,240,220)，
  //   与全站黄铜配色（--af-radar-rgb = 224,177,92）打架 —— 这是「配色冲突」的漏网之一。
  //   CSS 里换主题不用改这里，JS 会自动跟上。
  function particleRgb() {
    var fallback = '224,177,92';
    try {
      var v = w.getComputedStyle(d.documentElement).getPropertyValue('--af-radar-rgb');
      if (v && v.trim()) return v.trim();
    } catch (e) { }
    return fallback;
  }

  AF.mountParticles = function (cv) {
    var ctx = cv.getContext('2d');
    if (!ctx) return;
    var dpr = Math.min(w.devicePixelRatio || 1, 2);
    var W = 0, H = 0, pts = [], raf = 0, running = true;
    var COUNT = 0;
    var RGB = particleRgb();
    // ★ v2.27 性能：颜色串预生成。
    //   原来每对连线、每个光点、每一帧都在拼 'rgba(r,g,b,0.xxx)' 字符串并 toFixed(3)，
    //   78 个粒子 = 每帧约 6000 次字符串分配，纯属白烧 CPU。透明度只有 0.13 的量级，
    //   量化成 8 档肉眼无差别。
    var LINK_STEPS = 8, linkColors = [], DOT_STEPS = 6, dotColors = [], s;
    for (s = 0; s <= LINK_STEPS; s++) {
      linkColors.push('rgba(' + RGB + ',' + ((s / LINK_STEPS) * 0.13).toFixed(3) + ')');
    }
    for (s = 0; s <= DOT_STEPS; s++) {
      dotColors.push('rgba(' + RGB + ',' + (0.18 + (s / DOT_STEPS) * 0.42).toFixed(3) + ')');
    }
    var lastT = 0;

    function resize() {
      W = w.innerWidth; H = w.innerHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // 密度按面积走，避免大屏太稀、小屏太挤
      // ★ v2.27：上限从 78 降到 44。连线是两两配对，O(n²)：
      //   78 个 → 3003 对/帧，44 个 → 946 对/帧，减少 68% 的绘制量，
      //   而背景网格的观感几乎无损。
      COUNT = Math.round(Math.min(44, Math.max(22, (W * H) / 46000)));
      pts = [];
      for (var i = 0; i < COUNT; i++) {
        pts.push({
          x: Math.random() * W,
          y: Math.random() * H,
          vx: (Math.random() - 0.5) * 0.16,
          vy: -0.06 - Math.random() * 0.18,
          r: 0.7 + Math.random() * 1.5,
          a: 0.18 + Math.random() * 0.42
        });
      }
    }

    function frame(ts) {
      if (!running) return;
      // ★ v2.27：背景粒子降到约 30fps。它是纯装饰，跑满 60fps 只会多烧一倍 CPU，
      //   人眼完全看不出差别 —— 这也是第 8 册 §15.5 里 L7 那条遗留问题的正解。
      if (ts - lastT < 32) { raf = w.requestAnimationFrame(frame); return; }
      lastT = ts;
      ctx.clearRect(0, 0, W, H);
      // 先画近邻连线（透明度低，做「网」的感觉）
      var LINK = 128;
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        for (var j = i + 1; j < pts.length; j++) {
          var q = pts[j];
          var dx = p.x - q.x, dy = p.y - q.y;
          var dd = dx * dx + dy * dy;
          if (dd > LINK * LINK) continue;
          var t = 1 - Math.sqrt(dd) / LINK;
          ctx.strokeStyle = linkColors[t >= 1 ? LINK_STEPS : (t * LINK_STEPS) | 0];
          ctx.lineWidth = 0.6;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
      }
      // 再画光点
      for (var k = 0; k < pts.length; k++) {
        var o = pts[k];
        o.x += o.vx; o.y += o.vy;
        if (o.y < -12) { o.y = H + 12; o.x = Math.random() * W; }
        if (o.x < -12) o.x = W + 12;
        if (o.x > W + 12) o.x = -12;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r, 0, 6.2832);
        ctx.fillStyle = dotColors[Math.min(DOT_STEPS, ((o.a - 0.18) / 0.42 * DOT_STEPS) | 0)];
        ctx.fill();
      }
      raf = w.requestAnimationFrame(frame);
    }

    resize();
    frame();
    var rt = 0;
    w.addEventListener('resize', function () {
      clearTimeout(rt); rt = setTimeout(resize, 180);
    }, { passive: true });
    // 页面切走时停帧，省电
    d.addEventListener('visibilitychange', function () {
      if (d.hidden) { running = false; w.cancelAnimationFrame(raf); }
      else if (!running) { running = true; frame(); }
    });
  };

  /* ---------- 悬浮主题按钮：滚动阅读时让路 ----------
     按钮 fixed 在右下角，读者往下读时它正好压住正在看的那几行。
     向下滚动 → 淡出并微微下沉；向上滚动或停手 → 淡回。
     只控制 class，不改按钮自身的动画曲线。
     监听用被动模式 + rAF 节流，不阻塞滚动。 */
  AF._bindToggleHide = function () {
    var b = d.querySelector('.af-themetog');
    if (!b) return;
    var last = w.pageYOffset, ticking = false, idleT = 0;
    function update() {
      ticking = false;
      var y = w.pageYOffset;
      var dy = y - last;
      if (y < 40) {                       // 回到顶部一定显示
        d.body.classList.remove('af-tog-hide');
      } else if (dy > 6) {                // 明显向下滚 → 让路
        d.body.classList.add('af-tog-hide');
      } else if (dy < -6) {               // 向上滚 → 回来
        d.body.classList.remove('af-tog-hide');
      }
      last = y;
      // 停手 700ms 后淡回，保证「读完一段」时按钮是可点的
      clearTimeout(idleT);
      idleT = setTimeout(function () { d.body.classList.remove('af-tog-hide'); }, 700);
    }
    w.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }, { passive: true });

    // 双保险：指针进入右下角区域就立刻唤回按钮。
    // 这样「停手 700ms 淡回」的等待期里，用户想点也点得到。
    var hot = d.createElement('div');
    hot.style.cssText = 'position:fixed;right:0;bottom:0;width:150px;height:110px;z-index:8999;pointer-events:none';
    hot.addEventListener('pointerenter', function () { d.body.classList.remove('af-tog-hide'); });
    d.body.appendChild(hot);
  };

  /* ---------- rAF 节流工具 ----------
     指针事件（mousemove）在高刷屏上每帧能触发 5~8 次。
     原来的写法是「读 getBoundingClientRect → 写 style.transform」直接同步做，
     同一帧里反复读写会强制浏览器同步布局（layout thrashing），
     元素多时（仓库页 6 张卡片各挂 3 个效果）会明显掉帧。
     现在事件里只记录坐标，位移交给下一帧执行；同帧多次触发只算一次。
     ★ 只改执行时机，动画参数、时长、缓动曲线一律不动。 */
  AF.raf = function (fn) {
    var queued = false, lastArgs = null;
    return function () {
      lastArgs = arguments;
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        fn.apply(null, lastArgs);
      });
    };
  };

  /* ---------- 磁吸：元素被光标吸引（按钮 / 卡片） ---------- */
  AF.magnet = function (root) {
    if (AF.reduced()) return;
    var els = (root || d).querySelectorAll('.af-magnet:not([data-mag-ready])');
    for (var i = 0; i < els.length; i++) AF._bindMagnet(els[i]);
  };
  AF._bindMagnet = function (el) {
    el.setAttribute('data-mag-ready', '1');
    var strength = parseFloat(el.getAttribute('data-strength') || '0.26');
    var inner = el.querySelector('.af-btn-t') || el.querySelector('span:last-child');

    // 元素尺寸只在悬停开始时读一次并缓存：
    // 磁吸期间布局不变，没必要每帧重算 getBoundingClientRect。
    var box = null;
    el.addEventListener('mouseenter', function () { box = el.getBoundingClientRect(); });

    function apply(e) {
      if (!box) box = el.getBoundingClientRect();
      var dx = e.clientX - (box.left + box.width / 2);
      var dy = e.clientY - (box.top + box.height / 2);
      el.style.transform = 'translate(' + (dx * strength).toFixed(1) + 'px,' +
        (dy * strength).toFixed(1) + 'px)';
      // 内层文字反向轻微位移 → 产生纵深（视差）
      if (inner) {
        inner.style.transform = 'translate(' + (-dx * strength * 0.42).toFixed(1) + 'px,' +
          (-dy * strength * 0.42).toFixed(1) + 'px)';
      }
    }
    var move = AF.raf(apply);
    function out() {
      box = null;
      el.style.transition = 'transform .45s cubic-bezier(.175,.885,.32,1.275)';
      el.style.transform = '';
      if (inner) {
        inner.style.transition = 'transform .45s cubic-bezier(.175,.885,.32,1.275)';
        inner.style.transform = '';
      }
      setTimeout(function () {
        el.style.transition = ''; if (inner) inner.style.transition = '';
      }, 460);
    }
    el.addEventListener('mousemove', move);
    el.addEventListener('mouseleave', out);
  };

  /* ---------- 3D 倾斜卡片（鼠标位置驱动 rotateX/rotateY） ---------- */
  AF.tilt = function (root) {
    if (AF.reduced() || AF.isSmall()) return;
    var els = (root || d).querySelectorAll('.af-tilt:not([data-tilt-ready])');
    for (var i = 0; i < els.length; i++) AF._bindTilt(els[i]);
  };
  AF._bindTilt = function (el) {
    el.setAttribute('data-tilt-ready', '1');
    var max = parseFloat(el.getAttribute('data-tilt') || '7');
    el.style.transformStyle = 'preserve-3d';
    // 尺寸只在悬停开始时读一次（倾斜期间布局不变）
    var box = null;
    el.addEventListener('mouseenter', function () { box = el.getBoundingClientRect(); });
    var apply = function (e) {
      if (!box) box = el.getBoundingClientRect();
      var px = (e.clientX - box.left) / box.width - 0.5;   // -0.5 ~ 0.5
      var py = (e.clientY - box.top) / box.height - 0.5;
      el.style.transform = 'perspective(900px) rotateY(' + (px * max * 2).toFixed(2) +
        'deg) rotateX(' + (-py * max * 2).toFixed(2) + 'deg) translateZ(0)';
      // 高光跟着鼠标走
      el.style.setProperty('--mx', ((px + 0.5) * 100).toFixed(1) + '%');
      el.style.setProperty('--my', ((py + 0.5) * 100).toFixed(1) + '%');
    };
    el.addEventListener('mousemove', AF.raf(apply));
    el.addEventListener('mouseleave', function () {
      box = null;
      el.style.transition = 'transform .5s cubic-bezier(.16,1,.3,1)';
      el.style.transform = '';
      setTimeout(function () { el.style.transition = ''; }, 520);
    });
  };

  /* ---------- 技法：卡片光标详情（Cursor Card Detail） ----------
     桌面端悬停卡片时，一张小卡跟随光标浮出，补上首屏没放的关键信息
     （作者、版本、下载次数、简介全文开头）。
     为什么不是"点开看详情"：点开是打断，而悬停提示是**零成本**的——
     玩家扫一眼就能判断"这个 Mod 值不值得点"，不用为每个卡片都点一次再退出来。

     ★ 三条必须守住的约束：
     1) **绝不能挡点击**。提示层 pointer-events:none，且它是 body 直属节点，
        不在任何卡片内部 —— 否则鼠标移过去目标就变了，会把 hover 打断成闪烁。
     2) **只在桌面端启用**。触屏没有 hover 语义，做了只会是点一下闪一下。
        （CSS 里还有一道 @media (hover:none) display:none 的兜底。）
     3) **跟随要 lerp、不能硬贴**。直接贴光标会显得很"死"、像贴纸；
        稍微滞后一点才像"跟手的提示卡"。
  */
  var _peek = null, _peekCard = null, _peekX = 0, _peekY = 0, _peekRaf = 0;

  function peekEnsure() {
    if (_peek) return _peek;
    _peek = d.createElement('div');
    _peek.className = 'af-peek';
    _peek.setAttribute('aria-hidden', 'true');
    d.body.appendChild(_peek);
    return _peek;
  }

  // 跟随光标：每次 mousemove 只记录目标位置，实际位移在 rAF 里插值完成。
  // 一次 mousemove 只做一次赋值，比每次都读布局便宜得多。
  function peekFollow() {
    if (_peekRaf) return;
    _peekRaf = requestAnimationFrame(function () {
      _peekRaf = 0;
      if (!_peek) return;
      _peek.style.transform = 'translate3d(' + _peekX.toFixed(1) + 'px,' + _peekY.toFixed(1) + 'px,0)';
    });
  }

  function peekShow(card) {
    if (_peekCard === card) return;
    _peekCard = card;
    var el = peekEnsure();
    var meta = card.getAttribute('data-afx-peek') || '';
    var desc = card.getAttribute('data-afx-peek-desc') || '';
    var html = '';
    var parts = meta.split('|');
    if (parts[0]) html += '<div class="af-peek-nm">' + AF.esc(parts[0]) + '</div>';
    if (parts[1]) html += '<div class="af-peek-meta">' + AF.esc(parts[1]) + '</div>';
    if (desc) html += '<div class="af-peek-desc">' + AF.esc(desc) + '</div>';
    html += '<div class="af-peek-act">点卡片或「详情」看完整参数 →</div>';
    el.innerHTML = html;
    el.classList.add('is-on');
  }

  function peekHide() {
    _peekCard = null;
    if (_peek) _peek.classList.remove('is-on');
  }

  AF.mountPeek = function (root) {
    // ★ 前置条件一个都不能少：触屏/降级不启用，用户点了隐藏也不能再冒出来。
    if (AF.reduced && AF.reduced()) return;
    if (!w.matchMedia || !w.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    var onMove = function (e) {
      if (!_peekCard) return;
      var r = _peek.getBoundingClientRect();
      // 贴近光标右下，并做**边界翻转**：
      // 不翻的话卡片靠近屏幕右边/底部时会被视口切掉（提示框最常见的破相方式）。
      var x = e.clientX + 18;
      var y = e.clientY + 18;
      if (x + r.width > w.innerWidth - 10) x = e.clientX - r.width - 18;
      if (y + r.height > w.innerHeight - 10) y = e.clientY - r.height - 18;
      _peekX = Math.max(10, x);
      _peekY = Math.max(10, y);
      peekFollow();
    };

    var scope = root || d;
    scope.addEventListener('mouseover', function (e) {
      var card = e.target.closest ? e.target.closest('[data-afx-peek]') : null;
      if (card) peekShow(card); else if (_peekCard) peekHide();
    });
    scope.addEventListener('mouseout', function (e) {
      var card = e.target.closest ? e.target.closest('[data-afx-peek]') : null;
      // 从卡片内部移到卡片外部才算"离开"；
      // 只判 e.target 的话，在卡片内部的子元素之间移动会反复触发 hide/show 闪烁。
      if (card && card.contains(e.relatedTarget)) return;
      if (card) peekHide();
    });
    d.addEventListener('mousemove', onMove, { passive: true });
    // 滚动 / 改变大小时光标相对卡片的位置已失效，直接收起来
    w.addEventListener('scroll', peekHide, { passive: true });
    w.addEventListener('resize', peekHide);
    // 键盘 Tab 离开时也要收
    d.addEventListener('focusout', peekHide);
  };

  /* ---------- 自定义光标（lerp 缓动跟随 + 悬停放大） ---------- */
  AF.mountCursor = function () {
    if (AF.reduced() || AF.isSmall()) return;
    if (d.querySelector('.af-cursor')) return;
    var dot = d.createElement('div');
    dot.className = 'af-cursor';
    dot.setAttribute('aria-hidden', 'true');
    var ring = d.createElement('div');
    ring.className = 'af-cursor-ring';
    ring.setAttribute('aria-hidden', 'true');
    d.body.appendChild(ring); d.body.appendChild(dot);

    var mx = w.innerWidth / 2, my = w.innerHeight / 2;
    var rx = mx, ry = my, dx0 = mx, dy0 = my;
    var lerp = function (a, b, n) { return (1 - n) * a + n * b; };

    d.addEventListener('mousemove', function (e) {
      mx = e.clientX; my = e.clientY;
      d.body.classList.add('af-cursor-on');
    }, { passive: true });
    d.addEventListener('mouseleave', function () {
      d.body.classList.remove('af-cursor-on');
    });

    (function loop() {
      // 圆点跟得紧，圆环跟得松 → 拖尾感
      dx0 = lerp(dx0, mx, 0.35); dy0 = lerp(dy0, my, 0.35);
      rx = lerp(rx, mx, 0.13); ry = lerp(ry, my, 0.13);
      dot.style.transform = 'translate(' + dx0.toFixed(1) + 'px,' + dy0.toFixed(1) + 'px) translate(-50%,-50%)';
      ring.style.transform = 'translate(' + rx.toFixed(1) + 'px,' + ry.toFixed(1) + 'px) translate(-50%,-50%)';
      w.requestAnimationFrame(loop);
    })();

    // 悬停到可点元素时圆环放大
    d.addEventListener('mouseover', function (e) {
      var t = e.target;
      var hit = t && t.closest && t.closest('a,button,.af-card,.af-tilt,[data-help]');
      ring.classList.toggle('is-hot', !!hit);
    });
    d.addEventListener('mousedown', function () { ring.classList.add('is-down'); });
    d.addEventListener('mouseup', function () { ring.classList.remove('is-down'); });
  };

  /* ---------- 主题（日 / 夜） ----------
     必须在首屏渲染前把 class 打到 body 上，否则会闪一下白屏。
     优先级：localStorage 存的 > 系统偏好。 */
  AF.THEME_KEY = 'af_theme';
  AF._sysDark = function () {
    try { return !(w.matchMedia && w.matchMedia('(prefers-color-scheme: light)').matches); }
    catch (e) { return true; }
  };
  AF.currentTheme = function () {
    try {
      var v = w.localStorage ? w.localStorage.getItem(AF.THEME_KEY) : null;
      if (v === 'light' || v === 'dark') return v;
    } catch (e) { }
    return AF._sysDark() ? 'dark' : 'light';
  };
  /* 首屏立刻执行，不等 DOMContentLoaded */
  AF.applyTheme = function (t) {
    if (!t) t = AF.currentTheme();
    AF.currentTheme = function () { return t; };
    try { if (w.localStorage) w.localStorage.setItem(AF.THEME_KEY, t); } catch (e) { }
    var b = d.body;
    if (!b) return t;
    b.classList.remove('af-dark', 'af-light');
    b.classList.add(t === 'light' ? 'af-light' : 'af-dark');
    // 同步 <html>，避免滚动条区域配色不对
    var de = d.documentElement;
    de.classList.remove('dark');
    if (t === 'light') de.classList.add('af-html-light');
    else de.classList.add('dark');
    var tog = d.querySelector('.af-themetog .lbl');
    if (tog) tog.textContent = t === 'light' ? '夜间' : '日间';
    return t;
  };
  AF.toggleTheme = function (originXY) {
    // 点在按钮之外（比如键盘激活）时没有坐标，退化成无扩散的瞬时切换
    if (!originXY || !AF.radialTheme(originXY.x, originXY.y)) {
      return AF.applyTheme(AF.currentTheme() === 'light' ? 'dark' : 'light');
    }
    return AF.currentTheme();
  };

  /* ---------- 技法：径向主题过渡（Radial Theme Transition） ----------
     主题切换不再「啪」地整页变色，而是从你按下鼠标的那个点扩散出去，
     像往水里扔一颗石子 —— 新主题把旧主题从点击处顶开。

     ★ 为什么这个效果值得做：
       整页瞬时变色在深浅切换时是**视觉冲击最大的一帧**（白↔黑的明度跨度极大），
       而扩散把这一帧变成一个「过程」，注意力有了落点，体验上从"被打断"变成"跟着走"。
       这也正是 onetake 那套方法论的核心 —— 元素**接住**彼此，而不是瞬间替换。

     ★ 为什么用 View Transitions API 而不是手写 clip-path 动画：
       - 浏览器原生合成，比 JS 逐帧改 clip-path 快得多、不掉帧；
       - 圆角由浏览器算好，不会出现边缘锯齿；
       - 不支持时（老 Safari / 部分安卓 WebView）直接降级为瞬时切换。

     ★ 关键顺序（搞反了会看到"旧主题扩散成新主题"的反向动画）：
       startViewTransition(callback) 会**先截图旧状态**、执行 callback、再截图新状态，
       所以真正的 applyTheme 必须放在 callback **里面**。
       上一帧我们先把目标主题记到 _pendingTheme，这里再真正应用。
  */
  var _themeRaf = 0;
  AF.radialTheme = function (x, y, nextTheme) {
    var de = d.documentElement;
    if (!de || !d.startViewTransition || AF.reduced()) return false;   // 不支持就降级
    if (_themeRaf) { cancelAnimationFrame(_themeRaf); _themeRaf = 0; }

    // ★ 清理函数定义在 try **之外**：异常路径的 catch 也要用它，
    //   而定义在 try 内的话 catch 里就取不到（变量提升到函数作用域但没赋值）。
    //   清理逻辑只写一份 —— 写三遍迟早漏一处，漏掉的代价是
    //   「下一次主题切换从上一次的坐标开始扩散」。
    var settled = false;
    var cleanup = function () {
      if (settled) return;
      settled = true;
      try {
        de.classList.remove('afx-theme-radial');
        de.style.removeProperty('--afx-theme-x');
        de.style.removeProperty('--afx-theme-y');
        de.style.removeProperty('--afx-theme-r');
      } catch (e) { }
    };

    try {
      // 取到最远角的距离：扩散圆必须能盖住整个视口，否则四角会露出旧主题
      var r = Math.max(
        Math.hypot(x, y), Math.hypot(w.innerWidth - x, y),
        Math.hypot(x, w.innerHeight - y), Math.hypot(w.innerWidth - x, w.innerHeight - y)
      );
      // ★ 分成三个变量而不是一个复合值：CSS 的 clip-path 里要重复用坐标，
      //   分开后浏览器还能对 x/y 做解析优化，也不会因为复合字符串拆分而失效。
      de.style.setProperty('--afx-theme-x', x.toFixed(1) + 'px');
      de.style.setProperty('--afx-theme-y', y.toFixed(1) + 'px');
      de.style.setProperty('--afx-theme-r', r.toFixed(1) + 'px');
      de.classList.add('afx-theme-radial');
      AF._pendingTheme = nextTheme;

      // 上面刚设进去的三个变量，本次动画要用；cleanup 已经能清掉

      _themeRaf = requestAnimationFrame(function () {
        var vt;
        try {
          vt = d.startViewTransition(function () {
            AF.applyTheme(AF._pendingTheme);
          });
        } catch (e) {
          AF.applyTheme(AF._pendingTheme);   // 退回瞬时切换，功能不丢
          cleanup();
          return;
        }
        // ★ 必须加超时兜底，不能只依赖 .finished。
        //   实测 headless Edge 下 finished 超过 2 秒仍未 settle（无头环境动画时钟不走），
        //   真实浏览器里标签页切到后台同样会暂停动画 —— 那时 finished 永远不 resolve，
        //   残留的圆与旧坐标就会一直留着。
        if (vt && vt.finished && vt.finished.then) {
          vt.finished.then(cleanup, cleanup);   // 成功与失败都要清理
        }
        setTimeout(cleanup, 1500);              // 兜底：动画 0.58s，1.5s 足够
      });
      return true;
    } catch (e) {
      // 任何一步出错都必须把临时状态清干净，否则残留的圆形遮罩会挡住页面。
      // 复用同一个 cleanup：清理逻辑只写一份，避免"三条路径漏了一处"。
      try { cleanup(); } catch (e2) { }
      return false;
    }
  };
  /* 立即打上，避免闪白 */
  AF.applyTheme(AF.currentTheme());

  /* ---------- 挂载主题切换按钮 ---------- */
  AF.mountThemeTog = function () {
    if (d.querySelector('.af-themetog')) return;
    var b = d.createElement('button');
    b.className = 'af-themetog';
    b.type = 'button';
    b.setAttribute('aria-label', '切换日间 / 夜间主题');
    b.innerHTML =
      '<span class="i-sun">' + AF.icon.sun + '</span>' +
      '<span class="i-moon">' + AF.icon.moon + '</span>' +
      '<span class="lbl"></span>';
    // ★ v2.40：把点击坐标传给 toggleTheme → 径向主题过渡从你按下的那点扩散。
    //   不传坐标就退化成原来的瞬时切换（键盘激活、移动端点不到 getBoundingClientRect 的极端情况）。
    b.addEventListener('click', function (e) {
      var r = b.getBoundingClientRect();
      var next = AF.currentTheme() === 'light' ? 'dark' : 'light';
      if (AF.radialTheme(r.left + r.width / 2, r.top + r.height / 2, next)) return;
      AF.applyTheme(next);
    });
    d.body.appendChild(b);
    var lbl = b.querySelector('.lbl');
    lbl.textContent = AF.currentTheme() === 'light' ? '夜间' : '日间';
  };

  /* ---------- 把页面里 <span data-ico="qq"></span> 的占位填成真图标 ---------- */
  AF.mountIcons = function (root) {
    var els = (root || d).querySelectorAll('[data-ico]:not([data-ico-done])');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var name = el.getAttribute('data-ico');
      if (AF.icon[name]) {
        el.innerHTML = AF.icon[name];
        el.setAttribute('data-ico-done', '1');
      }
    }
  };

  /* ---------- 滚动入场 ---------- */
  AF.mountReveal = function (root) {
    var nodes = (root || d).querySelectorAll('.af-reveal:not(.af-in)');
    if (!nodes.length) return;
    if (!('IntersectionObserver' in w)) {
      for (var i = 0; i < nodes.length; i++) nodes[i].classList.add('af-in');
      return;
    }
    // ★ v2.25：复用同一个观察器。
    //   原来每次调用都 new 一个 IntersectionObserver，而 AF.refresh 会在每次 render()
    //   时被调用（搜索框每按一个键就一次）—— 在搜索框敲 20 个字符就攒 20 个观察器，
    //   每个都还观察着上一轮已被 innerHTML 替换掉的**脱离文档的节点**。
    //   IntersectionObserver 对 target 持强引用，那些节点永远不会被回收，
    //   于是长时间搜索 / 反复切筛选后内存单调增长，页面越来越卡。
    if (!AF._revealIO) {
      AF._revealIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          var el = e.target;
          var delay = parseInt(el.getAttribute('data-delay') || '0', 10);
          setTimeout(function () { el.classList.add('af-in'); }, delay);
          AF._revealIO.unobserve(el);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    }
    for (var j = 0; j < nodes.length; j++) AF._revealIO.observe(nodes[j]);
  };

  /* ---------- 数字滚动（用于统计数据） ---------- */
  AF.countUp = function (el, to, dur, fmt) {
    dur = dur || 1100;
    var from = 0, start = null;
    // ★ v2.24：把 rAF 句柄挂在元素上，好让下一次启动前能取消旧的。
    //   仓库页 setCount 会重新 countUp，而 boot() 阶段 mountCounters 已经起过一个
    //   1200ms 的循环 —— 两个循环交替写同一个 textContent，数字在 1 秒多里每帧闪烁，
    //   根本读不出来。以前只能靠 removeAttribute('data-done') 绕开去重，
    //   副作用是旧循环并不停止，只是标记被抹掉了。
    if (el.__afCountRAF) { cancelAnimationFrame(el.__afCountRAF); el.__afCountRAF = 0; }
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      var v = from + (to - from) * eased;
      el.textContent = fmt ? fmt(v) : Math.round(v);
      if (p < 1) { el.__afCountRAF = requestAnimationFrame(step); }
      else { el.__afCountRAF = 0; }
    }
    el.__afCountRAF = requestAnimationFrame(step);
  };

  AF.mountCounters = function () {
    var els = d.querySelectorAll('[data-count]');
    if (!els.length) return;
    function run(el) {
      if (el.getAttribute('data-done')) return;
      el.setAttribute('data-done', '1');
      var to = parseFloat(el.getAttribute('data-count')) || 0;
      AF.countUp(el, to, 1200, function (v) { return Math.round(v).toLocaleString(); });
    }
    if (!('IntersectionObserver' in w)) { for (var i=0;i<els.length;i++) run(els[i]); return; }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } });
    }, { threshold: 0.3 });
    for (var k = 0; k < els.length; k++) io.observe(els[k]);
  };

  /* ---------- Toast ---------- */
  AF.toast = function (msg, kind) {
    var t = d.getElementById('af-toast');
    if (!t) {
      t = d.createElement('div');
      t.id = 'af-toast';
      t.className = 'af-toast';
      // ★ v2.25：补 aria-live。CSS 里 .af-toast 默认 opacity:0，
      //   读屏软件读不到这个元素 —— 所有错误提示（上传失败、密钥失效、解析失败…）
      //   对读屏用户等于不存在，他们只会以为按钮坏了。
      //   role=status 配 aria-live=polite：礼貌播报，不打断当前朗读。
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
      d.body.appendChild(t);
    }
    // 错误类提示改用 alert：需要立刻播报（视觉上样式不变，只是语义不同）
    if (kind === 'err') t.setAttribute('role', 'alert');
    else t.setAttribute('role', 'status');
    t.textContent = msg;
    t.className = 'af-toast' + (kind ? ' af-toast--' + kind : '');
    t.classList.add('show');
    clearTimeout(AF._toastTimer);
    // 错误停留更久：2.6 秒对读屏用户读完一句提示是够紧的
    AF._toastTimer = setTimeout(function () { t.classList.remove('show'); },
      (kind === 'err' || kind === 'warn') ? 5000 : 2600);
  };

  /* ---------- 网络请求助手 ---------- */
  /* af:static-mode 静态部署版：本副本没有 Python 后端。
     直接 reject 而不是发起 fetch —— 后者要等 8 秒超时才走兜底，
     表现为「页面打开后卡片区空着不动」，用户会以为页面坏了。 */
  AF.api = function (path, opts) {
    opts = opts || {};
    if (AF.STATIC) return Promise.reject({ ok: false, error: 'static' });
    var init = { method: opts.method || 'GET', headers: {} };
    if (opts.key) init.headers['X-Admin-Key'] = opts.key;
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch('/api' + path, init).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; });
    });
  };

  /* ---------- 本地保存（管理员密钥等） ---------- */
  AF.store = {
    get: function (k, dv) {
      try { var v = localStorage.getItem('af_' + k); return v === null ? dv : v; }
      catch (e) { return dv; }
    },
    set: function (k, v) { try { localStorage.setItem('af_' + k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem('af_' + k); } catch (e) {} }
  };

  /* ---------- 转义 ---------- */
  AF.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  /* ---------- 站点自有图标 ------------------------------------------------
     ★ v2.42：原先这里的 qq / bilibili 是**第三方品牌的官方路径**
       （取自 simple-icons，MIT 授权，但**图标本身的著作权属于那些公司**）。
       现在全站不出现任何第三方品牌符号，改为两个语义等价的中性图形：
         share  —— 「分享 / 分发」：分发本身与用哪个平台无关。
                   之前挂具体平台的图标，读者会误以为"只能通过这个平台"。
         author —— 「作者 / 创作者」：左边是翻开的册子，
                   而不是"视频"—— 本站是文档/教程站，册子更贴切。
       两者都是纯几何路径 + currentColor，不含任何第三方素材成分，
       且沿用既有的挂载机制（data-ico 占位 → mountIcons 填内联 svg）。 --- */
  AF.icon = {
    /* 分享 / 分发 */
    share: '<svg class="af-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M7 4.6h10"/><path d="M7 19.4h10"/>' +
      '<path d="M7 4.6v4.2a2 2 0 0 0 2 2h8"/>' +
      '<path d="M17 19.4v-4.2a2 2 0 0 0-2-2H7" stroke-opacity=".55"/>' +
      '<path d="M14.4 8.4l2.6 2.4-2.6 2.4"/>' +
      '<path d="M9.6 10.8 7 13.2l2.6 2.4" stroke-opacity=".55"/>' +
      '</g>' +
      '<circle cx="7" cy="4.6" r="2" fill="currentColor"/>' +
      '<circle cx="17" cy="19.4" r="2" fill="currentColor"/></svg>',
    /* 作者 / 创作者（左侧是翻开的册子） */
    author: '<svg class="af-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="8.2" r="3.6"/>' +
      '<path d="M4.8 19.4a7.4 7.4 0 0 1 14.4 0"/>' +
      '<path d="M3 6.2h4.2a1.4 1.4 0 0 1 1.4 1.4v6.8a1.2 1.2 0 0 0-1.2-1.2H3z" stroke-width="1.35" fill="currentColor" fill-opacity=".16"/>' +
      '</g></svg>',
    /* 空状态（无结果）—— 空心圆环，比字符 ∅ 干净 */
    empty: '<svg class="af-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
      '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M6.2 6.2l11.6 11.6"/></svg>',
    /* 上传（拖拽区）—— 向上箭头入托盘 */
    uploadBig: '<svg class="af-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M12 15.5V4.2M8.2 7.8 12 4l3.8 3.8"/>' +
      '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M4.5 14.5v3.2a1.8 1.8 0 0 0 1.8 1.8h11.4a1.8 1.8 0 0 0 1.8-1.8v-3.2"/></svg>',
    /* 审核通过 —— 圆圈内对勾 */
    pass: '<svg class="af-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
      '<path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="m8.2 12.2 2.6 2.6 5-5.2"/></svg>',
    /* 锁（登录门）—— 锁梁 + 锁体 */
    lock: '<svg class="af-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<rect x="4.8" y="10.2" width="14.4" height="9.4" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
      '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M8.2 10.2V7.9a3.8 3.8 0 0 1 7.6 0v2.3"/>' +
      '<circle cx="12" cy="14.9" r="1.35" fill="currentColor"/></svg>',
    /* 扳手（设置/审核台）—— 比齿轮更贴合「后台操作」 */
    wrench: '<svg class="af-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ' +
      'd="M20.2 6.3a4.6 4.6 0 0 1-6.1 5.9L7.4 18.9a2 2 0 1 1-2.8-2.8l6.7-6.7a4.6 4.6 0 0 1 5.9-6.1l-2.8 2.8 2.2 2.2 2.8-2.8Z"/></svg>',
    /* 清单（审核列表） */
    list: '<svg class="af-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M9 6.5h11M9 12h11M9 17.5h11"/>' +
      '<path fill="currentColor" d="M4.3 6.5a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Zm0 6a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Zm0 6a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4Z"/>' +
      '</svg>',
    /* 时间（操作日志） */
    clock: '<svg class="af-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
      '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M12 7.4V12l3 1.9"/></svg>',
    /* 太阳（日间模式按钮） */
    sun: '<svg class="af-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<circle cx="12" cy="12" r="4.2" fill="currentColor"/>' +
      '<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' +
      '<path d="M12 2.6v2.3M12 19.1v2.3M2.6 12h2.3M19.1 12h2.3M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6"/></g></svg>',
    /* 月亮（夜间模式按钮） */
    moon: '<svg class="af-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path fill="currentColor" d="M20.4 14.2a8.3 8.3 0 0 1-10.6-10.6 8.4 8.4 0 1 0 10.6 10.6"/></svg>',
    /* 文档 */
    docs: '<svg class="af-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M4.5 5.5A1.5 1.5 0 0 1 6 4h6.5l4.5 4.5V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19z"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M12.5 4v5h4.5M8 13.5h7M8 16.5h4.5"/></svg>',
    /* 仓库（箱子） */
    box: '<svg class="af-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M12 3.2 20 7.6v8.8L12 20.8 4 16.4V7.6z"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="m4 7.6 8 4.4 8-4.4M12 12v8.8"/></svg>',
    /* 后台（控制台/齿轮） */
    cog: '<svg class="af-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" stroke-width="1.7"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M12 3.2v2.4M12 18.4v2.4M20.8 12h-2.4M5.6 12H3.2M18.2 5.8l-1.7 1.7M7.5 16.5l-1.7 1.7M18.2 18.2l-1.7-1.7M7.5 7.5 5.8 5.8"/></svg>',
    /* 上传 */
    upload: '<svg class="af-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M12 16.5V4.8M7.6 9.2 12 4.8l4.4 4.4M4.8 19.2h14.4"/></svg>',
    /* 复制 */
    copy: '<svg class="af-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<rect x="8.6" y="8.6" width="10.6" height="10.6" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M5.6 15.4H5a1 1 0 0 1-1-1V5.8a1 1 0 0 1 1-1h8.6a1 1 0 0 1 1 1v.6"/></svg>',
    /* 对勾 */
    check: '<svg class="af-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.6 4.6L19 7.6"/></svg>',
    /* 箭头 */
    arrow: '<svg class="af-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4.8 12h14M13 6.3l5.7 5.7-5.7 5.7"/></svg>',
    /* 指南针 / 罗盘 —— 品牌标记 */
    compass: '<svg class="af-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="5.4" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".55"/><path fill="currentColor" d="M15.4 8.6 13.6 13.6 8.6 15.4 10.4 10.4Z"/></svg>'
  };

  /* ---------- 社群与站点入口（全站统一，改这一处全站生效） ---------- */
  /* Mod 大类：Mod 不只是「改数值 + 加船」，别人做的模型 / 音频 / 界面 / 剧本都算 */
  AF.KIND = {
    param:    '参数改装',
    ship:     '自定义舰船',
    fleet:    '自定义编队',
    model:    '模型 / 贴图',
    audio:    '音频 / 语音',
    ui:       '界面 / 皮肤',
    scenario: '剧本 / 战役',
    localize: '文本 / 翻译',
    tool:     '工具 / 脚本',
    pack:     '整合包'
  };
  AF.KIND_DESC = {
    param:    '调数值：火力 / 鱼雷 / 传感器 / 经济 / AI / 航空',
    ship:     '新增或改写舰级、武器、搭载',
    fleet:    '编队编制、阵型、出击规则',
    model:    '3D 模型（AssetBundle）、涂装、图标等美术资源',
    audio:    '音效、语音、背景音乐',
    ui:       '界面配色、字体、图标、布局皮肤',
    scenario: '关卡、剧情、任务',
    localize: '术语表、命名替换',
    tool:     '辅助工具、批量脚本',
    pack:     '把上面几类打包成一键安装'
  };

  /* ★ v2.42：第三方平台的链接与号码**整体移除**。
     原来这里有 qqGroup / qqJoin / bilibili 三个字段，全站 20+ 处引用它们
     （顶栏、抽屉、页脚、复制按钮、404 页…），是残留最集中的一处。
     现在只保留站内入口 —— 联系方式改为「在站内文档里问」，
     不再把读者引导到站外的具体平台。 */
  AF.link = {
    docs: '/AtlanticFleetSite/docs/',
    repo: '/AtlanticFleetSite/mods/',
    admin: '/AtlanticFleetSite/admin/',
    author: 'uruban',
    /* 文档站内页（已做目录化处理，必须用「目录 + 尾斜杠」形式，
       写成 xxx.html 会 404 —— 这是 nginx 纯静态干净 URL 的硬要求） */
    docPaths: {
      quickstart: '/AtlanticFleetSite/docs/quickstart/',
      panel: '/AtlanticFleetSite/docs/use/panel/',
      devStart: '/AtlanticFleetSite/docs/dev/start/',
      faq: '/AtlanticFleetSite/docs/faq/',
      repoStart: '/AtlanticFleetSite/docs/repo/start/',
      repoBrowse: '/AtlanticFleetSite/docs/repo/browse/',
      repoPublish: '/AtlanticFleetSite/docs/repo/publish/',
      repoAdmin: '/AtlanticFleetSite/docs/repo/admin/',
      changelog: '/AtlanticFleetSite/docs/changelog/',
      credits: '/AtlanticFleetSite/docs/credits/'
    }
  };

  /* ★ v2.42：原「复制 QQ 群号」入口已移除（第三方平台 + 号码）。
     保留一个同签名的函数，让既有的 data-copy-* 事件委托不必改：
     现在它把读者带到**站内**的帮助页 —— 那里有安装、常见问题与联系说明。
     这是"移除第三方但不断信息出口"的做法：读者仍有地方可去。 */
  AF.openHelp = function () {
    var L = AF.link;
    if (L.docPaths && L.docPaths.faq) {
      w.location.href = L.docPaths.faq;
      return;
    }
    w.location.href = L.docs;
  };

  /* 渲染全站统一页脚：每个页面都能跳到其它所有页面 + 社群 */
  /* 备案号：填了才显示（形如 鄂ICP备XXXXXXXX号）。
     ★ v2.25：改成从 /mods/icp.js 读。备案号是一个**全站唯一数据源**，
        放在独立的小文件里，是因为首页为了不引入本文件的全部副作用（主题、粒子、
        自定义光标…）刻意不加载 af-naval.js —— 结果首页的备案号区块永远填不上内容，
        而工信部要求所有对外页面都展示。现在两个地方读同一个值，不会再不同步。 */
  AF.ICP = (w.AF_ICP || '');

  /* 备案完成前的访问方式说明。
     只在「用 IP 访问」时提示一句，本机调试（localhost/default.com）不显示。 */
  /* ★ v2.37：文案改为读 /mods/icp.js 的 AF_VIA_NOTE。
     同一段话以前在 af-naval.js 和首页内联脚本里各写一遍，措辞已经不一致了
     ——这正是「同一文案多处维护」的典型烂尾。 */
  AF.viaNote = function () {
    var h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === 'default.com') return '';
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h)) {
      return (w.AF_VIA_NOTE || '') + '（' + h + '）';
    }
    return '';
  };

  AF.renderFooter = function (host) {
    if (!host) return;
    var L = AF.link;
    var here = location.pathname.replace(/\/index\.html$/, '/');
    if (here.charAt(here.length - 1) !== '/') here += '/';
    function nav(href, text, ext) {
      var cur = (href === here);
      return '<a class="af-flink' + (cur ? ' is-here' : '') + '" href="' + href + '"' +
        (ext ? ' target="_blank" rel="noopener"' : '') + '><span class="af-flink-t">' + text + '</span>' +
        (cur ? '<span class="af-cur">当前</span>' : '') + '</a>';
    }
    host.innerHTML =
      '<div class="af-fcol af-fcol--brand">' +
        '<div class="af-brand af-brand--foot">' +
          '<span class="mark">' + AF.icon.compass + '</span>' +
          '<span class="txt"><span class="nm">大西洋舰队 Mod</span>' +
          '<span class="sb">ATLANTIC FLEET · MOD FRAMEWORK</span></span>' +
        '</div>' +
        '<p class="af-fnote">由 ' + L.author + ' 制作 · 参数微调 / 自制舰船 / 在线仓库<br>' +
        '弄不明白的，先看下面的常见问题。</p>' +
        '<div class="af-fsocial">' +
          '<a class="af-btn af-btn--primary af-magnet" href="' + L.docPaths.quickstart + '">' +
            '<span class="af-brandico">' + AF.icon.compass + '</span>' +
            '<span class="af-btn-t">五分钟上手</span></a>' +
          '<a class="af-btn af-btn--ghost af-magnet" href="' + L.docPaths.faq + '">' +
            '<span class="af-brandico">' + AF.icon.share + '</span>' +
            '<span class="af-btn-t">常见问题</span></a>' +
        '</div>' +
      '</div>' +
      '<div class="af-fcol">' +
        '<h4>站点</h4>' +
        nav(L.repo, 'Mod 仓库') +
        nav(L.docs, '使用文档') +
        nav(L.admin, '管理后台') +
        nav(L.docPaths.repoStart, '仓库怎么用') +
      '</div>' +
      '<div class="af-fcol">' +
        '<h4>文档</h4>' +
        nav(L.docPaths.quickstart, '五分钟上手') +
        nav(L.docPaths.panel, '游戏内控制台') +
        nav(L.docPaths.devStart, '我要做 Mod') +
        nav(L.docPaths.faq, '常见问题') +
        nav(L.docPaths.changelog, '更新日志') +
      '</div>' +
      '<div class="af-fcol">' +
        '<h4>联系</h4>' +
        nav(L.docPaths.repoPublish, '上传我的 Mod') +
        nav(L.docPaths.credits, '作者与致谢') +
        nav(L.repo + '#decoder', '解析分享码') +
      '</div>' +
      // ICP 备案号（工信部要求已备案网站在页面底部展示并链接到备案系统）
      // AF.ICP 为空时不显示；备案通过后把号填进下面这行即可。
      (AF.ICP ? '<div class="af-ficp"><a href="https://beian.miit.gov.cn/" ' +
                'target="_blank" rel="noopener noreferrer">' + AF.ICP + '</a></div>' : '') +
      // 备案完成前部分网络下域名会被拦，走 IP 是正常路径 —— 说明一下，
      // 免得访客以为网站坏了。
      '<div class="af-fvia">' + AF.viaNote() + '</div>';
    host.classList.add('af-foot--rich', 'af-glass-deep');
    AF.magnet(host);
  };

  /* ★ v2.42：原「复制群号」的事件委托整体移除。
     保留 data-help-* 的委托入口，行为是「跳站内帮助页」。
     为什么留这个：磁吸效果要识别"哪些元素参与跟随"，data-help-* 与
     原来的 data-copy-qq 走的是同一套判断；改名后要同步改下面那处 closest。 */
  if (!AF._helpBound) {
    AF._helpBound = true;
    d.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-help]') : null;
      if (t) { AF.openHelp(); return; }
    });
  }

  /* =========================================================
     手机端抽屉导航（v2.19）
     为什么要做：实测 390px 屏上 .af-nav 实际宽 540px，
     「管理后台」被截断、「B 站」「QQ 群」整条落在屏幕右侧点不到。
     窄屏隐藏横排链接，改用汉堡按钮 + 抽屉。

     ★ 关键：抽屉打开后 450ms 内遮罩不接受点击。
       遮罩是 inset:0 铺满全屏的，而抽屉是**同一次点击**才出现的，
       这次手势剩下的部分会落在刚出现的遮罩上 → 开了又关，
       肉眼看就是"点了没反应"。这是真机上最难查的那类故障。
     ========================================================= */
  AF.mountMnav = function () {
    var burger = d.getElementById('afBurger');
    var box = d.getElementById('afMnav');
    if (!burger || !box || box.__afMnavBound) return;
    box.__afMnavBound = '1';

    var panel = box.querySelector('.af-mnav__panel');
    var scrim = box.querySelector('.af-mnav__scrim');
    var ARM_MS = 450;
    var armedAt = 0;
    var now = function () {
      return (w.performance && w.performance.now) ? w.performance.now() : Date.now();
    };
    var armed = function () { return now() - armedAt < ARM_MS; };

    function open() {
      if (box.classList.contains('is-open')) return;
      armedAt = now();
      box.hidden = false;
      // 强制回流，保证 transform 过渡真的跑起来
      void box.offsetWidth;
      box.classList.add('is-open');
      burger.setAttribute('aria-expanded', 'true');
      d.documentElement.style.overflow = 'hidden';
      d.body.classList.add('af-mnav-open');
      // 武装期让遮罩彻底不可点，双保险
      box.classList.add('is-arming');
      setTimeout(function () { box.classList.remove('is-arming'); }, ARM_MS + 20);
    }
    function close() {
      if (!box.classList.contains('is-open')) return;
      box.classList.remove('is-open');
      box.classList.remove('is-arming');
      burger.setAttribute('aria-expanded', 'false');
      d.documentElement.style.overflow = '';
      d.body.classList.remove('af-mnav-open');
      setTimeout(function () { if (!box.classList.contains('is-open')) box.hidden = true; }, 320);
    }
    function onScrim(e) {
      if (armed()) { e.preventDefault(); e.stopPropagation(); return; }
      close();
    }

    burger.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (box.classList.contains('is-open')) close(); else open();
    });
    scrim.addEventListener('click', onScrim);
    scrim.addEventListener('touchend', function (e) {
      if (armed()) { e.preventDefault(); e.stopPropagation(); return; }
      close();
    }, true);
    d.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('[data-close]')) { e.preventDefault(); close(); }
      else if (t && t.closest && t.closest('.af-mnav__a')) { setTimeout(close, 60); }
    });
    d.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && box.classList.contains('is-open')) { e.preventDefault(); close(); }
    });
    // 从窄屏拉宽到宽屏时销毁状态，别留下挡内容的遮罩
    w.addEventListener('resize', function () {
      if (w.innerWidth > 860) close();
    }, { passive: true });
  };

  /* ---------- 非 HTTPS 访问的「切到安全访问」提示 ---------- */
  function mountHttpsHint() {
    if (location.protocol === 'https:') return;
    if (d.getElementById('afHttpsHint')) return;
    var box = d.createElement('div');
    box.id = 'afHttpsHint';
    // 用 fixed 贴顶部，不插进页面流，避免顶乱原有布局
    box.setAttribute('style', [
      // ★ v2.34：必须留在**文档流内**，不能用 fixed/sticky。
      //   试过贴顶部 → 压住顶栏汉堡（6 项「汉堡被抢」）；
      //   改贴底部 → 压住主题按钮（16 项「主题钮被抢」）。
      //   fixed 元素天生会盖住别人的点击区，而本站顶部和底部都有固定元素。
      //   放在流内最省事：打开页面第一眼就能看到，滚动后自然消失，不与任何东西冲突。
      'position:static', 'width:100%',
      'display:flex', 'gap:10px', 'align-items:center', 'justify-content:center',
      'flex-wrap:wrap', 'padding:8px 14px', 'font-size:13px', 'line-height:1.5',
      'background:rgba(28,20,8,.94)', 'color:#f4e3c1',
      'border-bottom:1px solid rgba(224,177,92,.45)',
      'box-shadow:0 4px 18px -6px rgba(0,0,0,.6)'
    ].join(';'));
    var txt = d.createElement('span');
    txt.textContent = '当前是 HTTP 访问，浏览器会标记「不安全」（内容其实没被篡改）。';
    var btn = d.createElement('a');
    btn.textContent = '切换到安全访问';
    btn.href = 'https://' + location.host + location.pathname + location.search + location.hash;
    btn.setAttribute('style', [
      'padding:4px 12px', 'border-radius:999px', 'font-weight:600',
      'background:#e0b15c', 'color:#1a1206', 'text-decoration:none'
    ].join(';'));
    var close = d.createElement('button');
    close.textContent = '×';
    close.setAttribute('aria-label', '关闭提示');
    close.setAttribute('style', [
      'border:0', 'background:transparent', 'color:#f4e3c1',
      'font-size:17px', 'line-height:1', 'cursor:pointer', 'padding:0 2px'
    ].join(';'));
    close.onclick = function () { if (box.parentNode) box.parentNode.removeChild(box); };
    box.appendChild(txt); box.appendChild(btn); box.appendChild(close);
    d.body.appendChild(box);
  }

  AF.boot = function () {
    // ★ v2.33：非 HTTPS 访问时，页面顶部挂一条「切到安全访问」的提示。
    //   浏览器地址栏那个「不安全」标记很多人看不懂、也不知道怎么消除 ——
    //   实际上只要把地址换成 https:// 就没了（本站两张证书都有效）。
    //   这里直接把当前地址的 https 版本做成按钮，点一下就走，不用来回改地址栏。
    //   刻意不自动跳转：自动跳转会在证书出问题时把人锁死在 https 上，
    //   而「给个按钮让他自己决定」永远是最安全的做法。
    try { mountHttpsHint(); } catch (e) { }
    AF.mountThemeTog();
    AF._bindToggleHide();
    AF.mountBackground();
    AF.mountIcons();
    AF.mountReveal();
    AF.mountCounters();
    AF.mountCursor();
    // ★ v2.40：卡片光标详情只需在 boot 挂一次 —— 它用事件委托监听 document，
    //   异步渲染出来的卡片（仓库页的 Mod 卡片就是）同样能被捕获，
    //   放进 refresh 反而会重复注册监听器。
    AF.mountPeek(d);
    AF.magnet(d);
    AF.tilt(d);
    AF.mountMnav();
    // 页脚：页面里放 <footer data-af-foot></footer> 即自动填充
    var f = d.querySelector('[data-af-foot]');
    if (f) AF.renderFooter(f);
    // 页面后续动态插入的内容也自动接管
    AF.refresh = function (root) {
      AF.mountIcons(root); AF.magnet(root); AF.tilt(root);
      // ★ v2.27：动效编排层（afx.js）启用时，滚动入场交给 GSAP ScrollTrigger，
      //   这里必须跳过 mountReveal —— 两套入场同时跑会抢着改同一个元素的样式，必然抖动。
      //   afx 未启用（库没加载 / 用户要求减少动效）时仍走原来的 IntersectionObserver，
      //   保证「没有动画也要能看到内容」。
      if (AF.motion && AF.motion.enabled) { AF.motion.scanReveal(root); return; }
      AF.mountReveal(root);
    };
  };

  /* 跟随系统：用户没手动选过时，系统一变就跟着变 */
  try {
    if (w.matchMedia) {
      var mq = w.matchMedia('(prefers-color-scheme: light)');
      var onChg = function () {
        try { if (w.localStorage && w.localStorage.getItem(AF.THEME_KEY)) return; } catch (e) { }
        AF.applyTheme(mq.matches ? 'light' : 'dark');
      };
      if (mq.addEventListener) mq.addEventListener('change', onChg);
      else if (mq.addListener) mq.addListener(onChg);
    }
  } catch (e) { }

  w.afNaval = AF;
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', AF.boot);
  else AF.boot();
})(window, document);
