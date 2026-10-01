"""真实用户场景验证：模拟「登录后刷新页面 / 收藏夹直达 / 别人发链接」。

做法：通过后端登录 → 用 setToken 等价物写入 → 反复硬刷新 + 直达，
这对应真实浏览器行为（storage 已持久化，不存在注入竞态）。
"""
import json, sys, time, urllib.request
from playwright.sync_api import sync_playwright

WEB = "http://localhost:18080"
API = "http://127.0.0.1:3000"

req = urllib.request.Request(f"{API}/api/auth/login",
    data=json.dumps({"username": "admin", "password": "admin123456"}).encode(),
    headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req) as r:
    d = json.loads(r.read())["data"]
em = int((time.time() + 7 * 24 * 3600) * 1000)
ck = json.dumps({"accessToken": d["accessToken"], "refreshToken": d["refreshToken"], "expires": em}, separators=(",", ":"))
ui = json.dumps({"refreshToken": d["refreshToken"], "expires": em, "avatar": "", "username": d["username"],
                 "nickname": d.get("nickname", ""), "roles": d["roles"], "permissions": d.get("permissions", [])},
                separators=(",", ":"), ensure_ascii=False)
INIT = """([tok,ui])=>{const m=7*24*3600;
  document.cookie='authorized-token='+encodeURIComponent(tok)+'; path=/; max-age='+m;
  document.cookie='multiple-tabs=true; path=/; max-age='+m;
  localStorage.setItem('user-info',ui);}"""

PAGES = ["/attendance/checkin", "/attendance/records", "/attendance/statistics",
         "/teaching/exams", "/finance/orders", "/finance/payments", "/finance/refunds",
         "/data/schedules", "/data/makeup-classes", "/data/semesters", "/welcome"]

ok = fail = 0
fails = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for route in PAGES:
        ctx = b.new_context()
        pg = ctx.new_page()
        # 阶段1：建立会话（写入 storage），停留一会确保落盘
        pg.goto(WEB, wait_until="domcontentloaded")
        pg.evaluate(INIT, [ck, ui])
        pg.wait_for_timeout(600)
        # 阶段2：直接 goto 目标（等价"关掉标签页再打开收藏夹"）
        pg.goto(f"{WEB}/#{route}", wait_until="networkidle", timeout=25000)
        try:
            pg.wait_for_selector(".app-page", timeout=12000)
            got = True
        except Exception:
            got = False
        h = pg.evaluate("()=>location.hash")
        n = pg.evaluate("() => (document.querySelector('#app')?.innerHTML||'').length")
        # 阶段3：再硬刷新一次，模拟 F5
        pg.reload(wait_until="networkidle", timeout=25000)
        try:
            pg.wait_for_selector(".app-page", timeout=12000); r2 = True
        except Exception: r2 = False
        h2 = pg.evaluate("()=>location.hash")
        line = f"  {'OK ' if (got and r2) else '!! '}{route:28s} goto={got} reload={r2} hash={h} -> {h2} html={n}"
        print(line)
        if got and r2: ok += 1
        else:
            fail += 1; fails.append(route)
        ctx.close()
    b.close()

print(f"\n结果：{ok} 通过 / {fail} 失败 / 共 {len(PAGES)}")
if fails: print("失败：", fails)
sys.exit(0 if fail == 0 else 1)
