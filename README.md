# 大西洋舰队 Mod 框架 · 网站

《大西洋舰队》Mod 框架的官网 —— 使用文档 + Mod 仓库。

> **在手机上直接改《大西洋舰队》**：调数值、加自己的舰船、装别人做的模型与贴图。
> 不用连电脑、不写代码、不需要 Root。

---

## 这个仓库是什么

**是** 已经构建好的静态网站，可以直接发布到 GitHub Pages。

**不是** 框架的源代码仓库。Mod 框架的 C# 源码、APK 构建脚本、汉化工程都**不在这里**，
它们是作者的私人工程，没有公开。

## 为什么站点要单独发一份

主站 `atlanticfleet.asia` 跑在一台自己的服务器上，上面还有 Mod 仓库的上传/审核后台
（一个 Python 服务）。这个仓库是它的**公开只读副本**，用途是：

- **服务器挂了还能访问。** 主站是单机，没有冗余。这个副本托管在 GitHub 上，
  域名过期、机器故障、停机迁移期间，文档和 Mod 列表都还能打开。
- **只放只读内容。** 后台上传、审核、删除这些写操作只在主站有，副本里不提供 ——
  留一个点下去必然失败的表单比没有更糟。

两者不是替代关系：日常访问走主站（功能全），主站不可用时来这里（能看能下）。

## 站点结构

```
.
├── index.html              首页（单屏 hero + 三个入口）
├── 404.html                404 页
├── favicon.svg / .ico      站点图标
├── _icp_number.txt         备案号
│
├── docs/                   使用文档（65 个 HTML 页面，VitePress 构建产物）
│   ├── quickstart/         快速开始
│   ├── deploy/             安装部署（安卓手机安装 / 首次启动 / 卸载还原）
│   ├── use/                日常使用（参数面板、Mod 管理）
│   ├── features/           功能说明
│   ├── dev/                作者向：源码构建、环境
│   ├── technical/          原理与实现
│   ├── faq/                常见问题
│   ├── glossary/           术语表
│   ├── architecture/ docs/ 架构
│   ├── changelog/          更新日志
│   ├── credits/            致谢
│   ├── repo/               仓库相关
│   ├── roadmap/            计划
│   ├── assets/             文档站的 JS / CSS / 字体（构建产物，文件名带哈希）
│   └── public/brand/       自有品牌素材
│
├── mods/                   Mod 仓库（浏览 + 下载）
│   ├── index.html          仓库页面
│   ├── index.json          ★ Mod 列表数据（静态版的数据源）
│   ├── packages/           Mod 包体与分享码（下载直链的目标）
│   ├── af-naval.css/js     站点共享样式与逻辑
│   ├── af-system.css       设计系统（颜色/间距/圆角/阴影/动效令牌）
│   ├── af-motion.js        动效控制器
│   ├── afx.js              交互动效
│   └── icp.js              备案与访问提示
│
├── media/                  图片与字体
│   ├── brand/              自有素材（标识、海图纹理）
│   └── fonts/              站点字体（woff2，已子集化）
│
├── vendor/                 第三方库（本地托管，不走 CDN）
│   ├── gsap.min.js         动效引擎（MIT）
│   ├── ScrollTrigger.min.js GSAP 滚动触发插件（配套 gsap）
│   ├── lenis.min.js / .css 平滑滚动（MIT）
│   └── motion.min.js       轻量动效补充（MIT）
├── admin/                  审核后台页面（静态副本，功能需主站后端，故不可用）
└── .well-known/            证书与站点验证文件
```

## 本地预览

**必须用 HTTP 服务，不能直接双击打开 `index.html`** —— 页面会 `fetch` JSON、
CSS 里的字体走 `url()`，`file://` 协议下全都会被浏览器拦掉，看起来像页面坏了。

仓库设计成**挂在子路径**上（GitHub Pages 项目站会放在 `/<仓库名>/`），
所以本地预览要把**上一级目录**当站点根：

```bash
# 在仓库的上一级目录执行
cd ..
python AtlanticFleetSite/_serve.py 8000

# 然后访问
#   http://localhost:8000/AtlanticFleetSite/
#   http://localhost:8000/AtlanticFleetSite/mods/
#   http://localhost:8000/AtlanticFleetSite/docs/
```

`_serve.py` 是个多线程静态服务，比 `python -m http.server` 稳：
后者单线程，浏览器并发加载十几个 CSS/JS/字体/图片时会拒绝连接。

想访问根路径（`http://localhost:8000/`），用空前缀重新构建一次：

```bash
MSYS_NO_PATHCONV=1 ./build_public.sh --prefix=""
```

构建脚本能识别两种状态并正确切换（剥旧前缀 / 加新前缀），
所以在「带前缀」和「不带前缀」之间来回切不会把路径改坏。

## 部署到 GitHub Pages

> 当前状态：本地 git 仓库已建好（分支 `main`，首次提交已完成，仓库 3.8 MB），
> **只差推送到 GitHub 并开 Pages**。下面从建远程仓库开始。

### 1. 在 GitHub 网页建仓库

打开 <https://github.com/new>：

- **Repository name** 填 `AtlanticFleetSite`
  （这个名字决定 URL 前缀，必须和构建时用的前缀一致 —— 现有产物就是按
  `/AtlanticFleetSite` 适配的。想换名字，见下面第 3 节）
- 选 **Public**（要公开访问）
- **不要**勾选 Add a README / .gitignore / license（本仓库已有）
- 点 **Create repository**

### 2. 推送

```bash
git remote add origin https://github.com/<你的用户名>/AtlanticFleetSite.git
git push -u origin main
```

> 私有仓库的 Pages 在免费账号上不开放，仓库必须是 **Public**。

### 3. 开 Pages

仓库 → **Settings** → **Pages** → Build and deployment →
Source 选 **Deploy from a branch** → Branch 选 `main` / `(root)` → Save。

等 1~2 分钟，访问：

```
https://<你的用户名>.github.io/AtlanticFleetSite/
```

### 4. 想换仓库名怎么办

URL 里的仓库名和构建时写死的前缀**必须一致**，否则所有资源都会 404
（页面能打开，但字体、样式、图片全丢）。

改名要**先改前缀、重新构建、再改仓库名**：

```bash
MSYS_NO_PATHCONV=1 ./build_public.sh --prefix=/<新仓库名>
git add -A && git commit -m "适配新仓库名：/<新仓库名>"
git push
```

或者反过来，先用上面的第 1 步把仓库建成 `AtlanticFleetSite`，什么都不用改。

> ⚠️ 在 Git Bash 里跑构建脚本**必须**带 `MSYS_NO_PATHCONV=1`。
> 否则命令行里的 `--prefix=/afmod-site` 会被自动转成 Windows 绝对路径，
> 于是全站资源路径变成 `href="/C:/Users/.../media/..."`，部署后 100% 404。
> 脚本内部对这种污染有检测并会拒绝，但仍建议始终带上这个变量。

### 5. 推送后必查三项

Pages 部署完先看这三个，缺一个就是前缀没对上：

| 看什么 | 正常 | 异常说明 |
|---|---|---|
| 浏览器标签页图标 | 有图标 | 空白 = 路径没带仓库名 |
| 页面正文 | 中文、字体正常 | 字体掉成默认 = CSS 里字体路径 404 |
| F12 → Network | 全部 200 | 大量 404 = 前缀对不上 |

## 这个副本和主站的关系

| | 主站 | 本仓库 |
|---|---|---|
| 地址 | `atlanticfleet.asia` | `https://<用户名>.github.io/<仓库名>/` |
| 托管 | 自有服务器 + nginx | GitHub Pages |
| Mod 浏览 / 下载 | ✅ | ✅ |
| Mod 上传 / 审核 / 删除 | ✅ | ❌ 只读 |
| 依赖后端 | ✅ Python 服务 | ❌ 纯静态 |
| 宕机时 | 打不开 | 仍可用 |

**主站仍是唯一权威源。** 本仓库的内容是从主站同步过来的产物，
不直接在上面开发。改了内容要回主站改，再重新同步（见下）。

## 内容从哪来 / 怎么更新

站点的真实源码在作者本机的两个地方：

- `C:\wwwroot\default` —— 线上站点本体（首页、Mod 仓库、后台页面）
- `...\AtlanticFleetMod\p1\docs-site` —— 文档站源码（VitePress，改 Markdown）

更新流程：

```bash
# 1. 改主站 / 文档站源码（主站改动即时生效，文档站要先重新构建）
# 2. 同步到本仓库（会清空并重新复制站点内容，跑完整套子路径适配）
MSYS_NO_PATHCONV=1 ./build_public.sh

# 3. 浏览器真跑验收（27 项判据：字体、Mod 卡片、下载直链、文档站骨架…）
#    见「验收」一节

# 4. 提交推送
git add . && git commit -m "同步主站更新" && git push
```

构建脚本做的五件事（`build_public.sh` 串起来）：

1. 从主站复制站点内容
2. 放置自有素材
3. 路径改写 —— 把站内根绝对路径（`/docs/`、`/media/`…）全部加上部署前缀，
   并校验 1000+ 条引用都能命中磁盘、JSON 都还能解析
4. Mod 仓库静态化 —— API 调用直接短路、下载改直链、隐藏上传区
5. 剔除不能公开的素材 + 注入 JS 失效兜底

## 素材与版权

站内所有美术素材均为本项目自有：

- `media/brand/af-brand.svg` —— 站点标识
- `media/brand/af-chart.svg` —— 自绘矢量海图纹理（三层网格 + 等高线 + 罗盘玫瑰）

**不含任何从游戏 APK 中提取的美术资源。** 构建时会主动剔除并复查 ——
公开可访问的仓库里分发游戏厂商的素材是有版权风险的。

字体：站名字体为自建子集，代码字体为 JetBrains Mono（SIL OFL），
文档站中文回退到系统字体栈。

## 验收

改动站点后跑一遍真跑验收：

```bash
MSYS_NO_PATHCONV=1 ./build_public.sh          # 先构建（含改写器自检）
# 起服务（务必用 _serve.py，见下）
cd .. && python AtlanticFleetSite/_serve.py 9503
# 跑验收
cd AtlanticFleetSite && node _verify_subpath.mjs
```

判据覆盖三个页面（首页 / Mod 仓库 / 文档站）的 27 项：DOM 结构、资源加载、
字体、JS 异常、入场动效降级、Mod 卡片渲染、上传区隐藏、下载链接真实可下、
部署前缀拼接、文档站骨架与站内链接。

用真实浏览器跑而不是只发 HTTP 请求 —— 这套判据里好几项在源码层面看不出对错
（字体走 CSS `url()`、Mod 卡片靠 `fetch`、下载链接运行时拼）。

**必须用 `_serve.py`，不要用 `python -m http.server`。**
后者是单线程的，浏览器并发加载 CSS/JS/字体/图片时会拒绝连接，
验收里表现为一片 `ERR_CONNECTION_REFUSED` —— 那是服务器的问题，不是站点的问题，
但会把真问题淹在里面。

判据本身也会被验证：改完判据后要**故意弄坏一次**（删掉一张图、一个字体、
改错下载前缀），确认验收真的会红。全绿但没做过反证，等于没验。

### 已经踩过的坑（判据层面）

写在这里是因为它们都不是「站点坏了」，而是「判据测的不是被测对象」：

- **图片有没有加载成功，DOM 属性表达不了。**
  `naturalWidth > 0` 对 SVG 无效；`complete === true` 在 404 时同样为 true
  （加载流程结束就是 true，不区分成败）。只有网络层状态码是真证据。
- **字体不能按「全部声明的都 loaded」判。**
  CSS 字体懒加载，文档站声明 23 个、实际只用 3 个，
  剩下 20 个永远停在 `loading` —— 按「全 loaded」判会得到 20 个假失败。
  正确判据是网络层：**凡发出去的字体请求都得是 200，且至少发出去过一个**。
- **「任意一个字体加载成功」也不算通过。**
  删掉 14 个字体里的 1 个，其余 13 个照样 loaded，判据照样报绿。
- **同一个文件里，同类路径的规则可能相反。**
  VitePress 的 SSR HTML 里的图片路径必须自带前缀（浏览器直接用），
  而 `__VP_SITE_DATA__` 里的路径必须保持裸路径（运行时 `withBase` 会再拼一次）。
  按同一套规则统一处理的结果是「这边修好、那边弄坏」。

### 构建脚本顺序为什么是这个顺序

```
反证测试 → 复制主站 → 放自有素材 → 剔除第三方素材 → 路径改写
        → 仓库静态化 → 注入降级兜底 → 收尾再跑一轮路径改写
```

- **剔除必须在路径改写之前**：剔除会新造出一批路径，改写在后才能覆盖到它们。
- **收尾必须再跑一轮改写**：静态化和降级兜底两个脚本在中间又写了新路径。
- **反证测试放最前**：改写器自己坏掉时，构建日志和页面源码都看不出问题，
  只有一组正反用例能抓住。

## 常见问题

**页面能打开，但字全是默认的、图全是裂的**
前缀对不上。所有路径都带了构建时的前缀，重新构建时 `--prefix` 要等于仓库名。

**Mod 列表空，显示「离线快照」**
这份是静态快照，数据来自 `mods/index.json`。如果列表是空的，
说明快照里本来就没有条目 —— 上传和审核只在主站做，做完重新同步。

**「审核后台」点进去能用吗**
不能。这份副本没有后端，页面上传和管理功能都不可用。去主站。

**想本地看根路径（不带 `/仓库名/`）**
按上面的方法用 `/仓库名/` 访问。根路径形态需要用空前缀重新构建：
`--prefix=`。

**改了 `_verify_subpath.mjs` 的判据，结论可信吗**
脚本里有几处判据是踩过坑之后才定成现在这样的，改之前先读注释。
特别是：不要用 `innerText.length` 判断页面是否空白（入场动效的初始
`opacity:0` 会让它返回空串，看起来像页面坏了，其实 DOM 是全的）。

## 联系方式

- QQ 群：`957336473`
- B 站：`434094293`

## 许可

网站内容与代码版权归作者所有。
《大西洋舰队》为拉斐尔工作室作品，本项目为玩家 side 的非商业 Mod 框架，
与原作无隶属关系。