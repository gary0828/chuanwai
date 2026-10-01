# 折叠验收：admin「全部」视图下，同源自动待办应折叠为 1 行（负责人合并显示）
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


def ok(n, c, e=""):
    (PASS if c else FAIL).append(n)
    print(("[OK]  " if c else "[FAIL]") + " " + n + (f"  -- {e}" if e else ""))


def inject(page, d):
    ms = int(datetime.strptime(d["expires"], "%Y/%m/%d %H:%M:%S").replace(tzinfo=TZ).timestamp() * 1000)
    cv = json.dumps({"accessToken": d["accessToken"], "expires": ms, "refreshToken": d["refreshToken"]})
    iv = json.dumps({"refreshToken": d["refreshToken"], "expires": ms, "avatar": d.get("avatar", ""),
                     "username": d["username"], "nickname": d.get("nickname", ""),
                     "roles": d.get("roles", []), "permissions": d.get("permissions", [])})
    page.goto(f"{WEB}/#/login", wait_until="domcontentloaded")
    page.evaluate("""([c,i])=>{document.cookie='authorized-token='+encodeURIComponent(c)+'; path=/';
        document.cookie='multiple-tabs=true; path=/';localStorage.setItem('user-info',i);}""", [cv, iv])
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1200)


admin = requests.post(f"{API}/api/auth/login", json={"username": "admin", "password": "admin123456"}, timeout=15).json()["data"]
AH = {"Authorization": f"Bearer {admin['accessToken']}", "Content-Type": "application/json"}

# 确保有同源 2 条（eval_missing 发给 admin + 班主任）
requests.post(f"{API}/api/todos/generate?force=1", headers=AH, timeout=30)
rows = requests.get(f"{API}/api/todos", headers=AH, params={"scope": "all", "pageSize": 300}, timeout=15).json()["data"]["list"]
auto = [r for r in rows if r.get("source") == "auto"]
print(f"[info] DB 里自动待办 {len(auto)} 条：{[ (r['source_type'], r['owner_name']) for r in auto ]}")

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 1440, "height": 950}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    inject(pg, admin)
    pg.goto(f"{WEB}/#/todos", wait_until="networkidle")
    pg.wait_for_timeout(2500)

    n = pg.locator(".el-table__row").count()
    body = pg.inner_text("body")
    ok("★ 折叠后只显示 1 行（DB 里是 2 条）", n == 1, f"页面 {n} 行 / DB {len(auto)} 条")
    ok("★ 负责人列合并显示全部负责人", "e2e教师" in body and "系统管理员" in body)
    ok("★ 有「N 人」标注", "2 人" in body)
    pg.screenshot(path=rf"{EV}\L3-todos-folded.png")
    print("[info] 截图 L3-todos-folded.png")

    # 折叠行的「完成」应作用于整组（2 条都变已完成）
    btn = pg.locator(".el-table__row button", has_text="完成")
    if btn.count():
        btn.first.click()
        pg.wait_for_timeout(2000)
        after = requests.get(f"{API}/api/todos", headers=AH, params={"scope": "all", "pageSize": 300}, timeout=15).json()["data"]["list"]
        grp = [r for r in after if r.get("source") == "auto"]
        ok("★ 折叠行「完成」作用于整组（2 条都完成）",
           len(grp) == 2 and all(r["status"] == "已完成" for r in grp),
           f"{[(r['id'], r['status']) for r in grp]}")
    else:
        ok("找到折叠行的「完成」按钮", False, "未找到")

    ok("无未捕获 JS 错误", not errs, f"{errs[:2]}" if errs else "")
    b.close()

print(f"\n折叠验收：{len(PASS)}/{len(PASS)+len(FAIL)}")
if FAIL:
    for f in FAIL:
        print("  失败：" + f)
sys.exit(1 if FAIL else 0)
