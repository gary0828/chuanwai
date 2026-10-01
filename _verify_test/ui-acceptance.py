# -*- coding: utf-8 -*-
"""改版验收点验证

覆盖三项本轮新增的可验收要求，全部用「计算后的实际值」断言，不靠肉眼：
  1. 登录框位于页面水平正中央（多个视口下偏差 ≤ 2px）
  2. 侧边栏自动折叠阈值：>1200 展开，≤1200 折叠（覆盖平板横屏 1024）
  3. AI 配置中心页渲染完整（说明条 + 余额大数字 + 配置分组）

用法：
    python _verify_test/ui-acceptance.py [base_url] [api_url]
"""
import json
import sys
from datetime import datetime, timedelta, timezone

sys.stdout.reconfigure(encoding="utf-8")
import requests
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8848"
API = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:3000"

results = []


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")


def api_login(username, password):
    r = requests.post(
        f"{API}/api/auth/login",
        json={"username": username, "password": password, "type": "password"},
        timeout=10,
    )
    return r.json()["data"]


def inject_auth(pg, d):
    expires_ms = int(
        datetime.strptime(d["expires"], "%Y/%m/%d %H:%M:%S")
        .replace(tzinfo=timezone(timedelta(hours=8)))
        .timestamp()
        * 1000
    )
    cookie_val = json.dumps(
        {
            "accessToken": d["accessToken"],
            "expires": expires_ms,
            "refreshToken": d["refreshToken"],
        }
    )
    info_val = json.dumps(
        {
            "refreshToken": d["refreshToken"],
            "expires": expires_ms,
            "avatar": d.get("avatar", ""),
            "username": d["username"],
            "nickname": d.get("nickname", ""),
            "roles": d.get("roles", []),
            "permissions": d.get("permissions", []),
        }
    )
    pg.evaluate(
        """([cookieVal, infoVal]) => {
            document.cookie = 'authorized-token=' + encodeURIComponent(cookieVal) + '; path=/';
            document.cookie = 'multiple-tabs=true; path=/';
            localStorage.setItem('user-info', infoVal);
        }""",
        [cookie_val, info_val],
    )
    pg.reload(wait_until="networkidle")


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ── 1. 登录框页面居中 ────────────────────────────────────────────────────
    for w, h in [(1680, 1050), (1440, 900), (1280, 800), (1180, 820)]:
        ctx = browser.new_context(viewport={"width": w, "height": h})
        pg = ctx.new_page()
        pg.goto(f"{BASE}/#/login", wait_until="networkidle")
        pg.wait_for_timeout(900)
        box = pg.locator(".login-form").bounding_box()
        center = box["x"] + box["width"] / 2
        delta = abs(center - w / 2)
        record(
            f"登录框居中 @{w}px",
            delta <= 2,
            f"中心 x={center:.1f} / 视口中心 {w / 2:.0f}，偏差 {delta:.1f}px",
        )
        if w in (1440, 1280):
            pg.screenshot(path=f"evidence/redesign_login_center_{w}.png")
        ctx.close()

    # ── 2. 侧边栏自动折叠 ────────────────────────────────────────────────────
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page()
    pg.goto(f"{BASE}/#/login", wait_until="domcontentloaded")
    inject_auth(pg, api_login("admin", "admin123456"))

    for w, h, expect_collapsed in [
        (1440, 900, False),
        (1220, 800, False),
        (1024, 768, True),
        (900, 700, True),
    ]:
        pg.set_viewport_size({"width": w, "height": h})
        pg.goto(f"{BASE}/#/data/students", wait_until="networkidle")
        pg.wait_for_timeout(1500)
        sw = pg.evaluate(
            "document.querySelector('.sidebar-container')?.offsetWidth || 0"
        )
        collapsed = sw < 100
        record(
            f"侧边栏{'折叠' if expect_collapsed else '展开'} @{w}px",
            collapsed == expect_collapsed,
            f"实际宽度 {sw}px",
        )
        if w in (1440, 1024):
            pg.screenshot(path=f"evidence/redesign_sidebar_{w}.png")

    # ── 3. AI 配置中心 ──────────────────────────────────────────────────────
    pg.set_viewport_size({"width": 1440, "height": 900})
    pg.goto(f"{BASE}/#/ai-admin", wait_until="networkidle")
    pg.wait_for_timeout(1800)
    pg.screenshot(path="evidence/redesign_ai_admin.png")
    has_notice = pg.locator(".notice").count() > 0
    has_groups = pg.locator(".group__title").count() >= 2
    has_cards = pg.locator(".stat-card").count() >= 2
    record(
        "AI 配置中心页结构完整",
        has_notice and has_groups and has_cards,
        f"说明条={has_notice} 分组={pg.locator('.group__title').count()} 状态卡={pg.locator('.stat-card').count()}",
    )

    ctx.close()
    browser.close()

print("\n========================")
okn = sum(1 for _, o, _ in results if o)
print(f"通过 {okn}/{len(results)}")
sys.exit(0 if okn == len(results) else 1)
