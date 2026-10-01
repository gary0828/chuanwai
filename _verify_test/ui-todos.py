# L2 UI 实证：教务端待办页 + 铃铛待办 tab + 工作台待办页
#
# 用法：python _verify_test/ui-todos.py [WEB] [API] [WB]
import json
import sys
import requests
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright

WEB = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18080"
API = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:3000"
WB = sys.argv[3] if len(sys.argv) > 3 else "http://127.0.0.1:18080/ai"
TZ = timezone(timedelta(hours=8))
EV = r"C:\Users\rui08\Desktop\教学管理系统\evidence"

PASS, FAIL = [], []


def ok(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(("[OK]  " if cond else "[FAIL]") + " " + name + (f"  -- {extra}" if extra else ""))
    return cond


def inject_login(page, d):
    expires_ms = int(
        datetime.strptime(d["expires"], "%Y/%m/%d %H:%M:%S").replace(tzinfo=TZ).timestamp() * 1000
    )
    cv = json.dumps({"accessToken": d["accessToken"], "expires": expires_ms, "refreshToken": d["refreshToken"]})
    iv = json.dumps({
        "refreshToken": d["refreshToken"], "expires": expires_ms, "avatar": d.get("avatar", ""),
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


d = requests.post(f"{API}/api/auth/login", json={"username": "admin", "password": "admin123456"}, timeout=15).json()["data"]
HDR = {"Authorization": f"Bearer {d['accessToken']}", "Content-Type": "application/json"}

# ── 造 2 条测试待办 ────────────────────────────────────────────────
made = []
for payload in [
    {"title": "__L2UI_整理下周课表__", "content": "把调课申请一并处理", "priority": "重要", "due_date": "2030-01-01"},
    {"title": "__L2UI_联系家长反馈缺勤__", "content": "", "priority": "紧急"},
]:
    r = requests.post(f"{API}/api/todos", headers=HDR, json=payload, timeout=15).json()
    if r.get("data", {}).get("id"):
        made.append(r["data"]["id"])
print(f"[info] 已造 {len(made)} 条测试待办")

try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1440, "height": 950})
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))

        inject_login(pg, d)

        # ── ① 教务端待办页 ─────────────────────────────────────────
        pg.goto(f"{WEB}/#/todos", wait_until="networkidle")
        pg.wait_for_timeout(2000)
        body = pg.inner_text("body")
        ok("教务端待办页可打开（未被弹回登录）", "/todos" in pg.url, pg.url)
        ok("★ 菜单里能看到「待办」入口", "待办" in body)

        rows = pg.locator(".el-table__row").count()
        ok("待办列表渲染出数据行", rows >= 2, f"rows={rows}")
        ok("页面出现刚造的待办标题", "__L2UI_整理下周课表__" in body)
        pg.screenshot(path=rf"{EV}\L2-todos-admin.png")
        print("[info] 截图 L2-todos-admin.png")

        # ── ② 铃铛「待办」tab ─────────────────────────────────────
        pg.goto(f"{WEB}/#/welcome", wait_until="networkidle")
        pg.wait_for_timeout(2500)
        bell = pg.locator(".dropdown-badge")
        ok("铃铛存在", bell.count() > 0)
        bell.first.click()
        pg.wait_for_timeout(1600)
        # ★ 选择器必须限定在铃铛的下拉内（.dropdown-tabs）——
        #   否则页面其它组件的 el-tabs 也会被算进来（同样踩过）。
        tabs = pg.locator(".dropdown-tabs .el-tabs__item").all_inner_texts()
        ok("★ 铃铛有「通知」+「待办」两个 tab", len(tabs) == 2, f"tabs={tabs}")
        ok("tab 标签含「待办」", any("待办" in t for t in tabs), f"{tabs}")

        # 切到待办 tab
        todo_tab = pg.locator(".dropdown-tabs .el-tabs__item", has_text="待办")
        if todo_tab.count():
            todo_tab.first.click()
            pg.wait_for_timeout(1200)
        html = pg.content()
        ok("★ 待办 tab 显示真实待办（含刚造的那条）", "__L2UI_整理下周课表__" in html)

        # 用整页 HTML 判断（.el-dropdown-menu 会同时匹配铃铛/用户菜单等多个元素）
        page_html = pg.content()
        demo = [w for w in ["小铭", "李白", "开发多租户管理", "第三方紧急代码变更"] if w in page_html]
        ok("★ 铃铛无演示数据残留", not demo, f"命中={demo}")
        ok("★ 铃铛无第三方外链", "xiaoxian521.github.io" not in page_html)
        pg.screenshot(path=rf"{EV}\L2-bell-todos.png")
        print("[info] 截图 L2-bell-todos.png")

        # ── ③ 工作台待办页 ────────────────────────────────────────
        tk = requests.post(f"{API}/api/ai/sso/ticket", headers=HDR, json={}, timeout=15).json()
        ticket = tk.get("data", {}).get("ticket")
        agent = ""
        if ticket:
            v = requests.post(f"{API}/api/ai/sso/verify", json={"ticket": ticket}, timeout=15).json()
            agent = (v.get("data") or {}).get("token") or (v.get("data") or {}).get("agentToken") or ""
        if agent:
            pg2 = ctx.new_page()
            errs2 = []
            pg2.on("pageerror", lambda e: errs2.append(str(e)))
            pg2.goto(f"{WB}/?token={agent}#/todos", wait_until="networkidle")
            pg2.wait_for_timeout(3000)
            wb_body = pg2.inner_text("body")
            ok("工作台待办页可打开", "我的待办" in wb_body, pg2.url)
            ok("工作台侧边栏有「我的待办」菜单", "我的待办" in wb_body)
            ok("工作台无未捕获 JS 错误", not errs2, f"{errs2[:2]}" if errs2 else "")
            pg2.screenshot(path=rf"{EV}\L2-todos-workbench.png")
            print("[info] 截图 L2-todos-workbench.png")
        else:
            ok("取到工作台 agentToken", False, "SSO 链路未取到 token")

        ok("教务端无未捕获 JS 错误", not errs, f"{errs[:2]}" if errs else "")
        b.close()
finally:
    n = 0
    for i in made:
        if requests.delete(f"{API}/api/todos/{i}", headers=HDR, timeout=15).status_code == 200:
            n += 1
    left = requests.get(f"{API}/api/todos", headers=HDR, params={"scope": "all", "pageSize": 100}, timeout=15).json()["data"]["list"]
    resid = [x for x in left if str(x["title"]).startswith("__L2UI_")]
    print(f"[info] 已清理 {n}/{len(made)} 条；残留 {len(resid)} 条")

print("\n" + "=" * 54)
print(f"  L2 UI 实证：{len(PASS)}/{len(PASS) + len(FAIL)}")
print("=" * 54)
if FAIL:
    for f in FAIL:
        print("  失败：" + f)
sys.exit(1 if FAIL else 0)
