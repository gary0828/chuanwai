# -*- coding: utf-8 -*-
"""P1-1c：登录/登出闭环——错误密码 UI 提示、登出、登录态失效"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8080"

def do_login(pg, user, pwd):
    pg.goto(BASE + "/#/login")
    pg.wait_for_load_state("networkidle")
    pg.locator("input[placeholder='账号']").fill(user)
    pg.locator("input[placeholder='密码']").fill(pwd)
    pg.locator("button:has-text('登录')").click()
    pg.wait_for_timeout(1500)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page()

    # 1) 错误密码：抓取页面上任何提示文本
    do_login(pg, "admin", "wrong_pwd_123")
    url_after = pg.url
    # dump 全页可见文本里的提示（el-message 可能在 body 末尾渲染）
    body_text = pg.locator("body").inner_text()
    hint = [l for l in body_text.splitlines() if "账号或密码错误" in l or "错误" in l or "失败" in l]
    print("[P1-1] 错误密码提示文本:", hint if hint else "(body 中未发现)")
    # 也检查 .el-message 结构
    elm = pg.locator(".el-message").count()
    print("[P1-1] el-message 元素数:", elm, "| 停留登录页:", "login" in url_after)
    pg.screenshot(path="evidence/p1_1_wrongpwd.png", full_page=True)

    # 2) 正确登录 -> 登出
    do_login(pg, "admin", "admin123456")
    print("[P1-1] 登录成功 ->", pg.url)
    pg.locator(".el-dropdown:has-text('系统管理员')").click()
    pg.wait_for_timeout(800)
    items = pg.locator(".el-dropdown-menu__item, li[role='menuitem']").all_inner_texts()
    print("[P1-1] 用户下拉项:", items)
    pg.screenshot(path="evidence/p1_1_user_dropdown.png", full_page=True)
    # 点退出
    logout = pg.locator(".el-dropdown-menu__item:has-text('退出'), li[role='menuitem']:has-text('退出')").first
    if logout.count():
        logout.click()
        pg.wait_for_timeout(1500)
        print("[P1-1] 登出后 URL:", pg.url, "| title:", pg.title())
    else:
        print("[P1-1] 未找到退出项")

    # 3) 登出后访问受保护页面应回到登录页
    pg.goto(BASE + "/#/welcome")
    pg.wait_for_timeout(1500)
    print("[P1-1] 登出后直接访问 /#/welcome -> URL:", pg.url, "（应被踢回登录页）")
    b.close()
