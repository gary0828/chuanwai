# ★ 权限差异实证：教师视角 vs 管理员视角（此前的 ui-todos.py 只测了 admin）
#
# 用法：python _verify_test/ui-todos-teacher.py [WEB] [API]
import json
import sys
import requests
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright

WEB = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18080"
API = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:3000"
TZ = timezone(timedelta(hours=8))
EV = r"C:\Users\rui08\Desktop\教学管理系统\evidence"

PASS, FAIL = [], []


def ok(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(("[OK]  " if cond else "[FAIL]") + " " + name + (f"  -- {extra}" if extra else ""))
    return cond


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
    page.wait_for_timeout(1200)


admin = requests.post(f"{API}/api/auth/login", json={"username": "admin", "password": "admin123456"}, timeout=15).json()["data"]
teacher = requests.post(f"{API}/api/auth/login", json={"username": "teacher", "password": "teacher123456"}, timeout=15).json()["data"]
AH = {"Authorization": f"Bearer {admin['accessToken']}", "Content-Type": "application/json"}

users = requests.get(f"{API}/api/users", headers=AH, params={"pageSize": 100}, timeout=15).json()["data"]["list"]
teacher_id = next(u["id"] for u in users if u["username"] == "teacher")
print(f"[info] teacher_id={teacher_id}")

# 造数据：① 管理员自己的 ② 指派给老师的
made = []
r1 = requests.post(f"{API}/api/todos", headers=AH, json={"title": "__PERM_管理员的私事__"}, timeout=15).json()
r2 = requests.post(f"{API}/api/todos", headers=AH, json={"title": "__PERM_指派给老师的事__", "owner_id": teacher_id}, timeout=15).json()
for r in (r1, r2):
    if r.get("data", {}).get("id"):
        made.append(r["data"]["id"])
print(f"[info] 已造 {len(made)} 条（1 条 admin 私有 + 1 条指派给老师）")

try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1440, "height": 950})

        # ══ 教师视角 ══════════════════════════════════════════════
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        inject_login(pg, teacher)

        pg.goto(f"{WEB}/#/todos", wait_until="networkidle")
        pg.wait_for_timeout(2200)
        body = pg.inner_text("body")
        ok("教师：待办页可打开（菜单已下发）", "/todos" in pg.url, pg.url)
        ok("教师：能看到「待办」入口", "待办" in body)

        rows = pg.locator(".el-table__row").count()
        ok("★ 教师：列表只显示自己的 1 条", rows == 1, f"rows={rows}")
        ok("★ 教师：看不到管理员的待办", "__PERM_管理员的私事__" not in body)
        ok("教师：能看到指派给自己的那条", "__PERM_指派给老师的事__" in body)

        # 教师不应有「负责人」筛选（admin 专属）。
        # ★ 不要用 .el-select 总数断言 —— 分页的「每页条数」也是一个 el-select，
        #   数总数会把 教师3/管理员4 误判成失败（差 1 的那个才是负责人）。
        owner_sel = pg.locator(".el-select").filter(has_text="负责人").count()
        ok("★ 教师：筛选区无「负责人」下拉", owner_sel == 0, f"负责人下拉={owner_sel}")

        # 打开新建对话框：不应出现「负责人」指派项
        pg.locator("button", has_text="新建待办").first.click()
        pg.wait_for_timeout(1200)
        dlg = pg.locator(".el-dialog")
        dlg_text = dlg.inner_text() if dlg.count() else ""
        ok("★ 教师：新建对话框无「负责人」指派项", "负责人" not in dlg_text, f"对话框文字节选={dlg_text[:60]!r}")
        ok("教师：新建对话框有标题/优先级/截止日期", all(k in dlg_text for k in ["标题", "优先级", "截止日期"]))
        pg.screenshot(path=rf"{EV}\perm-teacher-todos.png")
        print("[info] 截图 perm-teacher-todos.png")

        # 铃铛：只显示自己的待办
        pg.goto(f"{WEB}/#/welcome", wait_until="networkidle")
        pg.wait_for_timeout(2500)
        pg.locator(".dropdown-badge").first.click()
        pg.wait_for_timeout(1500)
        bell_tab = pg.locator(".dropdown-tabs .el-tabs__item", has_text="待办")
        if bell_tab.count():
            bell_tab.first.click()
            pg.wait_for_timeout(1000)
        bell_html = pg.locator(".dropdown-tabs").inner_html() if pg.locator(".dropdown-tabs").count() else ""
        ok("★ 教师铃铛：待办 tab 只含自己的", "__PERM_指派给老师的事__" in bell_html)
        ok("★ 教师铃铛：不含管理员的待办", "__PERM_管理员的私事__" not in bell_html)
        ok("教师端无未捕获 JS 错误", not errs, f"{errs[:2]}" if errs else "")
        pg.close()

        # ══ 管理员视角（对照）══════════════════════════════════════
        pg2 = ctx.new_page()
        errs2 = []
        pg2.on("pageerror", lambda e: errs2.append(str(e)))
        inject_login(pg2, admin)
        pg2.goto(f"{WEB}/#/todos", wait_until="networkidle")
        pg2.wait_for_timeout(2200)
        abody = pg2.inner_text("body")
        ok("★ 管理员：能看到全部（含老师的）", "__PERM_管理员的私事__" in abody and "__PERM_指派给老师的事__" in abody)
        owner_sel_a = pg2.locator(".el-select").filter(has_text="负责人").count()
        ok("★ 管理员：筛选区多出「负责人」下拉", owner_sel_a >= 1, f"负责人下拉={owner_sel_a}（教师为 0）")
        pg2.locator("button", has_text="新建待办").first.click()
        pg2.wait_for_timeout(1200)
        adlg = pg2.locator(".el-dialog").inner_text() if pg2.locator(".el-dialog").count() else ""
        ok("★ 管理员：新建对话框有「负责人」指派项", "负责人" in adlg)
        pg2.screenshot(path=rf"{EV}\perm-admin-todos.png")
        print("[info] 截图 perm-admin-todos.png")
        ok("管理端无未捕获 JS 错误", not errs2, f"{errs2[:2]}" if errs2 else "")
        b.close()
finally:
    n = 0
    for i in made:
        if requests.delete(f"{API}/api/todos/{i}", headers=AH, timeout=15).status_code == 200:
            n += 1
    print(f"[info] 已清理 {n}/{len(made)} 条")

print("\n" + "=" * 58)
print(f"  权限差异实证：{len(PASS)}/{len(PASS) + len(FAIL)}")
print("=" * 58)
if FAIL:
    for f in FAIL:
        print("  失败：" + f)
sys.exit(1 if FAIL else 0)
