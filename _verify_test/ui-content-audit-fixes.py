# 内容清点修复验证（C6 / C7 / C8 / C9）
#
# 用法：python _verify_test/ui-content-audit-fixes.py [WEB] [API]
#   缺省 WEB=API=http://127.0.0.1:18080（统一入口单端口，生产构建产物）
#
# 覆盖：
#   C6 统计页空态文案不再出现裸 `{{ }}`（且为空时渲染出真实天数）
#   C7 铃铛条目不再渲染 avatar（死字段已清）
#   C8 登录页不再展示「手机号登录 / 微信扫码登录」占位入口
#   C9 AI 配置中心不再展示未接入的 Dify 分组；index.html 静态标题不是模板名
import json
import re
import sys
from datetime import datetime, timedelta, timezone

import requests
from playwright.sync_api import sync_playwright

WEB = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18080"
API = sys.argv[2] if len(sys.argv) > 2 else WEB
TZ = timezone(timedelta(hours=8))
EV = r"C:\Users\rui08\Desktop\教学管理系统\evidence"

PASS, FAIL = [], []


def ok(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(("[OK]  " if cond else "[FAIL]") + " " + name + (f"  -- {extra}" if extra else ""))
    return cond


def inject_login(page, d):
    ms = int(datetime.strptime(d["expires"], "%Y/%m/%d %H:%M:%S").replace(tzinfo=TZ).timestamp() * 1000)
    cv = json.dumps({"accessToken": d["accessToken"], "expires": ms, "refreshToken": d["refreshToken"]})
    iv = json.dumps({
        "refreshToken": d["refreshToken"], "expires": ms, "avatar": d.get("avatar", ""),
        "username": d["username"], "nickname": d.get("nickname", ""),
        "roles": d.get("roles", []), "permissions": d.get("permissions", []),
    })
    page.goto(f"{WEB}/#/login", wait_until="domcontentloaded")
    page.evaluate(
        """([c,i])=>{document.cookie='authorized-token='+encodeURIComponent(c)+'; path=/';
            document.cookie='multiple-tabs=true; path=/';localStorage.setItem('user-info',i);}""",
        [cv, iv],
    )
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1200)


admin = requests.post(f"{API}/api/auth/login", json={"username": "admin", "password": "admin123456"}, timeout=15).json()["data"]
AH = {"Authorization": f"Bearer {admin['accessToken']}"}

# ── C9b：静态 HTML 里的 <title>（不经 JS，直接看服务端返回的源码）────────
try:
    resp = requests.get(f"{WEB}/", timeout=15)
    # ★ 必须显式按 UTF-8 解码：requests 在缺少 charset 时会回落 Latin-1，
    #   中文标题会变成 `æå¡...` 乱码，导致断言误报（本次踩过）
    raw = resp.content.decode("utf-8", errors="replace")
    m = re.search(r"<title>(.*?)</title>", raw, re.S)
    static_title = m.group(1).strip() if m else "(未找到)"
    ok(
        "C9b：index.html 源码标题不是模板名 pure-admin-thin",
        "pure-admin-thin" not in static_title,
        f"实际=<title>{static_title}</title>",
    )
    ok(
        "C9b：静态标题与平台配置 Title 一致（教务管理系统）",
        static_title == "教务管理系统",
        f"实际={static_title}",
    )
except Exception as e:  # noqa: BLE001
    ok("C9b：取首页源码", False, str(e)[:120])

# ── 统计页预警名单是否为空（决定空态是否会出现）─────────────────────
warn = requests.get(
    f"{API}/api/attendance/warnings",
    headers=AH,
    params={"rate": "0.80", "consecutive": 3, "days": 14},
    timeout=15,
).json()
low_rate_n = len(warn.get("data", {}).get("low_rate", []))
consec_n = len(warn.get("data", {}).get("consecutive_absent", []))
days = warn.get("data", {}).get("range", {}).get("days")
print(f"[info] 预警名单：低出勤率 {low_rate_n} 人 · 连续缺勤 {consec_n} 人 · 天数 {days}")

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 950})

    # ── C8：登录页不展示多端登录占位 ─────────────────────────────
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{WEB}/#/login", wait_until="networkidle")
    pg.wait_for_timeout(1500)
    login_body = pg.inner_text("body")
    ok("C8：登录页不再出现「手机号登录」", "手机号登录" not in login_body, "")
    ok("C8：登录页不再出现「微信扫码登录」", "微信扫码登录" not in login_body, "")
    ok("C8：登录按钮仍在（未被误删）", pg.query_selector("button:has-text('登录')") is not None, "")
    ok("C8：登录页无 JS 报错", len(errs) == 0, f"{errs[:2]}")
    pg.screenshot(path=f"{EV}\\audit-login.png", full_page=True)
    pg.close()

    # ── C6：统计页 ───────────────────────────────────────────────
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    inject_login(pg, admin)
    pg.goto(f"{WEB}/#/attendance/statistics", wait_until="networkidle")
    pg.wait_for_timeout(2600)
    body = pg.inner_text("body")
    ok(
        "C6：页面不出现裸插值 `{{ warnings.range.days }}`",
        "{{ warnings.range.days }}" not in body,
        "（这是修复前的字面量）",
    )
    if low_rate_n == 0:
        ok(
            "C6：低出勤率空态渲染出真实天数（不再是花括号）",
            f"近 {days} 天暂无低出勤率学生" in body,
            f"期望包含「近 {days} 天暂无低出勤率学生」",
        )
    else:
        print(f"[skip] C6 低出勤率空态：名单有 {low_rate_n} 人，空态本就不展示")
    if consec_n == 0:
        ok(
            "C6：连续缺勤空态渲染出真实天数",
            f"近 {days} 天暂无连续缺勤学生" in body,
            f"期望包含「近 {days} 天暂无连续缺勤学生」",
        )
    else:
        print(f"[skip] C6 连续缺勤空态：名单有 {consec_n} 人，空态本就不展示")
    ok("C6：统计页无 JS 报错", len(errs) == 0, f"{errs[:2]}")
    pg.screenshot(path=f"{EV}\\audit-statistics-empty.png", full_page=True)

    # ── C7：铃铛条目无 avatar 元素 ───────────────────────────────
    pg.click(".dropdown-badge")
    pg.wait_for_timeout(1800)
    ok("C7：铃铛下拉已打开（含「通知」tab）", "通知" in pg.inner_text("body"))
    avatars = pg.query_selector_all(".notice-container-avatar")
    ok("C7：铃铛条目不再渲染头像（死字段已清）", len(avatars) == 0, f"命中 {len(avatars)} 个 .notice-container-avatar")
    ok("C7：铃铛页无 JS 报错", len(errs) == 0, f"{errs[:2]}")
    pg.screenshot(path=f"{EV}\\audit-bell.png", full_page=True)
    pg.close()

    # ── C9a：AI 配置中心不展示未接入的 Dify 分组 ─────────────────
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    inject_login(pg, admin)
    pg.goto(f"{WEB}/#/ai-admin", wait_until="networkidle")
    pg.wait_for_timeout(2600)
    ai_body = pg.inner_text("body")
    ok("C9a：AI 配置中心可打开", "/ai-admin" in pg.url, pg.url)
    ok("C9a：大模型分组仍在（未被误删）", "大模型" in ai_body, "")
    ok(
        "C9a：未接入的 Dify 分组不再展示",
        "Dify" not in ai_body,
        "（若该项失败，说明 DB 里已存在 dify* 历史配置值 → 按设计会显示出来供维护）",
    )
    ok("C9a：AI 配置中心无 JS 报错", len(errs) == 0, f"{errs[:2]}")
    pg.screenshot(path=f"{EV}\\audit-ai-admin.png", full_page=True)
    pg.close()
    b.close()

print(f"\n======= 结果：PASS {len(PASS)} / FAIL {len(FAIL)} =======")
if FAIL:
    print("失败项：\n - " + "\n - ".join(FAIL))
sys.exit(1 if FAIL else 0)
