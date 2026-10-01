# 「通知记录」表格列重叠 / 内容被遮挡 —— 复现与量化诊断
#
# 用法：python _verify_test/repro-table-overflow.py [WEB]
#
# 用户反馈：表格右侧标红区域「前面的内容无法覆盖，导致混乱」
# 诊断思路：
#   ① 量出「表格内容总宽」与「容器可用宽」—— 判断是否必然横向滚动
#   ② 找 fixed="right" 的固定列，量它与相邻列是否重叠（固定列是悬浮层，会盖住下面的列）
#   ③ 逐个量每列实际宽度 vs 其 min-width/width，找被挤压的列
#   ④ 顺手扫其它表格页是否同病（横向同类扫描）
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import requests
from playwright.sync_api import sync_playwright

WEB = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18080"
TZ = timezone(timedelta(hours=8))
EV = r"C:\Users\rui08\Desktop\教学管理系统\evidence"

MEASURE = """
() => {
  const out = { url: location.hash };
  const bodyWrap = document.querySelector('.el-table__body-wrapper');
  const headerWrap = document.querySelector('.el-table__header-wrapper');
  if (!bodyWrap) return { ...out, error: '未找到表格' };

  const innerTable = bodyWrap.querySelector('table');
  out.containerWidth = bodyWrap.clientWidth;          // 容器可用宽
  out.contentWidth = innerTable ? innerTable.offsetWidth : 0;  // 内容总宽
  out.scrollWidth = bodyWrap.scrollWidth;
  out.horizontalScrollNeeded = bodyWrap.scrollWidth > bodyWrap.clientWidth + 1;

  // fixed 列（悬浮层）
  const fixedCells = [...document.querySelectorAll('.el-table-fixed-column--right')];
  out.fixedColCount = fixedCells.length;
  if (fixedCells.length) {
    const first = fixedCells[0].getBoundingClientRect();
    out.fixedColLeft = Math.round(first.left);
    out.fixedColWidth = Math.round(first.width);
  }

  // 表头逐列宽度
  const ths = [...document.querySelectorAll('.el-table__header-wrapper th')];
  out.columns = ths.map(th => {
    const r = th.getBoundingClientRect();
    return {
      label: (th.innerText || '').trim().split('\\n')[0],
      rendered: Math.round(r.width),
      left: Math.round(r.left),
      cls: th.className.includes('fixed') ? 'fixed' : (th.className.includes('is-hidden') ? 'hidden' : '')
    };
  });
  out.requiredMinWidth = out.columns.reduce((s, c) => s + c.rendered, 0);

  // 单元格里是否有文字被裁切（scrollWidth > clientWidth 且无省略号类）
  const cells = [...document.querySelectorAll('.el-table__body-wrapper td')].slice(0, 40);
  out.overflowCells = cells.filter(td => td.scrollWidth > td.clientWidth + 2).length;
  return out;
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

# 待排查页面：目标是「列数多 + fixed 列」的表格页（横向同类扫描）
PAGES = [
    ("通知记录", "/#/family/notifications"),
    ("学生管理", "/#/data/students"),
    ("考勤记录", "/#/attendance/records"),
    ("缴费记录", "/#/finance/payments"),
    ("报班管理", "/#/finance/orders"),
    ("线索管理", "/#/recruit/leads"),
    ("审计日志", "/#/system/audit-logs"),
    ("补课管理", "/#/data/makeups"),
]

os.makedirs(EV, exist_ok=True)
results = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    # 用一个「常见的笔记本」视口，更贴近老师实际使用
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    inject_login(page, admin)

    for name, path in PAGES:
        page.goto(f"{WEB}{path}", wait_until="networkidle")
        page.wait_for_timeout(2200)
        m = page.evaluate(MEASURE)
        m["page"] = name
        results.append(m)

        print(f"\n═══ {name}  ({path}) ═══")
        if m.get("error"):
            print("   " + m["error"])
            continue
        over = m["contentWidth"] - m["containerWidth"]
        print(f"   容器可用宽 = {m['containerWidth']}px")
        print(f"   表格内容宽 = {m['contentWidth']}px   （超出 {over}px）")
        print(f"   需要横向滚动 = {m['horizontalScrollNeeded']}")
        print(f"   fixed 列 = {m['fixedColCount']} 个（左边界 x={m.get('fixedColLeft')}，宽 {m.get('fixedColWidth')}）")
        print(f"   内容溢出的单元格数 = {m['overflowCells']}")
        cols = m["columns"]
        print("   列宽明细：")
        for c in cols:
            flag = "  ← fixed（悬浮，会遮挡下面的列）" if c["cls"] == "fixed" else ""
            print(f"     {c['label']:<8} 渲染 {c['rendered']:>4}px  x={c['left']:>4}{flag}")
        print(f"   列宽合计 = {m['requiredMinWidth']}px")

        # ★ 判定：内容宽 > 容器宽 且 有 fixed 列 → 固定列必然遮挡相邻列
        if m["contentWidth"] > m["containerWidth"] and m["fixedColCount"] > 0:
            print(f"   ⚠ P1 判定：内容宽超出容器 {over}px，且存在 fixed 列 → 固定列悬浮在其它列之上，"
                  f"被遮住的列内容会与固定列「叠字」")
        elif m["contentWidth"] > m["containerWidth"]:
            print(f"   · 需要横向滚动（{over}px），但无 fixed 列 → 只需滚动，不会叠字")
        else:
            print("   ✅ 宽度足够")

    # 通知记录页单独截图存证
    page.goto(f"{WEB}/#/family/notifications", wait_until="networkidle")
    page.wait_for_timeout(2200)
    page.screenshot(path=os.path.join(EV, "repro-notification-overflow.png"), full_page=False)
    print("\n截图: evidence/repro-notification-overflow.png")
    browser.close()

print("\n" + "=" * 70)
print("汇总：")
bad = [r for r in results if not r.get("error") and r["contentWidth"] > r["containerWidth"]]
worse = [r for r in bad if r.get("fixedColCount", 0) > 0]
for r in sorted(bad, key=lambda x: -(x["contentWidth"] - x["containerWidth"])):
    over = r["contentWidth"] - r["containerWidth"]
    tag = "★ 有 fixed 列（会叠字）" if r.get("fixedColCount", 0) > 0 else "仅需滚动"
    print(f"  {r['page']:<8} 超出 {over:>4}px   {tag}")
if not bad:
    print("  ✅ 全部页面宽度充足")
print(f"共 {len(bad)} 页超宽，其中 {len(worse)} 页可能「叠字」")
print("=" * 70)
