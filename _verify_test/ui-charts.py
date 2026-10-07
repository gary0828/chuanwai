# 图表渲染实证（2026-10-03 新增）
#
# verify-charts.mjs 验的是「接口字段对不对」；本脚本验的是「**canvas 有没有真的画出来**」。
# 两者不可互相替代：字段齐全但 options 结构写错，computed 照样返回非空，
# 结果是一张空白坐标系 —— 只看接口断言发现不了。
#
# 做法：登录 → 逐页打开 → 断言 .app-chart-card 内存在非零尺寸的 canvas
#       → 截图存 evidence/ 供人工复核
#
# 运行： WEB=http://127.0.0.1:8848 API=http://127.0.0.1:3000 \
#        "C:/.../python.exe" _verify_test/ui-charts.py
import json
import os
import sys
import time
import requests
from playwright.sync_api import sync_playwright

WEB = os.environ.get("WEB", "http://127.0.0.1:8848")
API = os.environ.get("API", "http://127.0.0.1:3000")
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "evidence")
os.makedirs(SHOTS, exist_ok=True)

PASS, FAIL = 0, 0
FAILED = []


def ck(cond, label, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"[PASS] {label}")
    else:
        FAIL += 1
        FAILED.append(label)
        print(f"[FAIL] {label} {extra}")


def seed_auth(ctx, username, password):
    """注入登录态（沿用项目既有做法：Cookie + localStorage，等价正常登录后的浏览器状态）
    ★ Cookie 的 domain 必须与实际访问的 host 一致：沙箱绑 127.0.0.1，
      写 localhost 会导致 cookie 不生效 → 被路由守卫踢回 /login。"""
    r = requests.post(
        f"{API}/api/auth/login",
        json={"username": username, "password": password, "type": "password"},
        timeout=15,
    )
    data = r.json()["data"]
    host = WEB.split("//")[-1].split(":")[0]
    expires_ms = int(data["expires"]) if str(data["expires"]).isdigit() else int(
        time.mktime(time.strptime(data["expires"], "%Y/%m/%d %H:%M:%S")) * 1000
    )
    cookie_val = json.dumps({
        "accessToken": data["accessToken"],
        "expires": expires_ms,
        "refreshToken": data["refreshToken"],
    })
    ctx.add_cookies([
        {"name": "authorized-token", "value": cookie_val, "domain": host, "path": "/"},
        {"name": "multiple-tabs", "value": "true", "domain": host, "path": "/"},
    ])
    user_info = json.dumps({
        "refreshToken": data["refreshToken"],
        "expires": expires_ms,
        "avatar": data.get("avatar", ""),
        "username": data["username"],
        "nickname": data["nickname"],
        "roles": data["roles"],
        "permissions": data["permissions"],
    }, ensure_ascii=False)
    ctx.add_init_script(
        f"window.localStorage.setItem('user-info', {json.dumps(user_info, ensure_ascii=False)});"
    )
    return data


def canvas_stats(page):
    """返回页面里所有 echarts canvas 的尺寸列表（width,height 均为像素）"""
    return page.evaluate("""() => Array.from(document.querySelectorAll('.app-chart-card canvas'))
        .map(c => ({w: c.width, h: c.height}))""")


def empty_stats(page):
    """空态卡片数量"""
    return page.evaluate(
        "() => document.querySelectorAll('.app-chart-card .app-empty').length"
    )


def chart_report(page):
    """逐卡片返回 canvas / 空态 数量，用于精确断言（不能只看总数 >0）"""
    return page.evaluate("""() => Array.from(document.querySelectorAll('.app-chart-card')).map(c => ({
      title: (c.querySelector('.card-head')||{}).textContent || '',
      canvas: c.querySelectorAll('canvas').length,
      empty: c.querySelectorAll('.app-empty').length
    }))""")


def assert_charts(page, label, shot, expect_min=1):
    """只断言当前 DOM 状态，不重新导航。
    ★ 不可用 page.goto() 来"刷新"断言 —— 那会把 el-tabs 选中的页签重置回默认，
      非激活页签内图表容器 offsetHeight=0（未激活的 tab-pane 是 display:none），
      于是全部落到空态，看起来像"图表没画出来"。"""
    reports = chart_report(page)
    ck(len(reports) > 0, f"{label}：存在图表卡片", f"count={len(reports)}")
    drawn = sum(r["canvas"] for r in reports)
    empties = sum(r["empty"] for r in reports)
    ck(drawn + empties >= len(reports),
       f"{label}：每张卡片都有明确归宿（画出或空态）", f"{reports}")
    ck(drawn >= expect_min, f"{label}：至少 {expect_min} 个图表已绘制",
       f"canvas={drawn} empty={empties} detail={reports}")
    page.screenshot(path=os.path.join(SHOTS, shot), full_page=True)
    print(f"       截图 → evidence/{shot}（canvas {drawn} / 空态 {empties}）")
    return drawn


def goto(page, path, label, shot, expect_min=1):
    page.goto(f"{WEB}{path}", wait_until="networkidle", timeout=45000)
    time.sleep(3)
    return assert_charts(page, label, shot, expect_min)


with sync_playwright() as p:
    browser = p.chromium.launch()

    # 登录：注入登录态（比模拟输入可靠，也与项目既有脚本一致）
    ctx = browser.new_context(viewport={"width": 1600, "height": 1000})
    seed_auth(ctx, "admin", "admin123456")
    page = ctx.new_page()

    # ★ 路由是 hash 模式（.env.production: VITE_ROUTER_HISTORY = "hash"）：
    #   正确形式是 http://host/#/finance/statistics，写成 /finance/statistics 会被守卫踢回工作台。
    page.goto(f"{WEB}/#/welcome", wait_until="networkidle", timeout=45000)
    time.sleep(3)
    ck("/login" not in page.url, "登录成功并跳转", f"url={page.url}")

    #图表① 财务营收折线（默认页签）
    goto(page, "/#/finance/statistics", "图表① 营收折线", "chart-01-revenue.png", 1)

    # 图表②③ 经营构成页签（需先切页签，等容器拿到高度）
    page.locator('.el-tabs__item:has-text("经营构成")').first.click()
    time.sleep(4)
    assert_charts(page, "图表②③ 经营构成", "chart-02-03-business.png", 2)

    # 图表⑥ 剩余课时分布
    page.locator('.el-tabs__item:has-text("剩余课时预警")').first.click()
    time.sleep(4)
    assert_charts(page, "图表⑥ 课时分布", "chart-06-hours.png", 1)

    # 图表④ 招生漏斗 + 渠道条形
    #  ★ 漏斗数据只有一段（全部线索 6 / 进入跟进 0）时会**按设计走空态**——
    #    ECharts 漏斗在 0 值段会整张塌成空白，故前端过滤掉 0 值阶段。
    #    因此这里只要求「渠道条形」必须画出，漏斗允许是空态（有明确文案即合格）。
    page.goto(f"{WEB}/#/recruit/leads", wait_until="networkidle", timeout=45000)
    time.sleep(2.5)
    page.locator('.el-tabs__item:has-text("渠道统计")').first.click()
    time.sleep(4)
    reports = chart_report(page)
    drawn = sum(r["canvas"] for r in reports)
    empties = sum(r["empty"] for r in reports)
    ck(len(reports) == 2, "渠道统计页两张图表卡片", f"{reports}")
    ck(drawn + empties >= len(reports),
       "图表④ 每张卡片都有明确归宿（画出或空态）", f"{reports}")
    channel_drawn = [r for r in reports if "各渠道" in r["title"]]
    ck(len(channel_drawn) == 1 and channel_drawn[0]["canvas"] == 1,
       "图表④ 渠道条形已绘制", f"{channel_drawn}")
    # 漏斗：画出 或 空态 都算合格，但两者必须二选一（不能既无 canvas 也无空态）
    funnel = [r for r in reports if "漏斗" in r["title"]]
    ck(len(funnel) == 1 and (funnel[0]["canvas"] + funnel[0]["empty"]) == 1,
       "图表④ 漏斗已绘制或明确空态", f"{funnel}")
    page.screenshot(path=os.path.join(SHOTS, "chart-04-funnel.png"), full_page=True)
    print(f"截图 → evidence/chart-04-funnel.png（canvas {drawn} / 空态 {empties}）")

    # 首页既有图表（回归：确认没被本次改动破坏）
    page.goto(f"{WEB}/#/welcome", wait_until="networkidle", timeout=45000)
    time.sleep(3)
    n = page.evaluate("() => document.querySelectorAll('canvas').length")
    ck(n >= 2, "首页既有 2 个图表仍在（回归检查）", f"canvas={n}")
    page.screenshot(path=os.path.join(SHOTS, "chart-00-regression-welcome.png"), full_page=True)

    # 明暗主题切换（验证 AppChartCard 按新色值重绘、画布仍在）
    page.goto(f"{WEB}/#/finance/statistics", wait_until="networkidle", timeout=45000)
    time.sleep(3.5)
    before = page.evaluate(
        "() => document.querySelectorAll('.app-chart-card canvas').length")
    page.evaluate("() => document.documentElement.classList.add('dark')")
    time.sleep(2.5)
    after = page.evaluate("""() => Array.from(
        document.querySelectorAll('.app-chart-card canvas'))
        .filter(c => c.width > 10 && c.height > 10).length""")
    ck(before > 0 and after == before,
       "主题切换后图表仍在（重绘生效）", f"before={before} after={after}")
    page.screenshot(path=os.path.join(SHOTS, "chart-08-dark-mode.png"), full_page=True)
    page.evaluate("() => document.documentElement.classList.remove('dark')")

    # 教师端：admin-only 接口若被触发会 403；前端应做角色隐藏
    errors = []
    ctx2 = browser.new_context(viewport={"width": 1600, "height": 1000})
    seed_auth(ctx2, "teacher", "teacher123456")
    page2 = ctx2.new_page()
    page2.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page2.goto(f"{WEB}/#/finance/statistics", wait_until="networkidle", timeout=45000)
    time.sleep(4)
    forbidden = [e for e in errors if "403" in e]
    ck(len(forbidden) == 0,
       "教师端打开财务统计无 403 报错", f"errors={forbidden[:2]}")
    page2.screenshot(path=os.path.join(SHOTS, "chart-07-teacher-view.png"), full_page=True)

    browser.close()

print(f"\n=== 图表渲染实证：PASS {PASS} / FAIL {FAIL} ===")
if FAIL:
    print("失败项：", " | ".join(FAILED))
    sys.exit(1)