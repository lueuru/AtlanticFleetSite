# -*- coding: utf-8 -*-
"""增量同步主站 -> 副本站点（不删除任何文件）。

用途：批量删除被安全策略拦截（阈值 50）时，用它把主站的新增/变更文件
覆盖到副本里。**不删除**副本中主站已不存在的文件 —— 那些是旧构建的
哈希残留，会成为死链，但不影响页面显示。

用法：
    python _sync_incremental.py
"""
import filecmp
import os
import shutil
import sys

SRC = r"C:\wwwroot\default"
DST = r"C:\Users\Administrator\Desktop\AtlanticFleetSite"

# 与 build_public.sh 第 1 步的清单保持一致
ITEMS = [
    "index.html", "404.html", "favicon.svg", "favicon.ico", "favicon.png",
    "_icp_number.txt", "media", "vendor", "mods", "admin",
    "docs", ".well-known",
]
# 这两个目录每次构建都会被重建，跳过以免覆盖 _own/ 里的自建素材
SKIP_TOP = {"mods/_backup_packages_before_seed_124447"}


def walk(rel):
    """产出 (源绝对路径, 副本站绝对路径, 相对路径)"""
    s = os.path.join(SRC, rel)
    for root, _dirs, files in os.walk(s):
        for f in files:
            sp = os.path.join(root, f)
            rp = os.path.relpath(sp, SRC).replace("\\", "/")
            if any(rp.startswith(t) for t in SKIP_TOP):
                continue
            yield sp, os.path.join(DST, rp.replace("/", os.sep)), rp


def main():
    copied = 0
    same = 0
    for it in ITEMS:
        s = os.path.join(SRC, it)
        d = os.path.join(DST, it)
        if os.path.isfile(s):
            if os.path.exists(d) and filecmp.cmp(s, d, shallow=False):
                same += 1
                continue
            os.makedirs(os.path.dirname(d), exist_ok=True)
            shutil.copy2(s, d)
            print("  更新 %s" % it)
            copied += 1
        elif os.path.isdir(s):
            if not os.path.isdir(d):
                os.makedirs(d, exist_ok=True)
            for sp, dp, rp in walk(it):
                if os.path.exists(dp) and filecmp.cmp(sp, dp, shallow=False):
                    same += 1
                    continue
                os.makedirs(os.path.dirname(dp), exist_ok=True)
                shutil.copy2(sp, dp)
                copied += 1
        else:
            print("  跳过（主站没有）：%s" % it)
    print("增量同步完成：更新 %d 个，无需变更 %d 个" % (copied, same))
    if copied == 0:
        print("提示：主站与副本在这几项上已一致")


if __name__ == "__main__":
    sys.exit(main())