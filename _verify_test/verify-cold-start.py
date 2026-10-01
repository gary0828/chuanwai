"""冷启动白屏验证（规范做法：接口登录 + 注入 token，且时序严格）。

关键：注入后必须【重新加载页面】让 SPA 从零启动，
否则 localStorage/cookie 的写入与 SPA 启动存在竞态。
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
  localStorage.setItem('user-info',ui);
  return document.cookie.includes('authorized-token');}"""

PAGES = [
    "/attendance/checkin", "/attendance/records", "/attendance/leaves",
    "/attendance/statistics", "/recruit/leads", "/family/notifications",
    "/teaching/exams", "/teaching/reports", "/teaching/growth",
    "/finance/orders", "/finance/payments", "/finance/refunds",
    "/finance/statistics", "/finance/business", "/finance/consumption",
    "/data/classes", "/data/students", "/data/courses",
    "/data/schedules", "/data/schedule-adjustments", "/data/makeup-classes",
    "/data/semesters", "/user", "/welcome",
]

ok = fail = 0
with sync_playwright() as p:
    b = p.chromium.launch()
    for route in PAGES:
        ctx = b.new_context()
        pg = ctx.new_page()
        # 1) 先落地到同源首页（拿到 origin 写存储）
        pg.goto(WEB, wait_until="domcontentloaded")
        injected = pg.evaluate(INIT, [ck, ui])
        # 2) ★ 关键：重新导航，让 SPA 从零冷启动（等价于刷新/收藏夹直达）
        pg.goto(f"{WEB}/#{route}", wait_until="domcontentloaded", timeout=25000)
        try:
            pg.wait_for_selector(".app-page", timeout=12000)
            has = True
        except Exception:
            has = False
        pg.wait_for_timeout(300)
        n = pg.evaluate("() => (document.querySelector('#app')?.innerHTML||'').length")
        h = pg.evaluate("()=>location.hash")
        status = "OK " if has else "!! "
        if has: ok += 1
        else: fail += 1
        print(f"  {status}{route:30s} appHTML={n:>7} hash={h} injected={injected}")
        ctx.close()
    b.close()

print(f"\n结果：{ok} 通过 / {fail} 失败 / 共 {len(PAGES)}")
sys.exit(0 if fail == 0 else 1)
