# -*- coding: utf-8 -*-
"""探针：/ai-admin 的面包屑与标签页是否正确

背景：批量扫描脚本是「在同一页面里连续 goto 29 个路由」，可能留下标签页残留，
导致面包屑看起来指向别的页面。本探针用全新会话直接进入 /ai-admin，
以排除测试假象。

用法：python _verify_test/ui-breadcrumb-probe.py [base_url] [api_url]
"""
import json
import sys
from datetime import datetime, timedelta, timezone

sys.stdout.reconfigure(encoding="utf-8")
import requests
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8848"
API = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:3000"

d = requests.post(
    f"{API}/api/auth/login",
    json={"username": "admin", "password": "admin123456", "type": "password"},
    timeout=10,
).json()["data"]
exp = int(
    datetime.strptime(d["expires"], "%Y/%m/%d %H:%M:%S")
    .replace(tzinfo=timezone(timedelta(hours=8)))
    .timestamp()
    * 1000
)
cookie_val = json.dumps(
    {
        "accessToken": d["accessToken"],
        "expires": exp,
        "refreshToken": d["refreshToken"],
    }
)
info_val = json.dumps(
    {
        "refreshToken": d["refreshToken"],
        "expires": exp,
        "avatar": d.get("avatar", ""),
        "username": d["username"],
        "nickname": d.get("nickname", ""),
        "roles": d.get("roles", []),
        "permissions": d.get("permissions", []),
    }
)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page()
    errs = []
    pg.on(
        "console",
        lambda m: errs.append(m.text) if m.type == "error" else None,
    )
    pg.goto(f"{BASE}/#/login", wait_until="domcontentloaded")
    pg.evaluate(
        """([c, i]) => {
            document.cookie = 'authorized-token=' + encodeURIComponent(c) + '; path=/';
            document.cookie = 'multiple-tabs=true; path=/';
            localStorage.setItem('user-info', i);
        }""",
        [cookie_val, info_val],
    )
    # 必须整页重载：store 在应用启动时就读了 localStorage，
    # 只改 hash 不会重新初始化，路由守卫会把未登录态直接踢回 /login
    pg.reload(wait_until="networkidle")
    pg.wait_for_timeout(600)
    # 全新会话直接进入 ai-admin，中间不经过任何其他页面
    pg.goto(f"{BASE}/#/ai-admin", wait_until="networkidle")
    pg.wait_for_timeout(2000)

    crumb_loc = pg.locator(".el-breadcrumb")
    crumb = (
        crumb_loc.first.inner_text().replace("\n", " / ")
        if crumb_loc.count()
        else "(本页不渲染面包屑)"
    )
    tabs = pg.locator(".tag-title").all_inner_texts()
    h1_loc = pg.locator("h1")
    h1 = h1_loc.first.inner_text() if h1_loc.count() else "(无 h1)"
    print("面包屑  :", crumb)
    print("标签页  :", tabs)
    print("页头标题:", h1)
    print("控制台错误:", errs if errs else "无")
    pg.screenshot(path="evidence/redesign_ai_admin_fresh.png")
    b.close()
