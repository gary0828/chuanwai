# -*- coding: utf-8 -*-
"""P1-A 前端验证（修正等待时机）：点击登录后 800ms 内检查 el-message 提示出现"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

results = []
def record(no, name, ok, detail=""):
    results.append((no, name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {no} {name} {detail}")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})

    def fresh_load():
        page.goto("http://localhost:8080?t=" + str(__import__("time").time()))
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1500)

    # 场景1：错误密码 → 应弹出「账号或密码错误」
    fresh_load()
    page.fill("input[placeholder='账号']", "admin")
    page.fill("input[placeholder='密码']", "wrongpass999")
    page.click("button:has-text('登录')")
    page.wait_for_timeout(800)  # message duration=2000ms，须在关闭前检查
    msg_text = " | ".join(page.locator(".el-message").all_inner_texts())
    record("P1A-UI.1", "错误密码显示提示", "账号或密码错误" in msg_text, f"msg={msg_text}")
    page.screenshot(path="evidence/p1a_fix_wrongpwd3.png", full_page=True)

    # 场景2：学生账号 → 应弹出「暂未开放登录」
    fresh_load()
    page.fill("input[placeholder='账号']", "s2023001")
    page.fill("input[placeholder='密码']", "s2023001123456")
    page.click("button:has-text('登录')")
    page.wait_for_timeout(800)
    msg_text = " | ".join(page.locator(".el-message").all_inner_texts())
    record("P1A-UI.2", "学生账号显示提示", "暂未开放登录" in msg_text, f"msg={msg_text}")
    page.screenshot(path="evidence/p1a_fix_student3.png", full_page=True)

    # 场景3：正确密码 → 登录成功跳转（回归）
    fresh_load()
    page.fill("input[placeholder='账号']", "admin")
    page.fill("input[placeholder='密码']", "admin123456")
    page.click("button:has-text('登录')")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(2500)
    url = page.url
    logged_in = "#/welcome" in url and "login" not in url
    record("P1A-UI.3", "正确密码登录成功", logged_in, f"url={url}")

    fails = [x for x in results if not x[2]]
    print(f"\n==== P1-A UI 验证汇总: PASS {len(results)-len(fails)} / {len(results)} ====")
    for f in fails:
        print("  FAIL:", f[0], f[1], f[3])
    browser.close()
