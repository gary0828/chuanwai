# -*- coding: utf-8 -*-
"""P1 UI 冒烟：用户管理/学期管理/系统参数 页面打开 + 控制台错误监听"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8080"
pages = ["用户管理", "学期管理", "系统参数"]

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page()
    errors = []
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    pg.goto(BASE + "/#/login")
    pg.wait_for_load_state("networkidle")
    pg.locator("input[placeholder='账号']").fill("admin")
    pg.locator("input[placeholder='密码']").fill("admin123456")
    pg.locator("button:has-text('登录')").click()
    pg.wait_for_timeout(1500)

    for name in pages:
        before = len(errors)
        pg.locator(f".sidebar a:has-text('{name}'), .el-menu a:has-text('{name}')").first.click()
        pg.wait_for_timeout(1500)
        new_errs = errors[before:]
        print(f"[UI] {name}: URL={pg.url.split('#')[-1]} 新增控制台错误={len(new_errs)}")
        for e in new_errs[:5]:
            print(f"     err: {e[:120]}")
        pg.screenshot(path=f"evidence/p1_ui_{name}.png", full_page=True)

    b.close()
