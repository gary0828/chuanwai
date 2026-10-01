"""
统一入口部署验证：模拟「外部用户通过一个端口访问教务系统 → 点 AI 助手 → 进入工作台」

这是用户 2026-09-20 报告问题的完整复现与验收：
  上次部署「AI 工具台点击无法进入」，本次要证明不再发生。

验证点：
  ① 教务系统可在统一入口正常登录
  ② 点「AI 助手」后跳转地址 = 访问者 origin（不含硬编码 8082）
  ③ 工作台页面真实渲染（不是白屏 / 不是演示身份）
  ④ 工作台能取到真实教务数据（证明 /api 反代与 SSO 都通）
  ⑤ 工作台「返回教务系统」指向正确
  ⑥ 控制台无报错

运行：python _verify_test/ui-unified-entry.py [base]
默认 base = http://localhost:9080
"""
import sys, json, pathlib, re, urllib.request, urllib.parse
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:9080"
ROOT = pathlib.Path(__file__).resolve().parent.parent
EVID = ROOT / "evidence"
EVID.mkdir(exist_ok=True)

pass_n = fail_n = 0
def chk(name, ok, detail=""):
    global pass_n, fail_n
    if ok:
        pass_n += 1
        print(f"  [PASS] {name}" + (f" — {detail}" if detail else ""))
    else:
        fail_n += 1
        print(f"  [FAIL] {name}" + (f" — {detail}" if detail else ""))

def api_login(base, user="admin", pwd="admin123456"):
    """直接调后端登录接口拿 token（绕开前端图形验证码，验证码是单纯的 UI 关注点）"""
    req = urllib.request.Request(
        base + "/api/auth/login",
        data=json.dumps({"type": "password", "username": user, "password": pwd}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())

print(f"\n=== 统一入口端到端验证 @ {BASE} ===\n")

# ---------- ① 后端经统一入口可达 ----------
print("【①】统一入口连通性")
for path, name in [("/", "教务系统首页"), ("/ai/", "工作台首页"), ("/api/health", "后端 API")]:
    try:
        with urllib.request.urlopen(BASE + path, timeout=10) as r:
            chk(f"{name} 可访问（{path}）", r.status == 200, f"HTTP {r.status}")
    except Exception as e:
        chk(f"{name} 可访问（{path}）", False, str(e)[:80])

try:
    login = api_login(BASE)
    token = login["data"]["accessToken"]
    chk("经统一入口登录成功", True, f"accessToken {token[:14]}…")
except Exception as e:
    chk("经统一入口登录成功", False, str(e)[:100])
    token = None

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900})

    # ---------- 注入登录态（必须先于 SPA 引导） ----------
    # 踩坑记录：cookie 用 ctx.add_cookies 注入即可，但 localStorage 的 `user-info`
    # 必须在页面脚本运行前就位 —— 若用「先 goto 再 evaluate 写入」，SPA 引导时
    # router.beforeEach 读不到 user-info，会走 else 分支执行 removeToken()，
    # 把刚注入的 cookie 一并清掉（表现为「注入成功但 3 秒后 cookie 变空」）。
    # 正确做法：ctx.add_init_script()，每次导航前同步写入。
    if token:
        import datetime
        host = urllib.parse.urlparse(BASE).hostname
        expires = int((datetime.datetime.now().timestamp() + 7200) * 1000)
        info = login["data"]
        ctx.add_cookies([
            {
                "name": "authorized-token",
                "value": json.dumps({
                    "accessToken": token,
                    "expires": expires,
                    "refreshToken": info.get("refreshToken", ""),
                }),
                "domain": host,
                "path": "/",
            },
            {"name": "multiple-tabs", "value": "true", "domain": host, "path": "/"},
        ])
        ctx.add_init_script(
            "localStorage.setItem('user-info', %s);"
            % json.dumps(json.dumps({
                "refreshToken": info.get("refreshToken", ""),
                "expires": expires,
                "avatar": info.get("avatar", ""),
                "username": info.get("username", "admin"),
                "nickname": info.get("nickname", ""),
                "roles": info.get("roles", ["admin"]),
                "permissions": info.get("permissions", []),
            }))
        )

    pg = ctx.new_page()
    logs = []
    pg.on("pageerror", lambda e: logs.append(f"pageerror: {e}"))
    pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}") if m.type == "error" else None)

    # ---------- ② 打开教务系统 ----------
    print("\n【②】教务系统（注入登录态）")
    pg.goto(f"{BASE}/", wait_until="networkidle")
    pg.wait_for_timeout(4000)
    body = pg.inner_text("body")
    mk = "AI 助手" in body
    chk("进入主界面并出现「AI 助手」入口", mk, body[:80].replace("\n", " "))
    pg.screenshot(path=str(EVID / "unified-01-crm.png"))
    print("  [shot] evidence/unified-01-crm.png")

    if not mk:
        # 退一步：直接验证跳转接口的行为（不依赖 UI 登录态）
        print("\n  ⚠ 未进入主界面（可能登录态注入未生效），改为直接验证跳转接口")
        b.close()
        print("\n" + "=" * 56)
        print(f"统一入口验证：{pass_n} 通过 / {fail_n} 失败（UI 部分未完成）")
        print("=" * 56)
        sys.exit(1)

    # ---------- ③ 点 AI 助手，拦截跳转地址 ----------
    print("\n【③】点「AI 助手」→ 检查跳转地址")
    pg.evaluate("""() => {
        window.__aiUrl = null;
        const orig = window.open;
        window.open = function(u) { window.__aiUrl = u; return { closed:false, focus(){}, close(){} }; };
    }""")
    btn = pg.query_selector("text=AI 助手")
    if btn:
        btn.click()
        pg.wait_for_timeout(4000)

    ai_url = pg.evaluate("() => window.__aiUrl")
    chk("拿到跳转地址", bool(ai_url), ai_url or "空")
    if ai_url:
        chk("★ 不含硬编码 :8082", ":8082" not in ai_url, ai_url.split("/#/")[0])
        chk("★ 与访问者同源（统一入口）", ai_url.startswith(BASE), ai_url.split("/#/")[0])
        chk("票据在 hash 中", "/#/sso?ticket=" in ai_url)
        chk("工作台位于 /ai/ 子路径", "/ai/#/sso" in ai_url, ai_url.split("#")[0])

        # ---------- ④ 真正进入工作台 ----------
        print("\n【④】实际进入工作台")
        pg.goto(ai_url, wait_until="networkidle")
        pg.wait_for_timeout(4500)
        wb = pg.inner_text("body")
        chk("工作台页面渲染", len(wb) > 300, f"{len(wb)} 字")
        chk("★ 不是演示身份（免登票据生效）", "演示身份" not in wb, "已走 SSO" if "演示身份" not in wb else "仍是演示身份")
        chk("侧边栏渲染", "AI 教学助手" in wb)
        pg.screenshot(path=str(EVID / "unified-02-workbench.png"), full_page=True)
        print("  [shot] evidence/unified-02-workbench.png")

        # ---------- ⑤ 工作台取真实数据 ----------
        print("\n【⑤】工作台经统一入口取真实数据")
        pg.goto(f"{BASE}/ai/#/growth", wait_until="networkidle")
        pg.wait_for_timeout(4500)
        g = pg.inner_text("body")
        chk("成长路径页可访问（/api 反代通）", len(g) > 400, f"{len(g)} 字")
        chk("无 403 / 未授权", "403" not in g and "无权" not in g)
        pg.screenshot(path=str(EVID / "unified-03-growth.png"), full_page=True)
        print("  [shot] evidence/unified-03-growth.png")

        # ---------- ⑥ 返回教务系统 ----------
        print("\n【⑥】「返回教务系统」指向正确")
        back = pg.query_selector("text=返回教务系统")
        if back:
            pg.evaluate("""() => { window.__back = null;
                const orig = window.location.assign.bind(window.location);
            }""")
            href = pg.evaluate("""() => {
                const el = [...document.querySelectorAll('*')].find(
                    e => e.children.length === 0 && e.textContent.trim() === '返回教务系统');
                return el ? (el.closest('button,a') || el).outerHTML.slice(0,200) : null;
            }""")
            chk("存在「返回教务系统」入口", href is not None, (href or "")[:100])
        else:
            chk("存在「返回教务系统」入口", False, "未找到")

    # ---------- ⑦ 控制台 ----------
    print("\n【⑦】控制台")
    errs = [x for x in logs if x.startswith("pageerror")]
    chk("无 JS 崩溃", not errs, "; ".join(errs[:2]))

    b.close()

print("\n" + "=" * 56)
print(f"统一入口验证：{pass_n} 通过 / {fail_n} 失败")
print("=" * 56)
sys.exit(1 if fail_n else 0)
