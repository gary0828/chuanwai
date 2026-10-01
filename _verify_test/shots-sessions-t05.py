#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""shots-sessions-t05.py —— T05 浏览器走查截图（admin / teacher），落盘 evidence/。"""
import os
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8848"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "evidence")
os.makedirs(OUT, exist_ok=True)


def shot(page, name):
    p = os.path.join(OUT, name)
    page.screenshot(path=p, full_page=False)
    print("saved", p)


def login(page, u, pwd):
    page.goto(BASE + "/#/login")
    page.wait_for_selector('input[placeholder="账号"]', timeout=20000)
    page.fill('input[placeholder="账号"]', u)
    page.fill('input[placeholder="密码"]', pwd)
    page.click('button:has-text("登录")')
    page.wait_for_function("() => !location.hash.includes('/login')", timeout=25000)
    page.wait_for_timeout(1800)


def open_kaoqin(page):
    t = page.locator(
        '.sidebar-container .el-sub-menu__title:has-text("考勤管理")'
    ).first
    if t.count() > 0:
        cls = t.locator("xpath=..").get_attribute("class") or ""
        if "is-opened" not in cls:
            t.click()
            page.wait_for_timeout(600)


with sync_playwright() as pw:
    b = pw.chromium.launch(headless=True)
    ctx = b.new_context(viewport={"width": 1440, "height": 900})

    # ---- admin ----
    page = ctx.new_page()
    login(page, "admin", "admin123456")
    open_kaoqin(page)
    shot(page, "t05_01_admin_menu_kaoqin.png")  # 侧边栏四新菜单

    page.goto(BASE + "/#/attendance/sessions")
    page.wait_for_timeout(1600)
    shot(page, "t05_02_admin_week_grid.png")

    try:
        page.click('button:has-text("生成本学期课次")', timeout=3000)
        page.wait_for_timeout(900)
        shot(page, "t05_03_admin_generate_dialog.png")
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)
    except Exception as e:
        print("generate dialog skip:", e)

    cards = page.locator(".week-grid .sc")
    if cards.count() > 0:
        cards.first.click()
        page.wait_for_timeout(1100)
        shot(page, "t05_04_admin_detail_drawer.png")
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)

    for path, name in [
        ("/attendance/sessions/migration-report", "t05_05_admin_migration_report.png"),
        ("/attendance/teaching-assignments", "t05_06_admin_teaching_assignments.png"),
        ("/attendance/period-times", "t05_07_admin_period_times.png"),
    ]:
        page.goto(BASE + "/#" + path)
        page.wait_for_timeout(1500)
        shot(page, name)
    page.close()

    # ---- teacher（独立 context，避免复用 admin 会话）----
    ctx2 = b.new_context(viewport={"width": 1440, "height": 900})
    page2 = ctx2.new_page()
    login(page2, "teacher", "teacher123456")
    open_kaoqin(page2)
    shot(page2, "t05_08_teacher_sidebar.png")
    page2.goto(BASE + "/#/attendance/sessions")
    page2.wait_for_timeout(1600)
    shot(page2, "t05_09_teacher_week_grid.png")
    page2.close()

    b.close()
print("DONE")
