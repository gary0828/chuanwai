# -*- coding: utf-8 -*-
"""P1 UI 冒烟 v2：菜单导航（含分组展开）+ 页面加载 + 控制台错误"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8080"

def open_menu(pg, item, group=None):
    if group:
        pg.locator(f"li.el-sub-menu:has-text('{group}') .el-sub-menu__title").first.click()
        pg.wait_for_timeout(500)
    sel = f"a.outer-most:has-text('{item}')" if not group else f"a.nest-menu:has-text('{item}')"
    pg.locator(sel).first.click()
    pg.wait_for_timeout(1500)

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

    cases = [("用户管理", None), ("学期管理", "数据管理"), ("系统参数", "系统管理")]
    for item, group in cases:
        before = len(errors)
        open_menu(pg, item, group)
        new_errs = errors[before:]
        print(f"[UI] {item}: URL={pg.url.split('#')[-1]} 控制台错误={len(new_errs)}")
        for e in new_errs[:5]:
            print(f"     err: {e[:130]}")
        pg.screenshot(path=f"evidence/p1_ui_{item}.png", full_page=True)
    b.close()
