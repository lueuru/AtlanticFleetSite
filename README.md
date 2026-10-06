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
python -m http.server 8000

# 然后访问（把 AtlanticFleetSite 换成你的仓库名）
#   http://localhost:8000/AtlanticFleetSite/
#   http://localhost:8000/AtlanticFleetSite/mods/
#   http://localhost:8000/AtlanticFleetSite/docs/
```

想访问根路径（`http://localhost:8000/`），把目录复制成上一级的一个子目录即可，
或者临时把仓库改名为 `站点根的名字`……实际上不行 —— 路径前缀是构建时写死的。
**要么按上面用 `/仓库名/` 访问，要么重新构建时把前缀改成空字符串。**

## 部署到 GitHub Pages

### 1. 建仓库并推送

仓库名决定 URL 前缀，**必须和构建时用的前缀一致**。举例：仓库叫 `atlanticfleet.github.io`
不行（那是用户主页站位），叫 `afmod-site` 则 URL 是
`https://<你的用户名>.github.io/afmod-site/`。

```bash
git init
git add .
git commit -m "站点静态副本：首页 + 文档站 + Mod 仓库"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

### 2. 开 Pages

仓库 → **Settings** → **Pages** → Source 选 **Deploy from a branch** →
Branch 选 `main` / `(root)` → Save。等 1~2 分钟，地址就是
`https://<你的用户名>.github.io/<仓库名>/`。

### 3. 前缀对不上怎么办

如果 URL 里的仓库名和构建时写死的前缀不一致，所有资源都会 404
（页面能打开，但字体、样式、图片全丢）。

两种修法：

- **改前缀重新构建**（推荐）。构建脚本的参数就是干这个的：
  ```bash
  MSYS_NO_PATHCONV=1 ./build_public.sh --prefix=/<仓库名>
  ```
  改完重新提交推送即可。
- **或者**仓库名就取 `AtlanticFleetSite`，保持与现有产物一致。

> ⚠️ 在 Git Bash 里跑构建脚本**必须**带 `MSYS_NO_PATHCONV=1`。
> 否则命令行里的 `--prefix=/afmod-site` 会被自动转成 Windows 绝对路径，
> 于是全站资源路径变成 `href="/C:/Users/.../media/..."`，部署后 100% 404。
> 脚本内部对这种污染有检测并会拒绝，但仍建议始终带上这个变量。

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

# 3. 浏览器真跑验收（22 项判据：字体、Mod 卡片、下载直链、文档站骨架…）
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
MSYS_NO_PATHCONV=1 ./build_public.sh          # 先构建
# 起服务（在上一级目录）
cd .. && python -m http.server 9503 --bind 127.0.0.1 &
# 跑验收
node AtlanticFleetSite/_verify_subpath.mjs
```

判据覆盖三个页面（首页 / Mod 仓库 / 文档站）的 22 项：DOM 结构、资源加载、
字体、JS 异常、入场动效降级、Mod 卡片渲染、上传区隐藏、下载链接真实可下、
部署前缀拼接、文档站骨架与站内链接。

用真实浏览器跑而不是只发 HTTP 请求 —— 这套判据里好几项在源码层面看不出对错
（字体走 CSS `url()`、Mod 卡片靠 `fetch`、下载链接运行时拼）。

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