# -*- coding: utf-8 -*-
"""截取若干「本次未单独改版」的页面，用于确认全局 token 改动已生效。

这些页面的源码一行未动，样式完全来自 tokens.scss / page.scss /
element-plus-override.scss 的全局接管。若它们的外观也已统一，
即证明"改一层、全站受益"的策略成立。

用法：
    python _verify_test/ui-style-inherit.py [base_url] [api_url]
"""
import json
import sys
from datetime import datetime, timedelta, timezone

sys.stdout.reconfigure(encoding="utf-8")
import requests
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8848"
API = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:3000"

SHOTS = [
    ("students_list", "/data/students"),
    ("checkin_form", "/attendance/checkin"),
    ("finance_stats", "/finance/statistics"),
    ("exams_table", "/teaching/exams"),
]


def api_login(username, password):
    r = requests.post(
        f"{API}/api/auth/login",
        json={"username": username, "password": password, "type": "password"},
        timeout=10,
    )
    return r.json()["data"]


def inject_auth(pg, d):
    expires_ms = int(
        datetime.strptime(d["expires"], "%Y/%m/%d %H:%M:%S")
        .replace(tzinfo=timezone(timedelta(hours=8)))
        .timestamp()
        * 1000
    )
    cookie_val = json.dumps(
        {
            "accessToken": d["accessToken"],
            "expires": expires_ms,
            "refreshToken": d["refreshToken"],
        }
    )
    info_val = json.dumps(
        {
            "refreshToken": d["refreshToken"],
            "expires": expires_ms,
            "avatar": d.get("avatar", ""),
            "username": d["username"],
            "nickname": d.get("nickname", ""),
            "roles": d.get("roles", []),
            "permissions": d.get("permissions", []),
        }
    )
    pg.evaluate(
        """([cookieVal, infoVal]) => {
            document.cookie = 'authorized-token=' + encodeURIComponent(cookieVal) + '; path=/';
            document.cookie = 'multiple-tabs=true; path=/';
            localStorage.setItem('user-info', infoVal);
        }""",
        [cookie_val, info_val],
    )
    pg.reload(wait_until="networkidle")


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page()

    pg.goto(f"{BASE}/#/login", wait_until="domcontentloaded")
    inject_auth(pg, api_login("admin", "admin123456"))
    pg.wait_for_timeout(1000)

    for name, path in SHOTS:
        pg.goto(f"{BASE}/#{path}", wait_until="networkidle")
        pg.wait_for_timeout(1600)
        pg.screenshot(path=f"evidence/inherit_{name}.png")
        # 顺手断言：表头底色是否已接管为 token 值
        th_bg = pg.evaluate(
            """() => {
                const th = document.querySelector('.el-table__header th.el-table__cell');
                return th ? getComputedStyle(th).backgroundColor : 'no-table';
            }"""
        )
        print(f"shot evidence/inherit_{name}.png   表头底色={th_bg}")

    ctx.close()
    browser.close()
print("done")
