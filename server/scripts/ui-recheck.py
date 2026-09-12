# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8080"
OUT = "evidence/ui-audit"

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto(f"{BASE}/#/login")
    pg.wait_for_selector("input[placeholder='账号']", timeout=15000)
    pg.fill("input[placeholder='账号']", "admin")
    pg.fill("input[type='password']", "admin123456")
    pg.click("button:has-text('登录')")
    pg.wait_for_timeout(2500)

    pg.goto(f"{BASE}/#/data/adjustments")
    pg.wait_for_load_state("networkidle", timeout=10000)
    pg.wait_for_timeout(2000)

    text = pg.locator('.el-table__header-wrapper th:has-text("状态")').inner_text()
    print("header text:", repr(text))

    pg.screenshot(path=f"{OUT}/recheck_adjustments.png", full_page=False)
    print(f"saved {OUT}/recheck_adjustments.png")
    b.close()
