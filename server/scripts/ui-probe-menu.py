# -*- coding: utf-8 -*-
"""探测侧边栏菜单分组 DOM 结构"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page()
    pg.goto("http://localhost:8080/#/login")
    pg.wait_for_load_state("networkidle")
    pg.locator("input[placeholder='账号']").fill("admin")
    pg.locator("input[placeholder='密码']").fill("admin123456")
    pg.locator("button:has-text('登录')").click()
    pg.wait_for_timeout(1500)

    # dump 侧边栏第一层结构
    html = pg.locator(".sidebar, aside, .el-aside").first.inner_html()
    # 找分组标题
    subs = pg.locator(".el-sub-menu, .el-sub-menu__title, .nest-menu").all()
    print("子菜单元素数:", len(subs))
    seen = set()
    for el in subs:
        t = el.inner_text().strip().split("\n")[0]
        cls = el.get_attribute("class") or ""
        if t and (t, cls[:20]) not in seen:
            seen.add((t, cls[:20]))
            print(f"  - class={cls[:30]!r} text={t[:20]!r}")
    b.close()
