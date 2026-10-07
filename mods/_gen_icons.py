# -*- coding: utf-8 -*-
"""从文档站的 af-icons.mjs 生成主站用的 af-icons.js。

为什么要生成而不是手抄：
  两处图标定义如果各写一份，改一边忘了另一边就会不一致 ——
  这正是 v2.46 踩过的坑（config.mjs / theme/index.mjs / links.js 三份副本）。
  改成「.mjs 是唯一源，主站这份由脚本生成」，抄错的可能性从"靠自觉"变成"跑一次"。

用法：python _gen_icons.py
输出：C:/wwwroot/default/mods/af-icons.js
"""
import io
import os
import re

SRC = r"C:\Users\Administrator\Desktop\AtlanticFleetMod\p1\docs-site\docs\.vitepress\theme\af-icons.mjs"
DST = r"C:\wwwroot\default\mods\af-icons.js"

HEADER = """/* =====================================================================
 * af-icons.js — 社交图标（由 _gen_icons.py 从文档站 af-icons.mjs 生成）
 * =====================================================================
 * ★ 不要手改这个文件。下次要改图标，改 af-icons.mjs 然后重跑生成脚本。
 *   依据：docs/.vitepress/theme/af-icons.mjs（唯一源）
 *
 * ★ 为什么社交图标用矢量、而不是应用位图：
 *   这些图标在页面上只显示 22~24px，而应用位图是 192×192 ——
 *   缩到八分之一等于扔掉九成像素，边缘发糊。
 *   站内品牌位（左上角 logo、favicon）仍用位图，那里 52px+，够用。
 *
 * ★ 图形来源：simple-icons（MIT 许可）提供路径数据；
 *   QQ / 哔哩哔哩 / GitHub 的标识本身属于各自商标。
 *
 * 用法：window.AF_ICONS.qq.svg 是一段<svg> 字符串。
 *   ★ 必须用 innerHTML 注入 —— 用 createElement('svg') 造不出来，
 *     浏览器不认那个标签名。内容全部来自本文件，不含任何外部输入。
 */
(function (w) {
  'use strict';

"""

FOOTER = """
  w.AF_ICONS = {
    /** 按 key 取图标；未知 key 返回罗盘（不至于空白） */
    icon: function (key) { return TABLE[key] || AF_ICON_COMPASS; },
    qq: AF_ICON_QQ,
    bilibili: AF_ICON_BILIBILI,
    github: AF_ICON_GITHUB,
    email: AF_ICON_MAIL,
    compass: AF_ICON_COMPASS,
  };
})(window);
"""

# 源文件里的两个构造器。图标定义本身只是路径数据，全靠这两个拼成 <svg>。
HELPERS = """  /* 填充型图标（平台标识本身是实心图形） */
  var svg = function (d) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
           '<path fill="currentColor" d="' + d + '"/></svg>';
  };

  /* 描边型图标（站内通用那几个，用 currentColor 描边而非填充） */
  var stroke = function (inner) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
           'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
           'stroke-linejoin="round">' + inner + '</svg>';
  };

"""


def main():
    src = io.open(SRC, encoding="utf-8").read()

    def grab(name):
        """抽出 `export const NAME = ...` 那一段（到下一个顶层声明为止）。

        ★ 两个坑：
          ① 不能用 `\\{.*?\\}` 这种正则 —— 源文件里有的定义写在一行、
             有的跨好几行，按最短匹配会在跨行的那种上截断。
          ② 停止点不能用「空行」—— 定义前面常有 `/** 说明 */` 注释块，
             会被一起抓进来（末字符变成 `*/` 而不是 `}`）。
          所以改成：从 `export const` 那行开始，一行行往下收，
          遇到「顶格的声明 / 注释 / 空行」就停。
        """
        lines = src.split("\n")
        start = None
        for i, ln in enumerate(lines):
            if ln.startswith("export const " + name + " ="):
                start = i
                break
        if start is None:
            raise SystemExit("在源文件里找不到 " + name)

        buf = [lines[start][len("export "):]]     # 只去掉 export，保留 const NAME
        for ln in lines[start + 1:]:
            if ln.strip() == "" or ln.startswith("export ") or ln.startswith("const "):
                break
            buf.append(ln)
        body = "\n".join(buf).strip()
        if not body.endswith("}"):
            raise SystemExit(name + " 的定义看起来不完整，末字符是 " + repr(body[-3:]))
        return body                              # 已是 `const NAME = {...}`

    parts = [HEADER, HELPERS]
    for name in ["AF_ICON_QQ", "AF_ICON_BILIBILI", "AF_ICON_GITHUB",
                 "AF_ICON_MAIL", "AF_ICON_COMPASS"]:
        parts.append("  " + grab(name) + "\n\n")

    parts.append("""  const TABLE = {
    qq: AF_ICON_QQ,
    bilibili: AF_ICON_BILIBILI,
    github: AF_ICON_GITHUB,
    email: AF_ICON_MAIL,
    mail: AF_ICON_MAIL,
  };
""")
    parts.append(FOOTER)

    out = "".join(parts)
    os.makedirs(os.path.dirname(DST), exist_ok=True)
    io.open(DST, "w", encoding="utf-8", newline="\n").write(out)

    # 自检：产物必须是合法 JS，且五个图标都在
    import subprocess
    r = subprocess.run(["node", "--check", DST], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit("生成的 JS 语法不合法：\n" + r.stderr)
    for k in ["qq", "bilibili", "github", "email", "compass"]:
        if k + ":" not in out:
            raise SystemExit("产物里少了 " + k)
    print("已生成 {}（{} 字节）".format(DST, len(out.encode("utf-8"))))


if __name__ == "__main__":
    main()
