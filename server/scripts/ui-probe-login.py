# -*- coding: utf-8 -*-
"""P1 探测：登录页结构探索 + admin 登录 + 菜单结构（用于确定后续选择器）"""
import sys, os
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

os.makedirs("evidence", exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page()
    pg.goto("http://localhost:8080")
    pg.wait_for_load_state("networkidle")

    print("[probe] 登录页 inputs:")
    for i, el in enumerate(pg.locator("input").all()):
        print(f"  [{i}] type={el.get_attribute('type')} ph={el.get_attribute('placeholder')}")

    print("[probe] 登录页 buttons:")
    for i, el in enumerate(pg.locator("button").all()):
        print(f"  [{i}] text={el.inner_text()[:40]!r}")

    pg.screenshot(path="evidence/01_login_page.png", full_page=True)

    # 尝试登录 admin（用户名/密码输入框通常有 placeholder）
    u = pg.locator("input[placeholder*='名'], input[type='text']").first
    pw = pg.locator("input[type='password']").first
    u.fill("admin")
    pw.fill("admin123456")
    pg.keyboard.press("Enter")
    pg.wait_for_load_state("networkidle")
    pg.wait_for_timeout(1500)
    pg.screenshot(path="evidence/02_after_login.png", full_page=True)
    print("[probe] 登录后 URL:", pg.url)
    print("[probe] 登录后 title:", pg.title())

    # 菜单结构
    print("[probe] 侧边菜单文本:")
    menus = pg.locator(".el-menu a, aside a, .sidebar a, nav a").all()
    if not menus:
        menus = pg.locator("a").all()
    seen = set()
    for el in menus:
        t = el.inner_text().strip()
        if t and t not in seen:
            seen.add(t)
            print(f"  - {t[:50]!r}")
    b.close()
