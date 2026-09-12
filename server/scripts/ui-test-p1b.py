# -*- coding: utf-8 -*-
"""P1-1b：API 层 auth 验证 + UI 头部结构 dump（找登出入口）"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/api"

def api_login(ctx, user, pwd):
    r = ctx.post(f"{BASE}/auth/login", data={"username": user, "password": pwd})
    body = r.json() if r.headers.get("content-type","").startswith("application/json") else r.text()[:200]
    return r.status, body

with sync_playwright() as p:
    ctx = p.request.new_context()
    print("=== API: 登录校验 ===")
    st, body = api_login(ctx, "admin", "wrong123")
    print(f"[API] admin+错误密码 -> {st} | {str(body)[:150]}")
    st, body = api_login(ctx, "admin", "admin123456")
    print(f"[API] admin+正确密码 -> {st} | keys={list(body.keys()) if isinstance(body,dict) else 'n/a'}")
    st, body = api_login(ctx, "notexist", "x")
    print(f"[API] 不存在用户 -> {st} | {str(body)[:120]}")
    st, body = api_login(ctx, "s2023001", "s2023001123456")
    print(f"[API] 学生账号登录 -> {st} | {str(body)[:150]}")
    ctx.dispose()

    # UI: 登录后 dump 头部结构
    b = p.chromium.launch(headless=True)
    pg = b.new_page()
    pg.goto("http://localhost:8080/#/login")
    pg.wait_for_load_state("networkidle")
    pg.locator("input[placeholder='账号']").fill("admin")
    pg.locator("input[placeholder='密码']").fill("admin123456")
    pg.locator("button:has-text('登录')").click()
    pg.wait_for_timeout(1500)
    # dump 顶栏相关元素
    headers = pg.locator("header, .navbar, .el-header").all()
    print("\n=== UI: 顶栏结构 ===")
    for i, h in enumerate(headers[:3]):
        cls = h.get_attribute("class") or ""
        html = h.inner_text()[:300].replace("\n", " | ")
        print(f"[header {i}] class={cls[:60]} text={html!r}")
    # 尝试找用户信息区
    print("\n=== UI: 含'admin'或'管理员'的可点击元素 ===")
    for el in pg.locator("div, span, a, button").filter(has_text="管理员").all()[:10]:
        try:
            t = el.inner_text().strip()
            if t and len(t) < 40:
                print(f"  - {el.evaluate('e=>e.tagName')} class={el.get_attribute('class') or ''!r} text={t!r}")
        except Exception:
            pass
    b.close()
