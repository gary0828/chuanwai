# 全站表格「固定列遮挡 / 列宽溢出」横向扫描
#
# 用法：python _verify_test/scan-table-layout.py [WEB]
#
# 背景：用户反馈「通知记录」表格右侧混乱（固定列与相邻列叠字）。
# 根因是全局样式把单元格底色设为透明 → fixed 列这层悬浮贴纸盖不住下面的内容。
# 本脚本横扫所有「多列 + fixed 列」的表格页，验证修复是否全局生效，
# 并量化每页的列宽溢出（供后续逐页收敛）。
import json
import sys
from datetime import datetime, timedelta, timezone

import requests
from playwright.sync_api import sync_playwright

WEB = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18080"
TZ = timezone(timedelta(hours=8))

PAGES = [
    ("通知记录", "/#/family/notifications"),
    ("学生管理", "/#/data/students"),
    ("考勤记录", "/#/attendance/records"),
    ("缴费记录", "/#/finance/payments"),
    ("报班管理", "/#/finance/orders"),
    ("线索管理", "/#/recruit/leads"),
    ("审计日志", "/#/system/audit-logs"),
    ("补课管理", "/#/data/makeups"),
    ("成绩管理", "/#/teaching/exams"),
    ("员工账号", "/#/user"),
    ("班级管理", "/#/data/classes"),
    ("通知公告", "/#/system/notices"),
]

PROBE = """
() => {
  const bw = document.querySelector('.el-table__body-wrapper');
  if (!bw) return { error: '无表格' };
  const sc = bw.querySelector('.el-scrollbar__wrap');
  const fixedTd = bw.querySelector('.el-table-fixed-column--right') || bw.querySelector('.el-table-fixed-column--left');
  const fixedTh = document.querySelector('.el-table__header-wrapper .el-table-fixed-column--right')
               || document.querySelector('.el-table__header-wrapper .el-table-fixed-column--left');
  const cs = el => el ? getComputedStyle(el) : null;
  const ths = [...document.querySelectorAll('.el-table__header-wrapper th')];
  const colSum = ths.reduce((s, t) => s + Math.round(t.getBoundingClientRect().width), 0);
  let overlap = 0;
  if (fixedTh) {
    const fr = fixedTh.getBoundingClientRect();
    ths.filter(t => !t.className.includes('fixed')).forEach(t => {
      const q = t.getBoundingClientRect();
      const o = Math.min(q.right, fr.right) - Math.max(q.left, fr.left);
      if (o > 0) overlap = Math.max(overlap, Math.round(o));
    });
  }
  return {
    containerW: bw.clientWidth,
    colSum,
    over: colSum - bw.clientWidth,
    fixedCount: document.querySelectorAll('.el-table__body-wrapper .el-table-fixed-column--right, .el-table__body-wrapper .el-table-fixed-column--left').length,
    fixedBg: cs(fixedTd) ? cs(fixedTd).backgroundColor : null,
    overlap,
    scrollable: sc ? (sc.scrollWidth > sc.clientWidth + 1) : null
  };
}
"""


def inject_login(page, d):
    ms = int(datetime.strptime(d["expires"], "%Y/%m/%d %H:%M:%S").replace(tzinfo=TZ).timestamp() * 1000)
    cv = json.dumps({"accessToken": d["accessToken"], "expires": ms, "refreshToken": d["refreshToken"]})
    iv = json.dumps({
        "refreshToken": d["refreshToken"], "expires": ms, "avatar": d.get("avatar", ""),
        "username": d["username"], "nickname": d.get("nickname", ""),
        "roles": d.get("roles", []), "permissions": d.get("permissions", []),
    })
    page.goto(f"{WEB}/#/login", wait_until="domcontentloaded")
    page.evaluate(
        """([c,i])=>{document.cookie='authorized-token='+encodeURIComponent(c)+'; path=/';
            document.cookie='multiple-tabs=true; path=/';localStorage.setItem('user-info',i);}""",
        [cv, iv],
    )
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1500)


admin = requests.post(f"{WEB}/api/auth/login",
                      json={"username": "admin", "password": "admin123456"}, timeout=15).json()["data"]

rows = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    inject_login(page, admin)
    for name, path in PAGES:
        page.goto(WEB + path, wait_until="networkidle")
        page.wait_for_timeout(2100)
        r = page.evaluate(PROBE)
        r["page"] = name
        rows.append(r)
    browser.close()

print("布局扫描（视口 1440px，容器约 1090px）")
print("-" * 84)
print("{:<10}{:>6}{:>8}{:>7}{:>24}{:>8}{:>9}".format("页面", "容器", "列合计", "超出", "固定列背景", "重叠", "可滚动"))
print("-" * 84)
transparent = []
overlapping = []
for r in rows:
    if r.get("error"):
        print("{:<10}  {}".format(r["page"], r["error"]))
        continue
    bg = r["fixedBg"] or "—"
    flag = ""
    if r["fixedCount"] and bg.startswith("rgba(0, 0, 0, 0)"):
        flag = " ❌透明"
        transparent.append(r["page"])
    if r["fixedCount"] and r["overlap"] > 0:
        flag += " ⚠遮挡"
        overlapping.append((r["page"], r["overlap"], r["scrollable"]))
    print("{:<10}{:>6}{:>8}{:>7}{:>24}{:>8}{:>9}{}".format(
        r["page"], r["containerW"], r["colSum"], r["over"], bg, r["overlap"], str(r["scrollable"]), flag))

print()
print("【结论】")
print("  固定列背景仍透明的表 = {} 个 {}".format(
    len(transparent), "✅ 叠字已全局根治" if not transparent else "❌ " + ", ".join(transparent)))
if overlapping:
    print("  固定列遮挡相邻列的表 = {} 个（列宽溢出，但有背景+可滚动则不混乱）：".format(len(overlapping)))
    for name, ov, sc in overlapping:
        print("     {} 遮挡 {}px，可横向滚动 = {}".format(name, ov, sc))
else:
    print("  无表格出现固定列遮挡 ✅")
