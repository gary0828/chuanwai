# -*- coding: utf-8 -*-
"""全局样式改动的回归扫描

目的：本次改版同时替换了全站设计 token 与 Element Plus 视觉层（tokens.scss /
page.scss / element-plus-override.scss）。这些改动会影响**全部 34 个页面**，
其中大多数页面本次并未单独重写。因此必须逐页确认：
  1. 页面能正常渲染（不是白屏 / 报错页）
  2. 没有控制台错误

用法：
    python _verify_test/ui-global-sweep.py [base_url] [api_url]
"""
import json
import sys
from datetime import datetime, timedelta, timezone

sys.stdout.reconfigure(encoding="utf-8")
import requests
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8848"
API = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:3000"

# 覆盖菜单全部可达页面（admin 视角）
PAGES = [
    ("/welcome", "工作台"),
    ("/user", "员工账号"),
    ("/attendance/checkin", "考勤登记"),
    ("/attendance/records", "考勤记录"),
    ("/attendance/leaves", "请假管理"),
    ("/attendance/statistics", "统计报表"),
    ("/recruit/leads", "线索管理"),
    ("/family/notifications", "通知记录"),
    ("/teaching/exams", "成绩管理"),
    ("/teaching/reports", "学习报告"),
    ("/teaching/growth", "成长档案"),
    ("/finance/orders", "报班管理"),
    ("/finance/payments", "缴费记录"),
    ("/finance/refunds", "退费管理"),
    ("/finance/statistics", "财务统计"),
    ("/finance/business", "经营报表"),
    ("/finance/consumption", "课消统计"),
    ("/data/classes", "班级管理"),
    ("/data/students", "学生管理"),
    ("/data/courses", "课程管理"),
    ("/data/schedules", "课程表"),
    ("/data/terms", "学期管理"),
    ("/data/adjustments", "调课审批"),
    ("/data/makeups", "补课管理"),
    ("/system/settings", "系统参数"),
    ("/system/notices", "通知公告"),
    ("/system/backups", "数据备份"),
    ("/system/audit-logs", "审计日志"),
    # AI 配置中心：不在菜单里，只能凭地址进入（router/modules/remaining.ts）
    ("/ai-admin", "AI 配置中心"),
]

results = []
console_errors = []


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    flag = "PASS" if ok else "FAIL"
    print(f"{flag}  {name}  {detail}")


def on_console(msg):
    if msg.type == "error":
        console_errors.append((current_path[0], msg.text))


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


current_path = [""]

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page()
    pg.on("console", on_console)

    pg.goto(f"{BASE}/#/login", wait_until="domcontentloaded")
    inject_auth(pg, api_login("admin", "admin123456"))
    pg.wait_for_timeout(1000)

    for path, title in PAGES:
        current_path[0] = path
        pg.goto(f"{BASE}/#{path}", wait_until="networkidle")
        pg.wait_for_timeout(1100)

        # 渲染成功判定：主内容区存在且不是空白；未落到错误页
        info = pg.evaluate(
            """() => {
                const main = document.querySelector('.app-main') || document.body;
                const text = (main.innerText || '').replace(/\\s+/g, '');
                return {
                    len: text.length,
                    is404: !!document.querySelector('.error-404, .error-500'),
                    hasCard: !!document.querySelector('.el-card, .page-card, .app-page, .el-table')
                };
            }"""
        )
        ok = info["len"] > 20 and not info["is404"]
        record(f"{title} ({path})", ok, f"文本{info['len']}字")

    ctx.close()
    browser.close()

print("\n========================")
ok_count = sum(1 for _, ok, _ in results if ok)
print(f"渲染通过 {ok_count}/{len(results)}")
if console_errors:
    print(f"\n控制台错误 {len(console_errors)} 条：")
    for path, e in console_errors[:20]:
        print(f"  [{path}] {e[:160]}")
else:
    print("控制台错误 0 条")
sys.exit(0 if ok_count == len(results) and not console_errors else 1)
