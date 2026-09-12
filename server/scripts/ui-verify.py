# -*- coding: utf-8 -*-
"""验证 UI 修复效果：打开大量 tab 并截图关键页面"""
import os
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8080"
OUT = "evidence/ui-audit"
os.makedirs(OUT, exist_ok=True)

# 访问足够多的页面触发 MaxTagsLevel=10
tabs = [
    "/#/welcome",
    "/#/user",
    "/#/data/students",
    "/#/data/classes",
    "/#/data/courses",
    "/#/data/schedules",
    "/#/data/terms",
    "/#/data/adjustments",
    "/#/data/makeups",
    "/#/attendance/checkin",
    "/#/attendance/records",
    "/#/attendance/leaves",
    "/#/attendance/statistics",
    "/#/recruit/leads",
    "/#/family/notifications",
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

    for path in tabs:
        pg.goto(f"{BASE}{path}")
        pg.wait_for_timeout(800)

    # 截图验证 tab 限制和表格列宽
    targets = [
        ("verify_adjustments", "/#/data/adjustments"),
        ("verify_audit_logs", "/#/system/audit-logs"),
        ("verify_finance_business", "/#/finance/business"),
    ]
    for name, path in targets:
        pg.goto(f"{BASE}{path}")
        pg.wait_for_timeout(1500)
        pg.wait_for_load_state("networkidle", timeout=10000)
        pg.screenshot(path=f"{OUT}/{name}_1440x900.png", full_page=False)
        print(f"saved {OUT}/{name}_1440x900.png")

    b.close()
