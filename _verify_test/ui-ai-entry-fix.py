"""AI 助手入口回归验证 —— 复现用户报告的真实故障路径。

用户报告：在 localhost:8080 登录后点「AI 助手」，落到
  localhost:8080/#/sso?ticket=...  → 404
根因：独立端口部署下跳转地址丢掉了工作台端口 8082，
      变成了教务系统自己的地址（教务系统没有 /sso 路由）。

做法：因为登录页有前端验证码（纯前端校验），脚本改用
      API 登录取 token 后注入 localStorage，跳过表单交互，
      把验证焦点放在「点入口 → 跳转地址」这一段真实链路上。
"""
import sys
import json
import urllib.request
from playwright.sync_api import sync_playwright

WEB = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:18080"
EXPECT_PORT = sys.argv[2] if len(sys.argv) > 2 else "8082"
API = "http://127.0.0.1:3000"

passed, failed = 0, 0
lines = []


def ok(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        lines.append(f"  ✅ {name}")
    else:
        failed += 1
        lines.append(f"  ❌ {name}  {detail}")


# ---- 0. API 登录取 token ----
req = urllib.request.Request(
    f"{API}/api/auth/login",
    data=json.dumps({"username": "admin", "password": "admin123456"}).encode(),
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(req) as r:
    login = json.loads(r.read())
token = login["data"]["accessToken"]
lines.append("【准备】API 登录取 token 成功")
lines.append(f"     接口基址：{API}｜前端：{WEB}｜期望工作台端口：:{EXPECT_PORT}")

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()

    # 先打开一次拿同源 localStorage 写权限
    page.goto(WEB, wait_until="domcontentloaded")

    # 直接用 document.cookie 写（Playwright add_cookies 在本环境静默失败，ctx.cookies() 返回空）
    d = login["data"]
    expires_ms = int((__import__("time").time() + 7 * 24 * 3600) * 1000)
    cookie_payload = json.dumps({
        "accessToken": token,
        "refreshToken": d["refreshToken"],
        "expires": expires_ms,
    }, separators=(",", ":"))
    user_info = json.dumps({
        "refreshToken": d["refreshToken"],
        "expires": expires_ms,
        "avatar": d.get("avatar", ""),
        "username": d["username"],
        "nickname": d.get("nickname", ""),
        "roles": d["roles"],
        "permissions": d.get("permissions", []),
    }, separators=(",", ":"), ensure_ascii=False)
    page.evaluate(
        """([tok, ui]) => {
          const maxAge = 7 * 24 * 3600;
          document.cookie = 'authorized-token=' + encodeURIComponent(tok) + '; path=/; max-age=' + maxAge;
          document.cookie = 'multiple-tabs=true; path=/; max-age=' + maxAge;
          localStorage.setItem('user-info', ui);
        }""",
        [cookie_payload, user_info],
    )
    lines.append(f"     已写入 Cookie authorized-token + multiple-tabs")
    lines.append(f"     已写入 localStorage user-info")

    # 自检：确认注入真的落盘了（beforeEach 依赖 Cookie + localStorage 同时存在）
    lines.append(f"     ctx.cookies：{[c['name'] for c in ctx.cookies()]}")
    probe = page.evaluate("""() => {
      const raw = localStorage.getItem('user-info');
      let parsed = null, err = '';
      try { parsed = JSON.parse(raw); } catch (e) { err = String(e); }
      return {
        cookie: document.cookie,
        userInfoRaw: raw ? raw.slice(0, 120) : null,
        parsedOk: !!parsed,
        parsedErr: err,
        roles: parsed && parsed.roles,
      };
    }""")
    lines.append(f"     自检 cookie：{probe['cookie'][:150]}")
    lines.append(f"     自检 user-info 可解析：{probe['parsedOk']} roles={probe['roles']} {probe['parsedErr']}")

    # ---- 1. 进入首页 ----
    page.goto(WEB + "/#/welcome", wait_until="networkidle")
    page.wait_for_timeout(2500)
    lines.append(f"     跳转后 URL：{page.url}")
    ok("注入 token 后已离开登录页", "/login" not in page.url, page.url)

    # ---- 2. 定位 AI 助手入口 ----
    lines.append("\n【①】定位 AI 助手入口")
    page.screenshot(path="evidence/ai-entry-fix-01-home.png", full_page=True)
    body = page.inner_text("body")
    has_entry = ("AI 助手" in body) or ("AI助手" in body) or ("工作台" in body)
    ok("页面上出现 AI 助手/工作台入口", has_entry,
       f"正文片段：{body[:200]!r}")

    entry = page.locator("text=AI 助手").first
    if entry.count() == 0:
        entry = page.locator("text=AI助手").first
    if entry.count() == 0:
        entry = page.locator("text=工作台").first

    if entry.count() == 0:
        ok("可点击的入口元素存在", False, "未找到可点击元素")
    else:
        ok("可点击的入口元素存在", True)
        lines.append(f"     入口文案：{entry.inner_text()[:40]!r}")

        # ---- 3. 点击并捕获跳转 ----
        lines.append("\n【②】点击入口，捕获跳转地址")
        target = ""
        try:
            with ctx.expect_page(timeout=6000) as pop:
                entry.click()
            np = pop.value
            np.wait_for_load_state("domcontentloaded")
            target = np.url
            np.close()
        except Exception:
            # 同页跳转
            page.wait_for_timeout(3000)
            target = page.url

        lines.append(f"     跳转目标：{target}")

        # ---- 4. 断言 ----
        lines.append("\n【③】断言跳转地址正确（本次 404 的根因就在这）")
        base = target.split("/#/")[0]
        hostpart = base.split("://", 1)[-1] if "://" in base else base
        ok(f"目标是工作台端口 :{EXPECT_PORT}", base.endswith(":" + EXPECT_PORT), base)
        ok("目标不含教务端口 :8080", not base.endswith(":8080"), base)
        ok("带工作台 hash 路由 #/sso", "/#/sso" in target, target)
        ok("带一次性票据 ticket", "ticket=" in target, target)
        ok("地址无多余双斜杠", "//" not in hostpart, base)

    # ---- 5. 真实打开工作台首页 ----
    lines.append(f"\n【④】真实打开 http://localhost:{EXPECT_PORT}，确认不是 404")
    page.goto(f"http://localhost:{EXPECT_PORT}", wait_until="networkidle")
    page.wait_for_timeout(2500)
    wb = page.inner_text("body")
    ok("工作台无 404 字样", "404" not in wb[:400], wb[:120].replace("\n", " "))
    ok("工作台无『页面不存在』", "页面不存在" not in wb, "")
    ok("工作台渲染出业务内容", len(wb.strip()) > 50, f"正文长度 {len(wb.strip())}")
    page.screenshot(path="evidence/ai-entry-fix-02-workbench.png", full_page=True)

    browser.close()

print("\n".join(lines))
print("\n" + "=" * 60)
print(f"AI 助手入口回归验证：{passed} 通过 / {failed} 失败")
print("=" * 60)
sys.exit(1 if failed else 0)
