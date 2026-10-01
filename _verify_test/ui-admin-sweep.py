"""教务系统全页面巡检 —— 以管理员身份真实走遍每个菜单页。

关注「使用逻辑不顺畅 / 数据不通 / 关联做不好」：
  ① 页面是否打得开（不是 404/白屏/组件崩溃）
  ② 主要区块是否为空（空数据 vs 真空状态）
  ③ 控制台是否有报错（Vue warn / 接口失败）
  ④ 页面里的关键动作按钮是否存在（能不能完成任务）

用法：python ui-admin-sweep.py [WEB] [API]
"""
import sys, json, time, urllib.request
from playwright.sync_api import sync_playwright

WEB = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:18080"
API = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:3000"

PAGES = [
    ("/welcome",                "首页"),
    ("/attendance/checkin",     "考勤登记"),
    ("/attendance/records",     "考勤记录"),
    ("/attendance/leaves",      "请假管理"),
    ("/attendance/statistics",  "统计报表"),
    ("/recruit/leads",          "线索管理"),
    ("/family/notifications",   "通知记录"),
    ("/teaching/exams",         "成绩管理"),
    ("/teaching/reports",       "学习报告"),
    ("/teaching/growth",        "成长档案"),
    ("/finance/orders",         "报班管理"),
    ("/finance/payments",       "缴费记录"),
    ("/finance/refunds",        "退费管理"),
    ("/finance/statistics",     "财务统计"),
    ("/finance/business",       "经营报表"),
    ("/finance/consumption",    "课消统计"),
    ("/data/classes",           "班级管理"),
    ("/data/students",          "学生管理"),
    ("/data/courses",           "课程管理"),
    ("/data/schedules",         "课程表"),
    ("/data/terms",             "学期管理"),
    ("/data/adjustments",       "调课审批"),
    ("/data/makeups",           "补课管理"),
    ("/system/settings",        "系统参数"),
    ("/system/notices",         "通知公告"),
    ("/system/backups",         "数据备份"),
    ("/system/audit-logs",      "审计日志"),
    ("/user",                   "员工账号"),
]

# 登录
req = urllib.request.Request(
    f"{API}/api/auth/login",
    data=json.dumps({"username": "admin", "password": "admin123456"}).encode(),
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(req) as r:
    login = json.loads(r.read())
d = login["data"]
expires_ms = int((time.time() + 7 * 24 * 3600) * 1000)
cookie_payload = json.dumps(
    {"accessToken": d["accessToken"], "refreshToken": d["refreshToken"], "expires": expires_ms},
    separators=(",", ":"),
)
user_info = json.dumps(
    {"refreshToken": d["refreshToken"], "expires": expires_ms, "avatar": d.get("avatar", ""),
     "username": d["username"], "nickname": d.get("nickname", ""),
     "roles": d["roles"], "permissions": d.get("permissions", [])},
    separators=(",", ":"), ensure_ascii=False,
)

rows = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1500, "height": 950})
    page = ctx.new_page()

    console_errors = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    failed_reqs = []
    page.on("requestfailed", lambda r: failed_reqs.append(f"{r.method} {r.url}"))
    api_bad = []
    def on_resp(resp):
        if "/api/" in resp.url and resp.status >= 400:
            api_bad.append(f"{resp.status} {resp.url.split('/api/')[1].split('?')[0]}")
    page.on("response", on_resp)

    page.goto(WEB, wait_until="domcontentloaded")
    page.evaluate(
        """([tok, ui]) => {
          const maxAge = 7*24*3600;
          document.cookie = 'authorized-token=' + encodeURIComponent(tok) + '; path=/; max-age=' + maxAge;
          document.cookie = 'multiple-tabs=true; path=/; max-age=' + maxAge;
          localStorage.setItem('user-info', ui);
        }""",
        [cookie_payload, user_info],
    )

    for path, name in PAGES:
        console_errors.clear(); failed_reqs.clear(); api_bad.clear()
        url = f"{WEB}/#{path}"
        row = {"name": name, "path": path, "url": url}
        try:
            page.goto(url, wait_until="networkidle", timeout=25000)
            page.wait_for_timeout(1600)

            body = page.inner_text("body")
            row["body_len"] = len(body.strip())
            row["title"] = (page.locator(".app-page__title, .page-title, h1, h2").first.inner_text()
                            if page.locator(".app-page__title, .page-title, h1, h2").count() else "")

            # 崩溃/错误页特征
            row["is_404"] = ("404" in body[:300]) or ("页面不存在" in body)
            row["vue_error"] = "组件渲染出错" in body or "Cannot read" in body

            # 空状态
            row["empty_hint"] = ("暂无" in body) or ("没有" in body) or ("空" in body[:2000])

            # 表格行数（有数据的页面应该有行）
            row["rows"] = page.locator(".el-table__body tbody tr").count()
            row["cards"] = page.locator(".el-card, .page-card").count()
            row["buttons"] = page.locator("button").count()
            row["inputs"] = page.locator("input.el-input__inner").count()

            row["console"] = list(dict.fromkeys(console_errors))[:4]
            row["api_bad"] = list(dict.fromkeys(api_bad))[:6]
            row["failed"] = [u.split("/api/")[-1] for u in failed_reqs][:4]

            row["ok"] = (not row["is_404"]) and (not row["vue_error"]) and row["body_len"] > 80
        except Exception as e:
            row["ok"] = False
            row["exc"] = str(e)[:160]
        rows.append(row)
        flag = "OK " if row.get("ok") else "!! "
        print(f"{flag}{name:8s} {path:24s} rows={row.get('rows','?'):>3} "
              f"btn={row.get('buttons','?'):>3} api_bad={row.get('api_bad')}")
        page.screenshot(path=f"evidence/admin-sweep/{path.strip('/').replace('/', '-') or 'root'}.png",
                        full_page=False)

    browser.close()

# ── 汇总 ──
print("\n" + "=" * 78)
bad_pages = [r for r in rows if not r.get("ok")]
print(f"页面巡检：{len(rows) - len(bad_pages)} / {len(rows)} 正常打开")
if bad_pages:
    print("\n【打不开 / 崩溃的页面】")
    for r in bad_pages:
        print(f"  · {r['name']} {r['path']}  {r.get('exc','')} {r.get('title','')}")

print("\n【各页接口报错】")
any_api = False
for r in rows:
    if r.get("api_bad"):
        any_api = True
        print(f"  · {r['name']:10s} {r['api_bad']}")
if not any_api:
    print("  （无）")

print("\n【各页控制台错误】")
any_c = False
for r in rows:
    if r.get("console"):
        any_c = True
        print(f"  · {r['name']:10s} {r['console']}")
if not any_c:
    print("  （无）")
