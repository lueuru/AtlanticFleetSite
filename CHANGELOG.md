# 变更记录

本文件记录站点内容的改动。**只有真正生效并验证过的改动才会写进来。**

---

## v2.56（2026-10-07）

二次审阅后的修复。上一轮改掉的是「看得见的症状」，这一轮挖出的是**根因级**问题。

### 高优先级

**1. 存储型 XSS：Mod 详情弹层的下载链接未转义**

`mods/index.html` 里 27 处都走了 `afNaval.esc`，唯独拼 `href` 那两行没有 ——
`m.aid` 直接进属性值。`aid` 来自 `index.json` / 后端 `/api/list`，属可被手工编辑的数据，
一个引号就能闭合属性并塞进 `onmouseover=`。同一文件第 833 行还用了
`encodeURIComponent`，说明当时知道要转义，只是漏了这里。

修法：`href` 值走 `esc`，`aid` 先 `encodeURIComponent` 再拼（两层职责不同，都要有）。
已用反证测试确认：旧实现对恶意 `aid` 输出裸引号（漏洞真实存在），修复后 9/9 通过，
且正常 `aid` 的 URL 结构（`/`、`:`）未被转义破坏。

**2. 后台列表的 3D 倾斜永久失效**

`admin/index.html` 渲染列表后只调 `afNaval.mountReveal`，漏了 `tilt`。
而 `AF.tilt` 只在 `boot()` 里对 `document` 执行一次 —— 那时 `#list` 还是空的。
列表是 `innerHTML` 整体重建的，所以**登录后台后所有卡片、以及每次点「刷新数据」重建后，
倾斜与跟随高光都不生效**。

修法：改用 `afNaval.refresh()`（内部一次做完 icons/magnet/tilt/reveal，
且已处理「两套入场动画抢同一元素」）。两处调用点都改了。

**3. 断点在 761~767px 之间存在 7px 空档**

`af-naval.css` 里 `760px`（页脚负 margin 补偿）与 `767px`（44px 触控目标）
只差 7px 却各自成规则。这 7px 宽度里页脚只拿到高度、拿不到 margin 回收 → 页脚比
760px 以下高出一截。更麻烦的是 JS 的 `AF.isSmall()` 写死 `< 760`，
而 CSS 断点是 767 —— 761~767px 区间里 JS 认为是小屏（关粒子与光标），
CSS 却按桌面渲染（玻璃层继续重采样）→ 移动端掉帧。

修法：全站统一为 767（CSS 三处 + JS 的 `isSmall` + `admin/index.html` 内联样式）。
注意 CSS 的 `@media` 里**只能写字面量**，`max-width: var(--x)` 非法会被浏览器整条丢弃。

### 中优先级

**4. 后台静态部署下报错信息误导**

媒体上传走裸 `fetch`，绕过了 `api()` 包装（FormData 不能套 `api()`，
因为它会设 `Content-Type: application/json` 从而破坏 multipart 边界）。
代价是跳过 `AF.STATIC` 判断：GitHub Pages 下请求真的发出去、拿到 404、
报错被兜成「HTTP 404」，用户以为是文件问题，真因却是「本站没有后端」。
修法：保留裸 fetch，前置 `STATIC` 判断。

**5. 同一函数里三个请求走两套错误语义**

`refresh()` 里 p2 用 `afNaval.api`（静态下 `Promise.reject`），
p1/p3 用本地 `api()`（返回 `resolve`）。同一处三请求两种 reject/resolve 语义，
将来给 `api()` 加统一拦截或重试时会漏掉。修法：统一走本地 `api()`。

### 工具

新增 `_sync_to_main.py`（仓库版 → 线上主站的同步脚本，自动剥 `/AtlanticFleetSite` 前缀）。
★ 踩坑：只剥 HTML 属性不够，**JS 字符串里的路径也会漏**
（`fetch('/AtlanticFleetSite/...')`、`AF.link` 常量）—— 漏掉的直接表现是线上 404。
实测一次同步漏了 37 处，补规则后才清零。

---

## v2.55（2026-10-07）

一次全站审阅后的定向修复。原则：**不改技术栈、不改视觉风格、不重构**，只修确认存在的问题。

### 修复

| # | 问题 | 影响 | 文件 |
|---|---|---|---|
| 1 | **后台弹层 Esc 失效、焦点不转移** | 后台全部详情弹层。`afx.js` 把 Esc 监听器挂在遮罩元素上，只有焦点落在遮罩内才触发；而后台打开弹层时没调 `modalFocus`（仓库页一直有调），焦点还停在遮罩后面的列表行按钮上，按 Esc 无反应，键盘用户完全无法关闭 | `admin/index.html` |
| 2 | **静态部署下后台误报「登录失败」** | GitHub Pages 这类纯静态托管下 `/api/*` 不存在，fetch 拿到 404 HTML，`r.json()` 失败后被兜成 `{ok:false,error:'HTTP 404'}`，页面显示「登录失败」——把排查方向完全带偏。真因是「本站没有后端」，不是密码错了 | `admin/index.html` |
| 3 | **圆角令牌双定义** | `af-naval.css` 写死 7px/12px，`af-system.css` 后面又用同名变量覆盖成 7px/14px。86 处 `var(--af-radius-lg)` 实际拿 14px，**改声明处不生效**，排障极易误判。已改为单一数据源（**生效值仍是 7px/14px，视觉零位移**） | `mods/af-naval.css` |
| 4 | **首页缺 canonical / og:image** | 首页是最主要的分享落地页，缺 og 标签时微信/微博/Twitter 分享过去只能渲染一条裸蓝链；缺 canonical 则 `/`、`/index.html` 被当成两个页面。另三页都写全了，唯独首页没有 | `index.html` |
| 5 | **首页字体未 preload** | 字体要等 CSS 解析完才开始下载，比别的页多一个往返。已补 preload（带 `crossorigin`，不加会被浏览器丢弃） | `index.html` |
| 6 | **`.af-code` 无横向溢出保护** | 后台显示 `mod.json` 全文的 `<pre>`，内容是用户上传的任意 JSON，含长路径/长 URL 的一行会撑宽页面，移动端尤其明显。同库 `.af-howto code` 早有 `word-break`，此处是漏了 | `mods/af-system.css` |
| 7 | **缓存版本号未随内容升级** | v2.53 改了 `home.js/css` 共 113 行但版本号仍是 `1.0`，老访客刷新拿不到新版且无任何提示。本次改动同步升级 `af-naval.css 5.14→5.15`、`af-system.css 1.2→1.3` | 三个 HTML |
| 8 | **站点目录残留备份文件** | 4 个 `.bak_*` 文件躺在 `mods/`、`admin/` 里。虽已被 `.gitignore` 排除（不进仓库），但会被部署脚本的目录遍历扫到 | `mods/`、`admin/` |

### 工程约定（本次确立）

**行尾符（踩过的坑）**

系统级 git 配置 `core.autocrlf=true`（便携 Git 的 gitconfig），检出时把 LF 转成 CRLF、提交时转回 LF。这导致本轮一次编辑产生了 **3000 行噪声 diff**（真实改动只有 74 行）。

- 提交前必须 `git diff --stat` 看**真实**改动量；出现上千行变更先查行尾符，别直接提交。
- 判据：`git diff --ignore-all-space --stat` 能收敛到几十行即说明是行尾问题。
- 仓库 blob 里存的是 **LF**，工作区被自动转成 CRLF。手工改文件时要留意。

**前缀剥离**

仓库版所有资源引用带 `/AtlanticFleetSite` 前缀（GitHub Pages 子路径部署需要），同步到主站 `C:\wwwroot\default` 时必须剥离。只剥 `src=`/`href=` 属性值，**不碰注释里的文字**。

### 验证

| 项 | 结果 |
|---|---|
| 本地资源引用（4 个页面） | 47 条，**缺失 0** |
| 内联 JS 语法（`node --check`） | 7 个块**全部通过** |
| CSS 括号配平 | 三个文件均平衡 |
| 线上 HTTP（`https://atlanticfleet.asia/`） | `/`、`/admin/`、`/mods/` 全 **200** |
| 线上内容确认 | 修复点均已生效（og 标签、`modalFocus`、CSS 新规则） |

### 已知未做

- **断点收敛**（当前 9 种取值，760 与 767 仅差 7px 各自成规则）——涉及全站响应式行为，改动面大，需要真机多尺寸回归，本轮未动。
- `vendor/` 四个文件（lenis / gsap / ScrollTrigger）无 `?v=` 缓存版本号，当前文件未变故无害。
- 后台内联脚本 49KB / 1170 行偏大，抽出有利于维护，但属结构调整，本轮未做。

---

## v2.54 及更早

见 `git log`：`25fa607` v2.54 同步主站、`3e7ef3b` v2.53 补同步、`29dafa5` v2.53 同步主站。
