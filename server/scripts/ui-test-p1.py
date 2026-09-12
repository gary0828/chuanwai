# -*- coding: utf-8 -*-
"""P1-1 登录/登出测试：错误密码、正确登录、登出、无权限访问"""
import sys, os
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

os.makedirs("evidence", exist_ok=True)
BASE = "http://localhost:8080"

def login(pg, user, pwd):
    pg.goto(BASE + "/#/login")
    pg.wait_for_load_state("networkidle")
    pg.locator("input[placeholder='账号']").fill(user)
    pg.locator("input[placeholder='密码']").fill(pwd)
    pg.locator("button:has-text('登录')").click()
    pg.wait_for_timeout(1500)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page()

    # 1) 错误密码：应提示错误且停留在登录页
    login(pg, "admin", "wrong_password_123")
    msgs = pg.locator(".el-message, .el-message__content, .el-form-item__error").all_inner_texts()
    print("[1] 错误密码提示:", msgs if msgs else "(无弹层提示，检查截图)")
    pg.screenshot(path="evidence/p1_01_wrong_pwd.png", full_page=True)
    print("[1] 错误密码后 URL:", pg.url, "| 仍在登录页:", "/login" in pg.url or "login" in pg.url)

    # 2) 正确登录 admin
    login(pg, "admin", "admin123456")
    print("[2] 登录成功 URL:", pg.url, "| title:", pg.title())

    # 探索右上角用户区域（用于登出）
    pg.wait_for_timeout(800)
    # 尝试点击右上角用户信息/头像下拉
    candidates = pg.locator(".el-dropdown, .navbar, .avatar, .el-tooltip, .right-menu").all()
    print("[2] 右上角候选元素数:", len(candidates))
    pg.screenshot(path="evidence/p1_02_logged_in.png", full_page=True)

    # 3) 登出：点击右上角区域找退出项
    try:
        # 常见：navbar 右侧有用户名 + 下拉
        user_area = pg.locator(".navbar >>> .el-dropdown, .navbar .el-dropdown, .hamburger + *, header .el-dropdown").first
        user_area.click()
        pg.wait_for_timeout(800)
        logout_btns = pg.locator("li:has-text('退出'), .el-dropdown-menu__item:has-text('退出'), button:has-text('退出')").all()
        print("[3] 下拉后退出项:", [x.inner_text() for x in logout_btns])
        if logout_btns:
            logout_btns[0].click()
            pg.wait_for_timeout(1200)
            print("[3] 登出后 URL:", pg.url, "| title:", pg.title())
    except Exception as e:
        print("[3] 登出探索异常:", e)
        pg.screenshot(path="evidence/p1_03_logout_probe.png", full_page=True)

    b.close()
