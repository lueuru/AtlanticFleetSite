# -*- coding: utf-8 -*-
"""
v2.56 同步：仓库版（带 /AtlanticFleetSite 前缀）→ 线上主站（根路径，剥前缀）

铁律（来自项目记忆）：
- 方向只能是 仓库/副本 → 主站，绝不能反。
- 只剥 src=/href= 等**属性值**里的前缀，**不碰注释文字**。
  剥注释会把我写的说明改坏，几年后没人知道这里曾经有前缀。
- CSS 的 url() 与 @import 里同样要剥。
"""
import io, os, re, sys

SRC = r"C:\Users\Administrator\Desktop\AtlanticFleetSite"
DST = r"C:\wwwroot\default"
PREFIX = "/AtlanticFleetSite"

# 本轮实际改动的文件（其余不动，避免连带风险）
FILES = ["mods/index.html", "admin/index.html", "mods/af-naval.css", "mods/af-naval.js"]

# 只在这些标签的属性值里剥前缀
ATTR = re.compile(r'''\b(src|href|poster|action|data-src)\s*=\s*(["'])/AtlanticFleetSite''')
CSS_URL = re.compile(r'''url\(\s*(["']?)/AtlanticFleetSite''')
# ★ v2.55 补：JS 里 fetch('/AtlanticFleetSite/...') 也要剥。
#   只剥 HTML 属性会漏掉这些 —— 实测 af-naval.js 有 6 处、mods/index.html 有 2 处，
#   漏掉的直接表现是线上 fetch 404。AF.link 那组常量同理。
JS_STR = re.compile(r'''(['"])/AtlanticFleetSite(?=[/'"\\])''')


def strip_prefix(text, kind):
    n = 0
    if kind in ("html",):
        text, k = ATTR.subn(lambda m: '%s=%s' % (m.group(1), m.group(2)), text)
        n += k
    # CSS 的 url()
    text, k = CSS_URL.subn(lambda m: 'url(%s' % m.group(1), text)
    n += k
    # @import "/AtlanticFleetSite/..."
    text, k = re.subn(r'''(@import\s+)(["'])/AtlanticFleetSite''',
                      lambda m: '%s%s' % (m.group(1), m.group(2)), text)
    n += k
    # JS/内联脚本里的字符串路径（fetch、AF.link 等）
    if kind in ("js", "html"):
        text, k = JS_STR.subn(lambda m: m.group(1), text)
        n += k
    return text, n


def main():
    total = 0
    for rel in FILES:
        s = os.path.join(SRC, rel.replace("/", os.sep))
        d = os.path.join(DST, rel.replace("/", os.sep))
        if not os.path.exists(s):
            print("  [跳过] 源不存在: %s" % rel); continue
        if not os.path.exists(d):
            print("  [跳过] 主站无对应文件: %s" % rel); continue

        with io.open(s, encoding="utf-8", newline="") as f:
            src_txt = f.read()
        with io.open(d, encoding="utf-8", newline="") as f:
            dst_old = f.read()

        kind = "css" if rel.endswith(".css") else ("js" if rel.endswith(".js") else "html")
        out, n = strip_prefix(src_txt, kind)
        total += n

        if out == dst_old:
            print("  [无变化] %s" % rel); continue

        with io.open(d, "w", encoding="utf-8", newline="") as f:
            f.write(out)
        # 复核：主站里不该再出现属性值里的前缀
        with io.open(d, encoding="utf-8", newline="") as f:
            chk = f.read()
        left = len(re.findall(r'''\b(src|href)\s*=\s*["']/AtlanticFleetSite''', chk))
        print("  [已同步] %-22s 剥前缀 %d 处，主站残留 %d 处%s"
              % (rel, n, left, "  ★需复查" if left else ""))
    print("\n  合计剥除前缀 %d 处" % total)


if __name__ == "__main__":
    main()