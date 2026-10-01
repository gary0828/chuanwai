"""权威巡检：用【后端真实下发】的路由清单，逐个冷启动直达 + 刷新。
这是最贴近真实用户的验证 —— 路由清单不再手写，全部从 /api/auth/async-routes 取。
"""
import json, os, sys, time, urllib.request
from playwright.sync_api import sync_playwright

WEB = os.environ.get("WEB", "http://localhost:18080")
API = os.environ.get("API", "http://localhost:18080")

req = urllib.request.Request(f"{API}/api/auth/login",
    data=json.dumps({"username": "admin", "password": "admin123456"}).encode(),
    headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req) as r:
    d = json.loads(r.read())["data"]
tok = d["accessToken"]
req = urllib.request.Request(f"{API}/api/auth/async-routes", headers={"Authorization": "Bearer " + tok})
routes = json.loads(urllib.request.urlopen(req).read())["data"]

# 从真实路由清单提取所有叶子路径
paths = []
def walk(rs):
    for x in rs:
        if x.get("children"):
            walk(x["children"])
        else:
            paths.append(x["path"])
walk(routes)
paths.append("/welcome")

em = int((time.time() + 7 * 24 * 3600) * 1000)
ck = json.dumps({"accessToken": d["accessToken"], "refreshToken": d["refreshToken"], "expires": em}, separators=(",", ":"))
ui = json.dumps({"refreshToken": d["refreshToken"], "expires": em, "avatar": "", "username": d["username"],
                 "nickname": d.get("nickname", ""), "roles": d["roles"], "permissions": d.get("permissions", [])},
                separators=(",", ":"), ensure_ascii=False)
INIT = """([tok,ui])=>{const m=7*24*3600;
  document.cookie='authorized-token='+encodeURIComponent(tok)+'; path=/; max-age='+m;
  document.cookie='multiple-tabs=true; path=/; max-age='+m;
  localStorage.setItem('user-info',ui);}"""

print(f"共 {len(paths)} 个页面待验证\n")
ok = fail = 0
fails = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for route in paths:
        ctx = b.new_context()
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
        pg.goto(WEB, wait_until="domcontentloaded")
        pg.evaluate(INIT, [ck, ui])
        pg.wait_for_timeout(500)
        pg.goto(f"{WEB}/#{route}", wait_until="networkidle", timeout=25000)
        try:
            pg.wait_for_selector(".app-page", timeout=12000); g = True
        except Exception: g = False
        pg.reload(wait_until="networkidle", timeout=25000)
        try:
            pg.wait_for_selector(".app-page", timeout=12000); rl = True
        except Exception: rl = False
        h = pg.evaluate("()=>location.hash")
        # 页面级报错（排除 ResizeObserver 等噪声）
        real_err = [e for e in errs if "ResizeObserver" not in e]
        good = g and rl and not real_err and h == "#" + route
        if good: ok += 1
        else: fail += 1; fails.append(route)
        mark = "OK " if good else "!! "
        extra = ""
        if not g: extra += " 冷启动失败"
        if not rl: extra += " 刷新失败"
        if real_err: extra += f" 报错:{real_err[0][:60]}"
        if h != "#" + route: extra += f" 落点={h}"
        print(f"  {mark}{route:30s}{extra}")
        ctx.close()
    b.close()

print(f"\n结果：{ok} 通过 / {fail} 失败 / 共 {len(paths)}")
if fails: print("失败：", fails)
sys.exit(0 if fail == 0 else 1)
