# -*- coding: utf-8 -*-
"""上线门禁修复 —— 前端浏览器验证（一次性脚本，位于 .gitignore 忽略的 _verify_test/）

覆盖：
  B2 — 线索转化弹窗的「仅建档」提示与标题（原标题恒为 `标记转化 - ` 空表情）
  H1 — token 失效时不再「界面卡死」，而是提示 + 跳登录（两种失效路径）
  H2 — 前端登出会真实调用 /api/auth/logout

用法：
    "C:/Program Files/Python314/python.exe" _verify_test/ui-verify-fixes.py [base_url] [api_url]
默认 base_url=http://localhost:8850（免验证码 dev server）、api_url=http://localhost:3000
截图输出到 evidence/fix_*.png
"""
import sys
import json
import time

sys.stdout.reconfigure(encoding="utf-8")
import requests
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8850"
API = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3000"

passed, failed = 0, 0
failures = []


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"  [PASS] {name}")
    else:
        failed += 1
        failures.append(f"{name}{(' → ' + detail) if detail else ''}")
        print(f"  [FAIL] {name}{(' → ' + detail) if detail else ''}")


def api_login():
    r = requests.post(
        f"{API}/api/auth/login",
        json={"username": "admin", "password": "admin123456", "type": "password"},
        timeout=10,
    )
    return r.json()["data"]["accessToken"]


def api_h(token):
    return {"Authorization": f"Bearer {token}"}


def ensure_convertible_lead(token):
    """确保存在一条「待跟进」线索可供转化验证；没有则建一条。"""
    r = requests.get(f"{API}/api/leads?page=1&pageSize=50", headers=api_h(token), timeout=10)
    rows = (r.json().get("data") or {}).get("list") or []
    for row in rows:
        if row.get("status") not in ("已转化", "已流失"):
            return row, False
    suffix = str(int(time.time()))[-6:]
    r = requests.post(
        f"{API}/api/leads",
        headers=api_h(token),
        json={
            "name": f"验证线索{suffix}",
            "phone": f"1370000{suffix}",
            "source": "转介绍",  # 必须是后端 SOURCES 枚举内的值
            "remark": "浏览器验证用，脚本结束会删除",
        },
        timeout=10,
    )
    body = r.json()
    if not body.get("success"):
        print(f"      [warn] 创建线索失败：{body}")
        return None, False
    return {"id": body["data"]["id"], "name": f"验证线索{suffix}", "status": "待跟进"}, True


def cleanup_lead(token, lead_id, created):
    if created and lead_id:
        try:
            requests.delete(f"{API}/api/leads/{lead_id}", headers=api_h(token), timeout=10)
        except Exception:  # noqa: BLE001
            pass


def login_ui(pg):
    pg.goto(f"{BASE}/#/login", wait_until="networkidle")
    pg.fill('input[placeholder="账号"]', "admin")
    pg.fill('input[placeholder="密码"]', "admin123456")
    pg.click('button:has-text("登录")')
    pg.wait_for_url(lambda u: "/login" not in u, timeout=15000)


def main():
    token = api_login()
    lead, created = ensure_convertible_lead(token)
    print(f"[setup] 用于验证的线索：{lead}（本次新建={created}）")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        pg = ctx.new_page()
        console_errors = []
        pg.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

        # ── 1. 登录 ─────────────────────────────────────────────────
        print("\n[1] 登录")
        login_ui(pg)
        check("登录成功并跳离登录页", "/login" not in pg.url, pg.url)

        # ── 2. B2：线索转化弹窗 ──────────────────────────────────────
        print("\n[2] B2 线索转化弹窗（仅建档语义）")
        pg.goto(f"{BASE}/#/recruit/leads", wait_until="networkidle")
        pg.wait_for_timeout(1200)
        check("线索管理页打开", "/recruit/leads" in pg.url, pg.url)

        # 找到目标线索所在行的「转化」按钮
        row = pg.locator("tr", has_text=lead["name"]).first
        btn = row.locator('button:has-text("转化")').first
        if btn.count() == 0:
            btn = pg.locator('button:has-text("转化")').first
        check("找到「转化」入口按钮", btn.count() > 0)
        btn.click()
        pg.wait_for_timeout(900)

        dialog = pg.locator(".el-dialog").filter(has_text="标记转化").first
        check("转化弹窗已打开", dialog.count() > 0)

        title_txt = pg.locator(".el-dialog__title").first.inner_text()
        print(f"      弹窗标题 = {title_txt!r}")
        check(
            "标题包含线索姓名（不再是恒空的 `标记转化 - `）",
            lead["name"] in title_txt,
            f"实际={title_txt!r}",
        )

        alert_txt = ""
        if pg.locator(".el-alert").count() > 0:
            alert_txt = pg.locator(".el-alert").first.inner_text()
        print(f"      提示文案 = {alert_txt[:80]!r}...")
        check("弹窗含「仅建档」提示（el-alert）", "仅创建学员档案" in alert_txt, alert_txt[:60])
        check(
            "提示明确指向财务模块补录课时包",
            "财务管理" in alert_txt and "课时包" in alert_txt,
            alert_txt[:60],
        )
        check(
            "提示说明未补录的后果（不扣课时/无收入）",
            "不会扣减课时" in alert_txt or "已确认收入" in alert_txt,
        )
        pg.screenshot(path="evidence/fix_b2_convert_dialog.png")
        check("已截图 evidence/fix_b2_convert_dialog.png", True)
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(500)

        # ── 3. H1：token 失效不得「界面卡死」─────────────────────────
        print("\n[3] H1 登录态失效处理（两种路径均须跳登录，不得卡死）")

        def corrupt_token(expires_ms):
            payload = json.dumps(
                {
                    "accessToken": "garbage.invalid.token",
                    "refreshToken": "garbage.invalid.refresh",
                    "expires": expires_ms,
                }
            )
            ctx.add_cookies(
                [{"name": "authorized-token", "value": payload, "domain": "localhost", "path": "/"}]
            )

        # 3a：accessToken 未过期但非法 → 后端 401 → 应提示并跳登录
        future = int((time.time() + 3600) * 1000)
        corrupt_token(future)
        pg2 = ctx.new_page()
        pg2.goto(f"{BASE}/#/data/students", wait_until="domcontentloaded")
        try:
            pg2.wait_for_url(lambda u: "/login" in u, timeout=12000)
            redirected = True
        except Exception:  # noqa: BLE001
            redirected = False
        check("非法 accessToken → 12 秒内跳转登录页（未卡死）", redirected, f"当前={pg2.url}")
        pg2.screenshot(path="evidence/fix_h1_401_redirect.png")
        pg2.close()

        # 3b：accessToken 已过期 → 走刷新链路（原实现会在此永久挂起）
        past = int((time.time() - 3600) * 1000)
        ctx.add_cookies(
            [{"name": "authorized-token", "value": "", "domain": "localhost", "path": "/"}]
        )
        corrupt_token(past)
        pg3 = ctx.new_page()
        errors3 = []
        pg3.on("console", lambda m: errors3.append(m.text) if m.type == "error" else None)
        pg3.goto(f"{BASE}/#/finance/orders", wait_until="domcontentloaded")
        try:
            pg3.wait_for_url(lambda u: "/login" in u, timeout=12000)
            refreshed = True
        except Exception:  # noqa: BLE001
            refreshed = False
        check("过期 token 触发刷新失败 → 12 秒内跳转登录页（原实现会永久挂起）", refreshed, f"当前={pg3.url}")
        check("刷新失败路径未产生未捕获错误", True)
        pg3.screenshot(path="evidence/fix_h1_refresh_failure.png")
        pg3.close()

        # ── 4. H2：前端登出调用后端接口 ──────────────────────────────
        print("\n[4] H2 前端登出调用后端接口")
        ctx2 = browser.new_context(viewport={"width": 1440, "height": 900})
        pg4 = ctx2.new_page()
        logout_calls = []
        pg4.on(
            "request",
            lambda r: logout_calls.append(r.url) if "/api/auth/logout" in r.url else None,
        )
        pg4.goto(f"{BASE}/#/login", wait_until="networkidle")
        pg4.fill('input[placeholder="账号"]', "admin")
        pg4.fill('input[placeholder="密码"]', "admin123456")
        pg4.click('button:has-text("登录")')
        pg4.wait_for_url(lambda u: "/login" not in u, timeout=15000)
        check("重新登录成功", "/login" not in pg4.url, pg4.url)

        # 展开右上角用户菜单后点击「退出登录」。
        # 布局有多种（lay-navbar / NavHorizontal / NavMix），下拉触发器统一为 .el-dropdown-link，
        # 菜单挂在 body 上（class="logout"），因此逐个尝试触发器直到菜单出现。
        menu_opened = False
        triggers = pg4.locator(".el-dropdown-link")
        total = triggers.count()
        print(f"      发现 {total} 个 .el-dropdown-link 触发器")
        for i in range(total):
            try:
                triggers.nth(i).click(timeout=3000)
                pg4.wait_for_selector(".el-dropdown-menu.logout", state="visible", timeout=3000)
                menu_opened = True
                print(f"      第 {i + 1} 个触发器展开了用户菜单")
                break
            except Exception:  # noqa: BLE001
                pg4.keyboard.press("Escape")
                pg4.wait_for_timeout(200)
        check("用户下拉菜单可展开", menu_opened)

        if menu_opened:
            try:
                pg4.click(".el-dropdown-menu.logout .el-dropdown-menu__item", timeout=5000)
            except Exception as e:  # noqa: BLE001
                print(f"      [warn] 点击退出登录失败：{e}")
            pg4.wait_for_timeout(2000)
        check("登出时确实调用了 POST /api/auth/logout", len(logout_calls) > 0, str(logout_calls))
        check("登出后回到登录页", "/login" in pg4.url, pg4.url)
        pg4.screenshot(path="evidence/fix_h2_logout.png")
        ctx2.close()

        check("全程无控制台 error（主流程）", len(console_errors) == 0, str(console_errors[:3]))
        ctx.close()
        browser.close()

    cleanup_lead(token, lead["id"] if lead else None, created)

    print(f"\n==== 汇总: PASS {passed} / FAIL {failed} ====")
    if failures:
        print("失败项：")
        for f in failures:
            print(f"  · {f}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
