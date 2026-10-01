# L1 实证：顶栏铃铛接真实公告
#
# 覆盖断言：
#   1. 铃铛存在，红点数字 == 库中「7 天内 + 已发布」公告数
#   2. 点开下拉，条目标题与库中已发布公告一致
#   3. ★ 下架公告**不显示**（列表接口不按 status 过滤，前端必须自行过滤）
#   4. ★ 页面无演示数据残留（"小铭"/"李白"/"开发多租户管理"）
#   5. ★ 页面无第三方外链（xiaoxian521.github.io）
#   6. 无未捕获 JS 错误
#
# 用法：python _verify_test/ui-bell-notice.py [BASE] [API]
import json
import sys
import re
import requests
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18080"
API = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:3000"
TZ = timezone(timedelta(hours=8))

PASS, FAIL = [], []


def ok(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(("[OK]  " if cond else "[FAIL]") + " " + name + (f"  -- {extra}" if extra else ""))
    return cond


def inject_login(page, d):
    """与 ui-site-info.py 一致的注入（Cookie + localStorage，三者缺一不可）"""
    expires_ms = int(
        datetime.strptime(d["expires"], "%Y/%m/%d %H:%M:%S")
        .replace(tzinfo=TZ)
        .timestamp()
        * 1000
    )
    cookie_val = json.dumps({
        "accessToken": d["accessToken"],
        "expires": expires_ms,
        "refreshToken": d["refreshToken"],
    })
    info_val = json.dumps({
        "refreshToken": d["refreshToken"],
        "expires": expires_ms,
        "avatar": d.get("avatar", ""),
        "username": d["username"],
        "nickname": d.get("nickname", ""),
        "roles": d.get("roles", []),
        "permissions": d.get("permissions", []),
    })
    page.goto(f"{BASE}/#/login", wait_until="domcontentloaded")
    page.evaluate(
        """([c, i]) => {
            document.cookie = 'authorized-token=' + encodeURIComponent(c) + '; path=/';
            document.cookie = 'multiple-tabs=true; path=/';
            localStorage.setItem('user-info', i);
        }""",
        [cookie_val, info_val],
    )
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1500)


def within7(s):
    try:
        t = datetime.strptime(s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=TZ)
    except Exception:
        return False
    return datetime.now(TZ) - t <= timedelta(days=7)


# ── 准备：登录 + 算期望值 ────────────────────────────────────────────
lr = requests.post(
    f"{API}/api/auth/login",
    json={"username": "admin", "password": "admin123456"},
    timeout=15,
)
d = lr.json()["data"]
HDR = {"Authorization": f"Bearer {d['accessToken']}"}


def fetch_notices():
    r = requests.get(
        f"{API}/api/notices", params={"page": 1, "pageSize": 50}, headers=HDR, timeout=15
    ).json()
    return r["data"]["list"]


rows = fetch_notices()
published = [r for r in rows if r.get("status") == "发布"]
expect_badge = sum(1 for r in published if within7(r["created_at"]))
expect_titles = [r["title"] for r in published[:20]]
print(f"[info] 库中公告 {len(rows)} 条；已发布 {len(published)} 条；7 天内已发布 {expect_badge} 条")

# 造一条「下架」公告，用于验证前端过滤（结束时删除）
mk = requests.post(
    f"{API}/api/notices",
    json={"title": "__L1_TEST_下架不应显示__", "content": "temporary", "status": "下架"},
    headers=HDR,
    timeout=15,
).json()
temp_id = mk.get("data", {}).get("id")
print(f"[info] 已造临时下架公告 id={temp_id}")

try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))

        inject_login(pg, d)
        pg.goto(f"{BASE}/#/welcome", wait_until="networkidle")
        pg.wait_for_timeout(2500)

        # ① 铃铛存在
        bell = pg.locator(".dropdown-badge")
        ok("铃铛元素存在", bell.count() > 0, f"count={bell.count()}")

        # ② 红点数字
        badge = pg.locator(".dropdown-badge .el-badge__content")
        badge_text = ""
        if badge.count() > 0:
            badge_text = (badge.first.inner_text() or "").strip()
        got = int(badge_text) if badge_text.isdigit() else 0
        ok(
            "红点数字 == 7天内已发布公告数",
            got == expect_badge,
            f"页面={got} 期望={expect_badge}",
        )

        # ③ 点开下拉
        bell.first.click()
        pg.wait_for_timeout(1800)
        menu = pg.locator(".el-dropdown-menu")
        ok("下拉菜单已弹出", menu.count() > 0)

        titles = [
            t.strip()
            for t in pg.locator(".notice-title-content").all_inner_texts()
            if t.strip()
        ]
        print(f"[info] 下拉中显示 {len(titles)} 条：{titles[:3]}{' ...' if len(titles) > 3 else ''}")
        ok("下拉条目数与已发布数量一致", len(titles) == len(expect_titles),
           f"页面={len(titles)} 期望={len(expect_titles)}")
        ok("下拉标题与库中已发布公告一致",
           titles == expect_titles,
           f"首个：页面={titles[0] if titles else None!r} 库={expect_titles[0] if expect_titles else None!r}")
        ok("★ 下架公告未出现在铃铛里",
           "__L1_TEST_下架不应显示__" not in titles)

        # ④ 演示数据残留 & ⑤ 外链
        html = pg.content()
        demo_hits = [w for w in ["小铭", "李白", "开发多租户管理", "2024-06-18", "第三方紧急代码变更"] if w in html]
        ok("★ 页面无演示数据残留", not demo_hits, f"命中={demo_hits}")
        ok("★ 页面无第三方外链", "xiaoxian521.github.io" not in html)

        # ⑥ JS 错误
        ok("无未捕获 JS 错误", not errs, f"{errs[:2]}" if errs else "")

        pg.screenshot(path=r"C:\Users\rui08\Desktop\教学管理系统\evidence\L1-bell-notice.png")
        print("[info] 截图 evidence/L1-bell-notice.png")
        b.close()
finally:
    # 清理临时公告
    if temp_id:
        requests.delete(f"{API}/api/notices/{temp_id}", headers=HDR, timeout=15)
        left = [r for r in fetch_notices() if r["id"] == temp_id]
        print(f"[info] 已清理临时下架公告 id={temp_id}；残留={len(left)}")

print("\n" + "=" * 54)
print(f"  L1 铃铛实证结果：{len(PASS)}/{len(PASS) + len(FAIL)}")
print("=" * 54)
if FAIL:
    for f in FAIL:
        print("  失败：" + f)
sys.exit(1 if FAIL else 0)
