# 菜单重构 —— 前端 UI 验证（双角色）
#
# 用法：python _verify_test/ui-menu-refactor.py [WEB]
#   缺省 WEB=http://127.0.0.1:18080
#
# 覆盖：侧边栏分组标题与顺序 / 已删除的筐式分组 / teacher 无财务与系统管理 /
#       分组展开后的子项 / 点击进入页面无 pageerror / 课程页「默认授课教师」标注
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import requests
from playwright.sync_api import sync_playwright

WEB = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18080"
API = WEB
TZ = timezone(timedelta(hours=8))
EV = r"C:\Users\rui08\Desktop\教学管理系统\evidence"
TMP = r"C:\Users\rui08\Desktop\教学管理系统\_verify_test\_tmp"

PASS, FAIL = [], []


def ok(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(("[OK]  " if cond else "[FAIL]") + " " + name + (f"  -- {extra}" if extra else ""))
    return cond


def inject_login(page, d):
    ms = int(
        datetime.strptime(d["expires"], "%Y/%m/%d %H:%M:%S")
        .replace(tzinfo=TZ)
        .timestamp()
        * 1000
    )
    cv = json.dumps(
        {"accessToken": d["accessToken"], "expires": ms, "refreshToken": d["refreshToken"]}
    )
    iv = json.dumps(
        {
            "refreshToken": d["refreshToken"],
            "expires": ms,
            "avatar": d.get("avatar", ""),
            "username": d["username"],
            "nickname": d.get("nickname", ""),
            "roles": d.get("roles", []),
            "permissions": d.get("permissions", []),
        }
    )
    page.goto(f"{WEB}/#/login", wait_until="domcontentloaded")
    page.evaluate(
        """([c,i])=>{document.cookie='authorized-token='+encodeURIComponent(c)+'; path=/';
            document.cookie='multiple-tabs=true; path=/';localStorage.setItem('user-info',i);}""",
        [cv, iv],
    )
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1500)


def login_api(u, p):
    r = requests.post(f"{API}/api/auth/login", json={"username": u, "password": p}, timeout=15)
    return r.json()["data"]


# 读取侧边栏一级项（分组与独立项），返回 [{title, isGroup, children:[...]}]
# ★ 用 `.el-menu` 的直接 children：`.el-menu > li` 组合选择器在多层 .el-menu 嵌套下会漏项（实测踩过）
READ_MENU = """
() => {
  const ul = document.querySelector('.el-menu');
  if (!ul) return [];
  return [...ul.children].map(li => {
    const t = li.querySelector('.el-sub-menu__title');
    const kids = [...li.querySelectorAll('.el-menu-item')].map(k => k.innerText.trim().split('\\n')[0]);
    return t
      ? { title: t.innerText.trim().split('\\n')[0], isGroup: true, children: kids }
      : { title: li.innerText.trim().split('\\n')[0], isGroup: false, children: [] };
  });
}
"""

admin = login_api("admin", "admin123456")
teacher = login_api("teacher", "teacher123456")
print(f"[info] WEB={WEB}")

os.makedirs(EV, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1600, "height": 1000})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    # ─────────────── admin ───────────────
    print("\n=== admin 侧边栏 ===")
    inject_login(page, admin)
    menu = page.evaluate(READ_MENU)
    titles = [m["title"] for m in menu]
    print("     实测一级项: " + " | ".join(titles))
    # ★ 已知框架行为（非本改动引入）：pure-admin 会把「只有 1 个子项的分组」提升为一级项。
    #   「家校沟通」仅含「通知记录」→ 以一级「通知记录」呈现（原「家校管理」同理，行为一致）。
    group_titles = [m["title"] for m in menu if m["isGroup"]]
    order_expect = ["考勤管理", "排课与课表", "学员管理", "教学成果", "招生与报名", "财务", "系统管理"]
    ok("admin：多子项分组共 7 个", len(group_titles) == 7, " | ".join(group_titles))
    ok("admin：分组顺序正确", group_titles == order_expect, " | ".join(group_titles))
    ok("admin：单子项分组「家校沟通」被提升为一级「通知记录」", "通知记录" in titles)
    ok("admin：含独立项「待办」", "待办" in titles)
    ok("admin：已无「数据管理」筐式分组", "数据管理" not in titles)
    ok("admin：已无「教学结果」", "教学结果" not in titles)
    ok("admin：已无「财务管理」（改名「财务」）", "财务管理" not in titles)
    ok("admin：已无「招生管理」（合并为招生与报名）", "招生管理" not in titles)
    ok("admin：已无「家校管理」（改名家校沟通）", "家校管理" not in titles)

    for g in menu:
        if g["title"] == "排课与课表":
            ok("admin：排课与课表含 6 个子项", len(g["children"]) == 6, str(g["children"]))
            ok("admin：排课与课表含「周课表」", any("周课表" in c for c in g["children"]), str(g["children"]))
        if g["title"] == "考勤管理":
            ok("admin：考勤管理瘦身为 4 个子项", len(g["children"]) == 4, str(g["children"]))
            ok("admin：考勤管理不再含「周课表」", not any("周课表" in c for c in g["children"]), str(g["children"]))
        if g["title"] == "系统管理":
            ok("admin：系统管理含「员工账号」", any("员工账号" in c for c in g["children"]), str(g["children"]))

    page.screenshot(path=os.path.join(EV, "menu-refactor-admin.png"), full_page=False)
    print("     截图: evidence/menu-refactor-admin.png")

    # 点进「排课与课表 → 排课模板」验证页面可达
    err_before = len(errors)
    page.click("text=排课与课表")
    page.wait_for_timeout(700)
    page.click("text=排课模板")
    page.wait_for_timeout(2200)
    ok("admin：可进入「排课模板」页", "schedules" in page.url, page.url)
    body = page.inner_text("body")
    ok("admin：排课模板页有页头说明（讲清与周课表的区别）", "周课表" in body, "")
    ok("admin：排课模板页无 JS 报错", len(errors) == err_before, str(errors[err_before:]))

    # 课程管理页：验证「默认授课教师」标注（本次任务 3）
    err_before = len(errors)
    page.goto(f"{WEB}/#/data/courses", wait_until="networkidle")
    page.wait_for_timeout(2000)
    cbody = page.inner_text("body")
    ok("admin：课程页表格列已改为「默认授课教师」", "默认授课教师" in cbody, "")
    ok("admin：课程页页头说明了展示属性", "任课关系" in cbody, "")
    ok("admin：课程页无 JS 报错", len(errors) == err_before, str(errors[err_before:]))
    page.screenshot(path=os.path.join(EV, "menu-refactor-courses.png"), full_page=False)
    print("     截图: evidence/menu-refactor-courses.png")

    # ─────────────── teacher ───────────────
    print("\n=== teacher 侧边栏 ===")
    ctx2 = browser.new_context(viewport={"width": 1600, "height": 1000})
    page2 = ctx2.new_page()
    errs2 = []
    page2.on("pageerror", lambda e: errs2.append(str(e)))
    inject_login(page2, teacher)
    menu2 = page2.evaluate(READ_MENU)
    titles2 = [m["title"] for m in menu2]
    print("     实测一级项: " + " | ".join(titles2))
    group_titles2 = [m["title"] for m in menu2 if m["isGroup"]]
    expect2 = ["考勤管理", "排课与课表", "学员管理", "教学成果"]
    ok("teacher：多子项分组共 4 个", len(group_titles2) == 4, " | ".join(group_titles2))
    ok("teacher：分组与顺序正确", group_titles2 == expect2, " | ".join(group_titles2))
    ok("teacher：单子项分组「家校沟通」提升为一级「通知记录」", "通知记录" in titles2)
    ok("teacher：含独立项「待办」", "待办" in titles2)
    ok("teacher：无「财务」", not any("财务" in t for t in titles2))
    ok("teacher：无「系统管理」", "系统管理" not in titles2)
    ok("teacher：无「招生与报名」", "招生与报名" not in titles2)
    ok("teacher：无「员工账号」（已入系统管理）", "员工账号" not in " ".join(titles2))

    for g in menu2:
        if g["title"] == "排课与课表":
            ok("teacher：排课与课表含 3 个子项", len(g["children"]) == 3, str(g["children"]))
            ok(
                "teacher：不含 admin-only 子项（调课审批/节次时间/任课关系）",
                not any(k in " ".join(g["children"]) for k in ["调课审批", "节次时间", "任课关系"]),
                str(g["children"]),
            )

    page2.screenshot(path=os.path.join(EV, "menu-refactor-teacher.png"), full_page=False)
    print("     截图: evidence/menu-refactor-teacher.png")

    err_before = len(errs2)
    page2.click("text=排课与课表")
    page2.wait_for_timeout(700)
    page2.click("text=周课表")
    page2.wait_for_timeout(2400)
    ok("teacher：可进入「周课表」页", "sessions" in page2.url, page2.url)
    ok("teacher：周课表页无 JS 报错", len(errs2) == err_before, str(errs2[err_before:]))

    browser.close()

print("\n" + "=" * 56)
print(f"结果：PASS {len(PASS)}  FAIL {len(FAIL)}")
if FAIL:
    print("失败项：")
    for f in FAIL:
        print("  - " + f)
print("=" * 56)
sys.exit(1 if FAIL else 0)
