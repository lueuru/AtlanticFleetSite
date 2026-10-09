/* ================================================================
   首页板块数据渲染（v2.49）
   ---------------------------------------------------------------
   数据源只有一个：http://127.0.0.1:8899/content（经 nginx 暴露为 /api/content）
   ★ 为什么要请求而不是把内容写死在 HTML 里
     内容要在后台能改。写死的话每次改文案都要改 HTML 再传一次，
     而且会出现"后台改了、首页没变"的错位（两处真相源）。
     ★ 所以：**HTML 里只有骨架，内容一律来自接口。**

   ★ 三条降级原则（每一条都对应一种真实故障）
     1. 接口挂了 / 404 → 板块显示占位文案，**其余板块照常显示**。
        不能因为一个接口失败整页空白。
     2. 数据为空 → 显示"暂无内容"，不显示空白大洞。
     3. JS 完全不执行 → HTML 里的静态骨架仍在（轮播第一张、
        三个入口卡片都是静态的），页面依然可读。
   ================================================================ */
(function () {
  'use strict';

  var API = '/api/content';
  // ★ 轮播自动切换间隔。放在这里而不是 CSS 里，因为它是**逻辑**不是样式。
  var HERO_MS = 6000;
  // ★ 加载超时（毫秒）。
  //   为什么必须自己设：fetch **没有内置超时**。后端进程被计划任务重启、
  //   nginx 连接被 keep-alive 占住、或网络中途断掉时，连接会一直挂着不返回。
  //   实测表现是首页板块的骨架停在「加载中」不动 —— 用户看到的是一个
  //   永远不会自己好的空白页，却没有任何提示告诉他该刷新。
  //   fetch 本身在超时后**不会**中断底层请求，但我们会走到 catch 分支，
  //   页面至少能给出一个明确状态 + 重试入口。
  var LOAD_TIMEOUT = 8000;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) {
    return Array.prototype.slice.call((r || document).querySelectorAll(s));
  };

  // ---------- 小工具 ----------

  /** 把后端文本安全地写进元素。
   *  ★ 用 textContent 而不是 innerHTML ——
   *   公告正文是运营在后台输入的，innerHTML 会让任何能写内容的人
   *   都能往首页注入脚本。textContent 是纯文本，天然安全。
   */
  function setText(el, s) {
    if (el) el.textContent = (s == null ? '' : String(s));
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  /** 相对时间：今天 / 3 天前 / 更早显示日期 */
  function relTime(ts) {
    if (!ts) return '';
    var d = new Date(ts * 1000);
    var now = new Date();
    var days = Math.floor((now - d) / 86400000);
    if (days <= 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 7) return days + ' 天前';
    var m = d.getMonth() + 1, day = d.getDate();
    return m + ' 月 ' + day + ' 日';
  }

  /** 空板块的统一占位 */
  function fillEmpty(box, text) {
    if (!box) return;
    box.innerHTML = '';
    box.appendChild(el('div', 'af-empty', text || '暂无内容'));
  }

  /** 带超时的 JSON 请求。
   *  ★ fetch 对 4xx/5xx **不会** reject，必须自己看 status ——
   *    只判 res.ok 会把 404 当成功 → 走进错误分支还以为是空数据。
   *  ★ 超时用 Promise.race + 定时器，不用 AbortController ——
   *    AbortController 是较新的 API，老浏览器上可能压根不存在，
   *    直接用会让整个脚本抛错、一个板块都渲染不出来。
   */
  function fetchJSON(url, ms) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('请求超时（' + Math.round(ms / 1000) + ' 秒无响应）'));
      }, ms);

      fetch(url, { headers: { Accept: 'application/json' } })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (j) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(j);
        })
        .catch(function (err) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  // ---------- 1. 轮播 ----------

  var heroTimer = null;

  function renderHero(site) {
    var hero = site && site.hero;
    var box = $('#afHero');
    if (!box) return;

    var slides = (hero && hero.slides) || [];
    // 后台没配轮播图时，用标题做一张纯文字主视觉 ——
    // ★ 不能什么都不显示：空 hero 会让首屏塌成一条缝。
    if (!slides.length) {
      if (hero && hero.title) {
        slides = [{
          title: hero.title,
          text: hero.subtitle || '',
          img: ''
        }];
      } else {
        // ★★ 这里**不能删掉轮播区**。
        //   HTML 里静态放了第一张（无 JS 时的兜底），接口失败时那一张还在。
        //   原写法直接 box.remove() → 连静态兜底一起删 →
        //   首屏塌成 0 高度，页面看起来像坏掉了。
        //   「接口挂了不许整页空白」这条降级原则，轮播区同样适用。
        //   没有任何数据时保留 HTML 里那一张（它在就在，不动它）。
        if (!$('.af-hero__slide', box)) fillEmpty(box, '主视觉暂时无法加载');
        return;
      }
    }

    // 只保留有标题的
    slides = slides.filter(function (s) { return s && s.title; });
    // 同上：过滤后空了也不能删轮播区，保住 HTML 里的静态兜底那张。
    if (!slides.length) return;

    var old = $$('.af-hero__slide', box);
    var oldDots = $('.af-hero__dots', box);
    $$('.af-hero__slide, .af-hero__dots', box).forEach(function (n) { n.remove(); });

    slides.forEach(function (s, i) {
      var sl = el('div', 'af-hero__slide' + (i === 0 ? ' is-on' : ''));
      sl.setAttribute('aria-hidden', i === 0 ? 'false' : 'true');

      if (s.img) {
        var img = el('img', 'af-hero__img');
        img.src = s.img;
        img.alt = '';
        img.loading = i === 0 ? 'eager' : 'lazy';
        img.decoding = 'async';
        // 图挂了就用图，没挂就露出下面的渐变底
        img.addEventListener('error', function () { img.remove(); });
        sl.appendChild(img);
      }

      var body = el('div', 'af-hero__body');
      if (s.kicker) body.appendChild(el('span', 'af-hero__kicker', s.kicker));
      body.appendChild(el('h2', 'af-hero__title', s.title));
      if (s.text) body.appendChild(el('p', 'af-hero__text', s.text));
      sl.appendChild(body);
      box.appendChild(sl);
    });

    if (slides.length > 1) {
      var dots = el('div', 'af-hero__dots');
      // ★ v2.50 去掉 role="tablist"。
      //   原来容器声明了 tablist，但子元素只有 <button> 且没给 role="tab"，
      //   也没有 aria-selected —— 这是一个**不完整的 tab 组**，
      //   屏幕阅读器会播报出一个残缺的选项卡列表（ARIA 规范要求
      //   tablist 的子元素必须是 tab/tabpanel 组）。
      //   轮播圆点更接近"一组切换按钮"，用普通 div + aria-current
      //   本来就是合法且被广泛支持的写法，不需要硬套 tab 模式。
      dots.setAttribute('role', 'group');
      dots.setAttribute('aria-label', '主视觉切换');
      slides.forEach(function (s, i) {
        var b = el('button', 'af-hero__dot');
        b.type = 'button';
        b.setAttribute('aria-label', '第 ' + (i + 1) + ' 张：' + s.title);
        b.setAttribute('aria-current', i === 0 ? 'true' : 'false');
        b.addEventListener('click', function () {
          showSlide(i, true);
          restartHero();
        });
        dots.appendChild(b);
      });
      box.appendChild(dots);
      // ★ 重建过 DOM 后 cur 必须重新落定 —— 幻灯片数量可能变了。
      //   这也是"重建 DOM 后要主动让控制器重新接管"的同一条纪律。
      cur = 0;
      startHero();
    }
  }

  function showSlide(idx, manual) {
    var box = $('#afHero');
    if (!box) return;
    var slides = $$('.af-hero__slide', box);
    if (!slides.length) return;
    var n = slides.length;
    var i = ((idx % n) + n) % n;
    // ★ cur 是「当前显示第几张」的**唯一真相**，必须在 showSlide 里落定。
    //   原来 cur 只在定时器里自增，手动切图时不动它 →
    //   下一个 tick 就从旧值继续走，点的第 3 张会被跳掉。
    cur = i;
    slides.forEach(function (s, k) {
      var on = (k === i);
      s.classList.toggle('is-on', on);
      s.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
    $$('.af-hero__dot', box).forEach(function (d, k) {
      d.setAttribute('aria-current', k === i ? 'true' : 'false');
    });
    if (manual) lastManual = Date.now();
  }

  var cur = 0, lastManual = 0;

  function startHero() {
    stopHero();
    heroTimer = setInterval(function () {
      // ★ 鼠标/手指停在轮播上时暂停自动切换 ——
      //   否则想读文字的时候画面一直在动。
      if (Date.now() - lastManual < 100) return;
      var slides = $$('.af-hero__slide', $('#afHero') || document);
      if (slides.length < 2) return;   // ★ 别忘了取模的除数，0 会得 NaN
      cur = (cur + 1) % slides.length;
      showSlide(cur);
    }, HERO_MS);
  }
  function stopHero() { if (heroTimer) { clearInterval(heroTimer); heroTimer = null; } }

  /* ★ v2.50 修一个真 bug：这里原来写的是 `cur = 0; startHero();`。
     后果：点第 3 张圆点 → showSlide(2) 正确显示第 3 张 →
     紧接着 restartHero() 把 cur 拽回 0 → 6 秒后定时器算出 (0+1)%3=1
     → **画面跳回第 2 张**。方向键同理：先 cur++ 再 restartHero()，
     自增的结果被立刻丢弃，键盘切图后下一轮永远停在第 2 张。
     现在 cur 由 showSlide 自己维护，重启定时器不需要也不该碰它。 */
  function restartHero() { startHero(); }

  // ---------- 2. 数据概览 ----------

  function renderStats(stats) {
    var box = $('#afStats');
    if (!box) return;
    if (!stats || !stats.length) { fillEmpty(box, '还没有统计数据'); return; }
    box.innerHTML = '';
    stats.forEach(function (s) {
      var c = el('div', 'af-stat');
      var v = el('div', 'af-stat__v');
      v.appendChild(el('span', null, s.value));
      if (s.unit) v.appendChild(el('span', 'af-stat__u', s.unit));
      c.appendChild(v);
      c.appendChild(el('div', 'af-stat__l', s.label));
      if (s.hint) c.appendChild(el('div', 'af-stat__h', s.hint));
      box.appendChild(c);
    });
  }

  // ---------- 3. 项目简介 ----------

  function renderIntro(site) {
    var box = $('#afIntro');
    if (!box) return;
    var intro = (site && site.intro) || {};
    if (!intro.title && !intro.body) { fillEmpty(box, '项目简介还没写'); return; }
    box.innerHTML = '';
    if (intro.title) box.appendChild(el('h3', 'af-intro__t', intro.title));
    if (intro.body) box.appendChild(el('p', 'af-intro__b', intro.body));
  }

  // ---------- 4. 舰船档案 ----------

  function renderShips(ships) {
    var box = $('#afShips');
    if (!box) return;
    if (!ships || !ships.length) { fillEmpty(box, '还没有录入舰船数据'); return; }
    box.innerHTML = '';
    ships.forEach(function (s) {
      var c = el('article', 'af-ship');
      c.appendChild(el('div', 'af-ship__n', s.name));
      var cls = s.name_en || s.class || s.nation;
      if (cls) c.appendChild(el('div', 'af-ship__c', cls));

      // 只渲染有值的参数，不留空行
      var specs = [
        ['排水量', s.displacement], ['航速', s.speed],
        ['装甲', s.armor], ['武备', s.armament], ['载机', s.aircraft]
      ].filter(function (p) { return p[1]; });
      if (specs.length) {
        var dl = el('dl', 'af-ship__spec');
        specs.forEach(function (p) {
          dl.appendChild(el('dt', null, p[0]));
          dl.appendChild(el('dd', null, p[1]));
        });
        c.appendChild(dl);
      }
      if (s.note) c.appendChild(el('div', 'af-stat__h', s.note));
      box.appendChild(c);
    });
  }

  // ---------- 5. 最新动态 ----------

  var KIND_LABEL = { announcement: '公告', update: '更新', notice: '提醒' };

  function renderFeed(feed) {
    var box = $('#afFeed');
    if (!box) return;
    if (!feed || !feed.length) { fillEmpty(box, '还没有发布任何动态'); return; }
    box.innerHTML = '';
    feed.forEach(function (f) {
      var it = el('article', 'af-item');
      it.appendChild(el('div', 'af-item__date', relTime(f.ts)));

      var b = el('div', 'af-item__b');
      var t = el('div', 'af-item__t');
      if (f.pinned) {
        var pin = el('span', 'af-tag af-tag--pin', '置顶');
        t.appendChild(pin);
      }
      if (f.version) t.appendChild(el('span', 'af-tag', f.version));
      else if (KIND_LABEL[f.kind]) t.appendChild(el('span', 'af-tag', KIND_LABEL[f.kind]));
      t.appendChild(el('span', null, f.title));
      b.appendChild(t);
      if (f.body) b.appendChild(el('div', 'af-item__d', f.body));
      it.appendChild(b);
      box.appendChild(it);
    });
  }

  // ---------- 6. 友情链接 ----------

  function renderLinks(site) {
    var box = $('#afLinks');
    if (!box) return;
    var links = (site && site.links) || [];
    if (!links.length) {
      // ★ 区分两种「没有链接」：
      //   接口正常但后台没配 → 这一节没内容，整节拿掉（首页页脚已有社区入口，
      //     再放一个空框只是噪音）。
      //   接口失败（site 为 null）→ **不能删**。删了等于让一次网络故障
      //     永久改变页面结构，且用户看不出是"没配"还是"挂了"。
      //     这条与 renderHero 同理：降级优先保结构。
      if (!site) {
        box.appendChild(el('div', 'af-empty', '暂时无法加载'));
        return;
      }
      var sec = box.closest ? box.closest('.af-sec') : null;
      if (sec) sec.remove(); else fillEmpty(box, '还没有配置链接');
      return;
    }
    box.innerHTML = '';
    links.forEach(function (l) {
      // ★ v2.58：协议白名单。af-naval.js 的 AF_LINKS_HTML() 那边早就做了
      //   `^(https?:|mailto:)` 校验，这里漏了 —— 后台要是把链接地址配成
      //   `javascript:...`，访客点这张卡片就直接执行脚本（存储型 XSS）。
      //   不合法的整条跳过，比塞个 href="#" 强（那会让访客点到空页面）。
      if (!/^(https?:|mailto:)/i.test(l.url || '')) return;
      var a = el('a', 'af-link');
      a.href = l.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      var b = el('div', 'af-link__b');
      b.appendChild(el('div', 'af-link__n', l.name || l.url));
      if (l.note) b.appendChild(el('div', 'af-link__u', l.note));
      a.appendChild(b);
      box.appendChild(a);
    });
  }

  // ---------- 7. 数据状态 ----------

  function renderNote(gh) {
    var box = $('#afNote');
    if (!box) return;
    box.innerHTML = '';
    if (!gh) return;
    if (gh.ok) {
      var t = gh.last_ok ? ('内容同步于 ' + relTime(gh.last_ok)) : '内容已同步';
      box.appendChild(el('span', null, t));
    } else {
      // ★ 失败也要说，且要说清"不是没数据，只是可能不是最新"
      box.appendChild(el('span', null,
        'GitHub 同步暂时不可用，显示的是上次成功的内容'));
    }
  }

  // ---------- 进场动画 ----------

  function setupReveal() {
    var nodes = $$('.af-sec[data-af-reveal]');
    if (!nodes.length) return;
    // ★ 先给 html 加 .js-af —— CSS 里只有 .js-af 存在时才隐藏初始态。
    //   没有这个类的话，JS 挂了元素也照样显示（不会永久透明）。
    document.documentElement.classList.add('js-af');

    if (!('IntersectionObserver' in window)) {
      nodes.forEach(function (n) { n.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.04 });
    nodes.forEach(function (n) { io.observe(n); });
  }

  // ---------- 轮播交互绑定 ----------

  function setupHero() {
    var box = $('#afHero');
    if (!box) return;
    // 点一下轮播区域暂停自动播放，方便读文字
    box.addEventListener('mouseenter', function () { stopHero(); });
    box.addEventListener('mouseleave', startHero);

    /* ★ v2.50 修一个真 bug：原来只有 touchstart 停、**没有任何恢复**。
       桌面端有 mouseleave 兜底，触屏没有 —— 手机上第一次碰到轮播区，
       自动切换就永久停住，直到刷新页面。移动端是主要流量来源，
       等于首屏主视觉在手机上"点一下就死了"。
       ★ touchcancel 必须一起处理：手指在元素上滑动时浏览器会取消 touchstart
         对应的序列，只监听 touchend 会漏掉这种情况。 */
    box.addEventListener('touchstart', function () { stopHero(); }, { passive: true });
    box.addEventListener('touchend', function () { startHero(); }, { passive: true });
    box.addEventListener('touchcancel', function () { startHero(); }, { passive: true });

    // 键盘可达：轮播区可聚焦，左右键切图
    box.setAttribute('tabindex', '0');
    // ★ 轮播区可聚焦就必须有可见焦点环。
    //   全局样式给 a/button 写了 focus-visible 样式，但这个是 div[tabindex]，
    //   默认焦点环在部分主题下被 overflow:hidden + 圆角裁掉。
    //   不加的话键盘用户 Tab 到这里完全看不到自己在哪。
    box.setAttribute('role', 'region');
    box.addEventListener('keydown', function (e) {
      // ★ v2.50：删掉原来的 `cur++; cur--`。
      //   showSlide(idx) 自己会用 idx 算出取模后的下标并落进 cur，
      //   外面再自增一次就成了"加了两遍"（点箭头会跳两张）。
      //   反过来，原来 restartHero 里的 cur=0 又会把自增吃掉 ——
      //   两个 bug 叠在一起，表现为"键盘切图后下一轮永远停在第 2 张"。
      if (e.key === 'ArrowRight') { showSlide(cur + 1, true); restartHero(); }
      else if (e.key === 'ArrowLeft') { showSlide(cur - 1, true); restartHero(); }
      else if (e.key === ' ' || e.key === 'Spacebar') {
        // 空格暂停/继续 —— 轮播区的惯例，也顺手补一个键盘可达的操作
        e.preventDefault();
        if (heroTimer) { stopHero(); } else { startHero(); }
      }
    });
  }

  // ---------- 启动 ----------

  /** 失败提示条：文案说明出了什么事，并给一个能立刻再试一次的按钮。
   *  ★ 为什么给按钮而不只写一句话：
   *    偶发断网 / 后端重启这类故障，等几十秒就会自己好。
   *    没有入口的话，用户唯一能做的就是手动刷新整页，
   *    代价是丢失已经滚动到的位置、以及重跑一遍进场动画。
   */
  function showLoadError(msg) {
    var n = $('#afNote');
    if (!n) return;
    n.innerHTML = '';
    // ★ v2.63：msg 是技术串（"HTTP 404"、"超时"），原来直接拼给访客看。
    //   访客不关心 404 是什么，只关心两件事：还能不能好、要不要等。
    //   所以把技术串换成人话，原始信息只进控制台 —— 排查时照样拿得到，
    //   页面上不再出现看不懂的代号。
    var why = /超时|timeout/i.test(msg) ? '服务器响应有点慢'
      : /HTTP\s*5/i.test(msg) ? '服务器这边有点问题'
        : /HTTP\s*4/i.test(msg) ? '这个地址暂时取不到内容'
          : '网络没连上';
    // ★ 这里只能写 window.console：home.js 是裸脚本，没有 `w` 这个别名。
    //   写错成 w.console 会在**降级路径上**抛 ReferenceError ——
    //   平时看不出来，只有在接口真挂了、最需要这条提示的时候才炸。
    if (window.console && window.console.warn) window.console.warn('[home] 内容加载失败（页面已降级）：', msg);
    n.appendChild(el('span', null, '内容暂时加载不出来（' + why + '），下面显示的是备用内容。'));
    var btn = el('button', 'af-retry', '重试');
    btn.type = 'button';
    btn.addEventListener('click', function () {
      n.innerHTML = '';
      n.appendChild(el('span', null, '正在重新加载…'));
      load();
    });
    n.appendChild(btn);
  }

  function load() {
    fetchJSON(API, LOAD_TIMEOUT)
      .then(function (d) {
        if (!d || d.ok !== true) throw new Error('返回数据格式不对');
        var site = d.site || {};
        renderHero(site);
        renderIntro(site);
        renderStats(site.stats);
        renderLinks(site);
        renderShips(d.ships);
        renderFeed(d.feed);
        renderNote(d.github);
      })
      .catch(function (err) {
        // ★ 一个板块都不能空着 —— 全部给占位说明。
        //   注意这里**不隐藏板块**：区块骨架还在，占位文案告诉用户
        //   "内容暂时取不到"，比整块消失更好排查。
        renderHero(null);
        renderIntro(null);
        renderStats(null);
        renderLinks(null);
        renderShips(null);
        renderFeed(null);
        showLoadError(err && (err.message || err));
      });
  }

  function boot() {
    setupReveal();
    setupHero();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // ★ 暴露给后台页签复用（后台"预览首页"用得上）
  window.AF_HOME = {
    render: function (d) {
      var site = (d && d.site) || {};
      renderHero(site); renderIntro(site); renderStats(site.stats);
      renderLinks(site); renderShips(d.ships); renderFeed(d.feed);
      renderNote(d.github);
    }
  };
})();
