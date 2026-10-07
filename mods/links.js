/* =============================================================================
 * 全站外部入口 —— 唯一数据源（single source of truth）
 * ============================================================================
 *
 * ★ 为什么要有这个文件
 *   社交/社区入口曾散落在各页 HTML 里，清理第三方品牌时被逐个删掉，
 *   补回来时又要在三个页面各写一遍 —— 必然漏、必然不一致。
 *   现在**所有外链只在这里定义一次**，页面通过 window.AF_LINKS 读取。
 *
 * ★ 怎么填
 *   下面凡是标「待填」的，都是需要你替换成真实地址的地方。
 *   值为空字符串时，对应入口**自动不渲染**（不是渲染成坏链接）。
 *   填好后请确认地址末尾不要带多余空格。
 *
 * ★ 为什么用「空则隐藏」而不是「占位符可见」
 *   占位符 href="#" 会让访客点到空页，SEO 也会当成站内链接。
 *   空字符串 + 隐藏是唯一诚实的做法：没填就是没上线，不会误导人。
 *
 * ★ 改完后的验证
 *   node _verify_design.mjs（图标统一 + 链接完整性）
 */
(function (w) {
  'use strict';

  /* ---------------------------------------------------------------------
   * 需要你填写的真实地址
   * ------------------------------------------------------------------ */

  // ★ 已填（2026-10-06 从 v2.21 的 git 历史 b3421ad 恢复）。
  //   这是站长自己的群，值不是猜的 —— v2.46 清空之前一直就是它。
  var QQ_GROUP_URL = 'https://qm.qq.com/cgi-bin/qm/qr?group_code=957336473';

  // ★ 已填（同上，v2.21 起就是这个地址）。
  var BILIBILI_URL = 'https://space.bilibili.com/434094293';

  // ★ v2.50 已填：用户本人提供的仓库地址，且已实测 https://github.com/lueuru/AtlanticFleetSite
  //   返回 200（仓库公开、Pages 在线），不是编出来的。
  var GITHUB_URL = 'https://github.com/lueuru/AtlanticFleetSite';

  // ★ 待填：官方邮箱。留空则不显示。
  //   用于接 mod 投稿、合作、问题反馈。
  var EMAIL = '';

  // ★ 待填：Discord 社区邀请链接。留空则不显示。
  var DISCORD_URL = '';

  // ★ 待填：微博主页。留空则不显示。
  var WEIBO_URL = '';

  /* ---------------------------------------------------------------------
   * 以下是已确定的地址，不需要改
   * ------------------------------------------------------------------ */

  // 官网（本副本的部署地址）。子路径副本下要带/AtlanticFleetSite 前缀，
  // 改写器会自动处理，这里写**不带前缀**的裸路径。
  var SITE_ROOT = '/';

  // QQ 群号（纯数字，用于「复制群号」按钮，不依赖上面的链接）
  var QQ_GROUP_NUMBER = '957336473';

  // B 站 UID（展示用）
  var BILIBILI_UID = '434094293';

  // 作者署名
  var AUTHOR_NAME = 'uruban';

  /* ---------------------------------------------------------------------
   * 组装成页面用的结构
   * ------------------------------------------------------------------ */

  /**
   * 社交入口清单。
   * 有意按「先主后次」排序：联系方式 → 社区 → 代码托管。
   * 页面上就按这个顺序渲染，日后调整顺序只改这里一处。
   *
   * icon：一律指向 media/game/appicon.png（大西洋舰队应用图像）。
   *   所有入口共用同一张图，是「图标统一」的具体做法 ——
   *   社区入口的图标通常各用各的平台 logo，这里统一成应用自身图像。
   */
  function buildLinks() {
    var list = [];

    function add(key, label, href, extraText, title) {
      // 空地址一律不进清单 —— 页面上就不会出现这一项
      if (!href) return;
      list.push({
        key: key,
        label: label,
        href: href,
        // 显示文字：可覆盖（QQ 群要显示群号）
        text: extraText || label,
        // 无障碍标题：读屏软件念出来的内容
        title: title || (label),
        // 外链统一在新标签打开，且切断 opener
        external: true,
        // ★ v2.48：图标改成矢量（SVG 字符串），不再用应用位图。
        //   原来所有入口共用一张 192×192 的应用图像，缩到 24px 显示 ——
        //   等于扔掉九成像素，边缘发糊，而且看不出这是 QQ 还是 B 站。
        //   矢量任意尺寸都清晰，一眼能认出是哪个平台。
        //   ★ 图标定义在 af-icons.js（由文档站 af-icons.mjs 生成，唯一源）。
        //   ★ 没有图标时给个兜底（罗盘），免得整块区域出现一个空洞。
        iconSvg: (window.AF_ICONS && window.AF_ICONS.icon(key).svg) || ''
      });
    }

    add('qq', 'QQ 群', QQ_GROUP_URL, 'QQ 群 ' + QQ_GROUP_NUMBER,
      '加入 QQ 群 ' + QQ_GROUP_NUMBER);
    add('bilibili', 'B 站主页', BILIBILI_URL, 'B 站主页',
      'B 站主页 · UID ' + BILIBILI_UID);
    add('github', 'GitHub', GITHUB_URL, 'GitHub',
      'GitHub 主页（代码与发布）');
    add('email', '邮箱', EMAIL ? ('mailto:' + EMAIL) : '', '邮箱',
      '发邮件联系');
    add('discord', 'Discord', DISCORD_URL, 'Discord',
      '加入 Discord 社区');
    add('weibo', '微博', WEIBO_URL, '微博',
      '微博主页');

    return list;
  }

  var links = buildLinks();

  /* ---------------------------------------------------------------------
   * 对外暴露
   * ------------------------------------------------------------------ */
  w.AF_LINKS = {
    /** 渲染好的入口清单（页面直接遍历它） */
    list: links,

    /** 纯数字 QQ 群号，无链接时也能显示/复制 */
    qqNumber: QQ_GROUP_NUMBER,

    /** 裸的邮箱地址（页面可能想自己拼 mailto:） */
    email: EMAIL,

    /** 供页面判断"是否还有没填的占位项"，在控制台留个提示 */
    _missing: {
      qq: !QQ_GROUP_URL,
      bilibili: !BILIBILI_URL,
      github: !GITHUB_URL,
      email: !EMAIL,
      discord: !DISCORD_URL,
      weibo: !WEIBO_URL
    }
  };
})(window);