# -*- coding: utf-8 -*-
"""前端改版视觉验证：3 个样板页在桌面 / 平板视口下的截图 + 关键断言

用法：
    python _verify_test/ui-redesign-shots.py [base_url] [api_url]
默认 base_url = http://127.0.0.1:8848（serve-dist.mjs 托管 dist/）
截图输出到 evidence/redesign_*.png

设计说明：
- 登录走接口 + 注入 Cookie/localStorage，不做 UI 表单登录（登录页含 canvas 验证码，
  自动化无法识别）。因此登录页改版不影响本脚本对已登录页面的验证。
- 桌面 1440x900 与平板 1024x768 两个视口，覆盖「台式 + 平板」两类真实使用场景。
"""
import json
import sys
from datetime import datetime, timedelta, timezone

sys.stdout.reconfigure(encoding="utf-8")
import requests
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8848"
API = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:3000"

VIEWPORTS = [("desktop", 1440, 900), ("tablet", 1024, 768)]

PAGES = [
    ("welcome", "/welcome", "工作台"),
    ("classes", "/data/classes", "班级管理"),
]

results = []
console_errors = []


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")


def on_console(msg):
    if msg.type == "error":
        console_errors.append(msg.text)


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
    # 必须整页重载：store 在应用启动时就读了 localStorage
    pg.reload(wait_until="networkidle")


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---------- 1. 登录页（未登录态） ----------
    for vp_name, w, h in VIEWPORTS:
        ctx = browser.new_context(viewport={"width": w, "height": h})
        pg = ctx.new_page()
        pg.on("console", on_console)
        pg.goto(f"{BASE}/#/login", wait_until="networkidle")
        pg.wait_for_timeout(1500)
        pg.screenshot(path=f"evidence/redesign_login_{vp_name}.png")

        ok = (
            pg.locator(".login-brand__name").count() > 0
            and pg.locator(".login-form__title").count() > 0
        )
        record(f"登录页渲染 · {vp_name}", ok)

        # 旧的模板装饰（波浪背景 / 插画 / pure-admin logo）应已移除
        record(
            f"登录页已移除模板装饰 · {vp_name}",
            pg.locator("img.wave").count() == 0
            and pg.locator("svg.login-logo").count() == 0,
        )
        ctx.close()

    # ---------- 2. 已登录页面 ----------
    token_data = api_login("admin", "admin123456")
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page()
    pg.on("console", on_console)
    pg.goto(f"{BASE}/#/login", wait_until="domcontentloaded")
    inject_auth(pg, token_data)
    pg.wait_for_timeout(1200)

    for label, path, title in PAGES:
        for vp_name, w, h in VIEWPORTS:
            pg.set_viewport_size({"width": w, "height": h})
            pg.goto(f"{BASE}/#{path}", wait_until="networkidle")
            pg.wait_for_timeout(1800)
            pg.screenshot(path=f"evidence/redesign_{label}_{vp_name}.png")
            record(f"{title} 渲染 · {vp_name}", pg.locator(f"text={title}").count() > 0)

    # ---------- 3. 设计 token 落地的关键断言 ----------
    pg.set_viewport_size({"width": 1440, "height": 900})
    pg.goto(f"{BASE}/#/welcome", wait_until="networkidle")
    pg.wait_for_timeout(1500)

    primary = pg.evaluate(
        "getComputedStyle(document.documentElement).getPropertyValue('--el-color-primary').trim()"
    )
    record(
        "主题色已切换为品牌深靛蓝",
        primary.replace(" ", "").lower() in ("#1f5c99", "rgb(31,92,153)"),
        primary,
    )

    # 指标卡图标必须真实渲染为 svg（原实现用 "ep:user" 字符串图标名，图标不显示）
    icon_svg = pg.locator(".stat-card__icon svg").count()
    record("指标卡图标已渲染", icon_svg >= 4, f"svg 数量={icon_svg}")

    # 页面底色应来自 token（--surface-page = #f4f7fa），而非 Element 默认 #f2f3f5
    page_bg = pg.evaluate("getComputedStyle(document.body).backgroundColor")
    record("页面底色已接管", page_bg == "rgb(244, 247, 250)", page_bg)

    pg.goto(f"{BASE}/#/data/classes", wait_until="networkidle")
    pg.wait_for_timeout(1800)

    # 表格竖线应被消除（只保留横向分隔线）。
    # 用表头单元格兜底判断：空表时 tbody 没有 td，但表头始终存在，断言更稳定。
    border_right = pg.evaluate(
        """() => {
            const cell =
                document.querySelector('.el-table__body td.el-table__cell') ||
                document.querySelector('.el-table__header th.el-table__cell');
            return cell ? getComputedStyle(cell).borderRightWidth : 'no-cell';
        }"""
    )
    record("表格竖线已消除", border_right == "0px", border_right)

    # 表头应为冷灰底（token --ink-50），而非 Element 默认纯白
    th_bg = pg.evaluate(
        """() => {
            const th = document.querySelector('.el-table__header th.el-table__cell');
            return th ? getComputedStyle(th).backgroundColor : 'no-th';
        }"""
    )
    record("表头底已接管", th_bg == "rgb(246, 249, 251)", th_bg)

    ctx.close()
    browser.close()

print("\n========================")
ok_count = sum(1 for _, ok, _ in results if ok)
print(f"通过 {ok_count}/{len(results)}")
if console_errors:
    print("\n控制台错误：")
    for e in console_errors[:15]:
        print("  -", e)
sys.exit(0 if ok_count == len(results) else 1)
