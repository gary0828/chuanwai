# -*- coding: utf-8 -*-
"""响应式截图：几个关键页面在 1366x768 和 1920x1080 下的表现"""
import os
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8080"
OUT = "evidence/ui-audit"
os.makedirs(OUT, exist_ok=True)

viewports = [
    ("1366x768", 1366, 768),
    ("1920x1080", 1920, 1080),
]
pages = [
    ("welcome", "/#/welcome"),
    ("data_students", "/#/data/students"),
    ("finance_business", "/#/finance/business"),
    ("system_audit_logs", "/#/system/audit-logs"),
]

with sync_playwright() as p:
    b = p.chromium.launch()
    for vw_name, vw_w, vw_h in viewports:
        pg = b.new_page(viewport={"width": vw_w, "height": vw_h})
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
            pg.screenshot(path=f"{OUT}/{name}_{vw_name}.png", full_page=False)
            print(f"saved {OUT}/{name}_{vw_name}.png")
        pg.close()
    b.close()
