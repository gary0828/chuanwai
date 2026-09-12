# -*- coding: utf-8 -*-
"""批量截图关键页面，用于 UI 设计审计（路径与后端 async-routes 一致）"""
import os, time
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8080"
OUT = "evidence/ui-audit"
os.makedirs(OUT, exist_ok=True)

pages = [
    ("login", "/#/login"),
    ("welcome", "/#/welcome"),
    ("user", "/#/user"),
    ("data_students", "/#/data/students"),
    ("data_classes", "/#/data/classes"),
    ("data_courses", "/#/data/courses"),
    ("data_schedules", "/#/data/schedules"),
    ("data_terms", "/#/data/terms"),
    ("data_adjustments", "/#/data/adjustments"),
    ("data_makeups", "/#/data/makeups"),
    ("attendance_checkin", "/#/attendance/checkin"),
    ("attendance_records", "/#/attendance/records"),
    ("attendance_leaves", "/#/attendance/leaves"),
    ("attendance_statistics", "/#/attendance/statistics"),
    ("recruit_leads", "/#/recruit/leads"),
    ("family_notifications", "/#/family/notifications"),
    ("teaching_exams", "/#/teaching/exams"),
    ("teaching_reports", "/#/teaching/reports"),
    ("teaching_growth", "/#/teaching/growth"),
    ("finance_orders", "/#/finance/orders"),
    ("finance_payments", "/#/finance/payments"),
    ("finance_refunds", "/#/finance/refunds"),
    ("finance_statistics", "/#/finance/statistics"),
    ("finance_business", "/#/finance/business"),
    ("finance_consumption", "/#/finance/consumption"),
    ("system_settings", "/#/system/settings"),
    ("system_notices", "/#/system/notices"),
    ("system_backups", "/#/system/backups"),
    ("system_audit_logs", "/#/system/audit-logs"),
]

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})

    # 登录
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
