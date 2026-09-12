# -*- coding: utf-8 -*-
"""验证修复后的关键页面截图"""
import os
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8080"
OUT = "evidence/ui-audit"
os.makedirs(OUT, exist_ok=True)

pages = [
    ("recruit_leads", "/#/recruit/leads"),
    ("system_audit_logs", "/#/system/audit-logs"),
]

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})

    pg.goto(f"{BASE}/#/login")
    pg.wait_for_selector("input[placeholder='账号']", timeout=15000)
    pg.fill("input[placeholder='账号']", "admin")
    pg.fill("input[type='password']", "admin123456")
    pg.click("button:has-text('登录')")
    pg.wait_for_timeout(2500)

    for name, path in pages:
        pg.goto(f"{BASE}{path}")
        pg.wait_for_timeout(1500)
        pg.wait_for_load_state("networkidle", timeout=10000)
        pg.screenshot(path=f"{OUT}/{name}_1440x900.png", full_page=True)
        print(f"saved {OUT}/{name}_1440x900.png")

    b.close()
