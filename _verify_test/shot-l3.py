# L3 验收截图：教务端「待办」页展示自动生成的待办
import json
import sys
import requests
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright

WEB = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18080"
API = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:3000"
TZ = timezone(timedelta(hours=8))
EV = r"C:\Users\rui08\Desktop\教学管理系统\evidence"

d = requests.post(f"{API}/api/auth/login", json={"username": "admin", "password": "admin123456"}, timeout=15).json()["data"]


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


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 1440, "height": 950}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    inject(pg, d)

    pg.goto(f"{WEB}/#/todos", wait_until="networkidle")
    pg.wait_for_timeout(2500)
    body = pg.inner_text("body")
    rows = pg.locator(".el-table__row").count()
    print("[info] 待办页行数:", rows)
    print("[info] 含「课评未录入」:", "课评未录入" in body)
    print("[info] 含「来源」列:", "来源" in body)
    print("[info] 含「系统」标签(自动生成):", "系统" in body)
    print("[info] JS 错误:", errs or "无")
    pg.screenshot(path=rf"{EV}\L3-todos-generated.png")
    print("[info] 截图 L3-todos-generated.png")

    # 铃铛
    pg.goto(f"{WEB}/#/welcome", wait_until="networkidle")
    pg.wait_for_timeout(2500)
    pg.locator(".dropdown-badge").first.click()
    pg.wait_for_timeout(1500)
    tabs = pg.locator(".dropdown-tabs .el-tabs__item").all_inner_texts()
    print("[info] 铃铛 tabs:", tabs)
    tt = pg.locator(".dropdown-tabs .el-tabs__item", has_text="待办")
    if tt.count():
        tt.first.click()
        pg.wait_for_timeout(1200)
    print("[info] 铃铛待办含课评欠录:", "课评未录入" in pg.content())
    pg.screenshot(path=rf"{EV}\L3-bell-todos.png")
    print("[info] 截图 L3-bell-todos.png")
    b.close()
