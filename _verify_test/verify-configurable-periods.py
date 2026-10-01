# 节次可配置（v24）自测 —— 在 18080 真实环境跑
#
# 覆盖：
#   ① 节次可增删：GET / POST（加一节）/ PUT（改时间名称）/ DELETE（删一节）
#   ② 删除保护：有课次/排课模板引用时拒绝
#   ③ 排课可排到新增节次（原先被写死 8 挡住）
#   ④ 权限：教师端菜单不再有「排课模板」；「排课模板」仅 admin
#   ⑤ 前端：节次时间页有「增加一节」；排课模板页按**实际节次数**渲染行数
#   ⑥ 回归：周课表/课次详情等读节次的地方不报错
#
# ★ 测试用「第 90 节」这种明显不会被真实数据引用的节次号，脚本末尾清理。
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import requests
from playwright.sync_api import sync_playwright

WEB = os.environ.get("WEB", "http://localhost:18080")
API = os.environ.get("API", "http://localhost:18080")
TZ = timezone(timedelta(hours=8))
TEST_PERIOD = 90  # 远离真实节次，避免撞车

passed = failed = 0


def ok(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print("  ✅ " + name)
    else:
        failed += 1
        print("  ❌ " + name + (("  → " + str(extra)) if extra else ""))


def unwrap(resp, key="data"):
    d = resp.json().get(key)
    if isinstance(d, dict):
        return d.get("list", [])
    return d or []


def login(u, p):
    r = requests.post(f"{API}/api/auth/login", json={"username": u, "password": p}, timeout=15)
    return r.json().get("data")


A = login("admin", "admin123456")
T = login("teacher", "teacher123456")
HA = {"Authorization": f"Bearer {A['accessToken']}", "Content-Type": "application/json"}
HT = {"Authorization": f"Bearer {T['accessToken']}", "Content-Type": "application/json"}

# ═══════════════════════════════════════════════════════════
print("\n═══ ① 节次读取与范围放开 ═══")
r = requests.get(f"{API}/api/period-times", headers=HA, timeout=15)
periods0 = unwrap(r)
ok("GET /period-times 正常", r.status_code == 200 and len(periods0) > 0, f"{len(periods0)} 节")
max0 = max(p["period"] for p in periods0)
print(f"     当前 {len(periods0)} 节，最大第 {max0} 节")

r = requests.post(f"{API}/api/period-times", json={"period": TEST_PERIOD, "start_time": "20:00",
                                                  "end_time": "20:45", "label": f"自测第{TEST_PERIOD}节"},
                  headers=HA, timeout=15)
ok("★ 可新增第 90 节（>8，原先被写死约束挡住）", r.status_code == 200, r.text[:140])
periods1 = unwrap(requests.get(f"{API}/api/period-times", headers=HA, timeout=15))
ok("新增后节次数 +1", len(periods1) == len(periods0) + 1, f"{len(periods0)} → {len(periods1)}")

r = requests.post(f"{API}/api/period-times", json={"period": TEST_PERIOD}, headers=HA, timeout=15)
ok("重复节次号被拒（400）", r.status_code == 400, f"实际 {r.status_code}")

r = requests.post(f"{API}/api/period-times", json={"period": 0}, headers=HA, timeout=15)
ok("第 0 节被拒（保底生效）", r.status_code == 400, f"实际 {r.status_code}")

r = requests.put(f"{API}/api/period-times",
                 json={"items": [{"period": TEST_PERIOD, "start_time": "21:00", "end_time": "21:45",
                                  "label": "改过名的自测节"}]}, headers=HA, timeout=15)
ok("PUT 可改名与时间", r.status_code == 200, r.text[:120])
after = [p for p in unwrap(requests.get(f"{API}/api/period-times", headers=HA, timeout=15)) if p["period"] == TEST_PERIOD]
ok("改名生效", after and after[0]["label"] == "改过名的自测节", after[0]["label"] if after else "未找到")

r = requests.put(f"{API}/api/period-times",
                 json={"items": [{"period": 999, "label": "x"}]}, headers=HA, timeout=15)
ok("PUT 不能静默新增不存在的节次（应 400）", r.status_code == 400, f"实际 {r.status_code}")

# ═══════════════════════════════════════════════════════════
print("\n═══ ③ 排课/加课可落在新增节次上 ═══")
cls = unwrap(requests.get(f"{API}/api/classes?pageSize=50", headers=HA))[0]
crs = unwrap(requests.get(f"{API}/api/courses?pageSize=50", headers=HA))[0]
r = requests.post(f"{API}/api/schedules",
                  json={"class_id": cls["id"], "course_id": crs["id"], "day_of_week": 4,
                        "period": TEST_PERIOD}, headers=HA, timeout=15)
ok("★ 排课模板可排到第 90 节", r.status_code == 200, r.text[:150])
sched_id = r.json().get("data", {}).get("id") if r.status_code == 200 else None

r = requests.post(f"{API}/api/schedules",
                  json={"class_id": cls["id"], "course_id": crs["id"], "day_of_week": 5,
                        "period": 999}, headers=HA, timeout=15)
ok("★ 排到未配置的节次被拒（防悬空课次）", r.status_code == 400, f"实际 {r.status_code}")
ok("★ 拒绝文案指向「节次时间」", "节次时间" in (r.json().get("message") or ""), r.json().get("message"))

# ═══════════════════════════════════════════════════════════
print("\n═══ ② 删除保护 ═══")
r = requests.delete(f"{API}/api/period-times/{TEST_PERIOD}", headers=HA, timeout=15)
ok("★ 被排课模板引用的节次删除被拒（400）", r.status_code == 400, f"实际 {r.status_code}")
ok("★ 提示说明被什么用了", "排课模板" in (r.json().get("message") or ""), r.json().get("message"))

if sched_id:
    requests.delete(f"{API}/api/schedules/{sched_id}", headers=HA, timeout=15)
r = requests.delete(f"{API}/api/period-times/{TEST_PERIOD}", headers=HA, timeout=15)
ok("清掉引用后可删除", r.status_code == 200, r.text[:120])
ok("删除后节次数恢复", len(unwrap(requests.get(f"{API}/api/period-times", headers=HA, timeout=15))) == len(periods0))

# ═══════════════════════════════════════════════════════════
print("\n═══ ④ 权限：排课模板归属 ═══")


def routes_of(token):
    r = requests.get(f"{API}/api/auth/async-routes", headers={"Authorization": f"Bearer {token}"}, timeout=15).json()
    out = []
    def walk(ns):
        for n in ns or []:
            t = n.get("meta", {}).get("title")
            if t:
                out.append((t, n.get("meta", {}).get("roles")))
            walk(n.get("children"))
    walk(r.get("data") if isinstance(r, dict) else r)
    return out


admin_titles = routes_of(A["accessToken"])
teacher_titles = routes_of(T["accessToken"])
at = [t for t, _ in admin_titles]
tt = [t for t, _ in teacher_titles]
ok("admin 能看到「排课模板」", "排课模板" in at)
ok("★ 教师端已无「排课模板」", "排课模板" not in tt, str(tt))
ok("教师端仍有「补课管理」（日常动作保留）", "补课管理" in tt)
roles_of_sched = next((r for t, r in admin_titles if t == "排课模板"), None)
ok("★ 「排课模板」限 admin", roles_of_sched == ["admin"], str(roles_of_sched))
r = requests.get(f"{API}/api/period-times", headers=HT, timeout=15)
ok("教师可读节次（读放开，写才限 admin）", r.status_code == 200, f"实际 {r.status_code}")
r = requests.post(f"{API}/api/period-times", json={"period": 91}, headers=HT, timeout=15)
ok("★ 教师不能改节次（403）", r.status_code == 403, f"实际 {r.status_code}")
requests.delete(f"{API}/api/period-times/91", headers=HA, timeout=15)

# ═══════════════════════════════════════════════════════════
print("\n═══ ⑤ 前端页面（浏览器）═══")
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 1500, "height": 950}).new_page()
    ms = int(datetime.strptime(A["expires"], "%Y/%m/%d %H:%M:%S").replace(tzinfo=TZ).timestamp() * 1000)
    cv = json.dumps({"accessToken": A["accessToken"], "expires": ms, "refreshToken": A["refreshToken"]})
    iv = json.dumps({"refreshToken": A["refreshToken"], "expires": ms, "avatar": A.get("avatar", ""),
                     "username": A["username"], "nickname": A.get("nickname", ""),
                     "roles": A.get("roles", []), "permissions": A.get("permissions", [])})
    pg.goto(f"{WEB}/#/login", wait_until="domcontentloaded")
    pg.evaluate("""([c,i])=>{document.cookie='authorized-token='+encodeURIComponent(c)+'; path=/';
        document.cookie='multiple-tabs=true; path=/';localStorage.setItem('user-info',i);}""", [cv, iv])
    pg.reload(wait_until="networkidle")
    pg.wait_for_timeout(1500)

    # 节次时间页
    pg.goto(f"{WEB}/#/attendance/period-times", wait_until="networkidle")
    pg.wait_for_timeout(2200)
    body = pg.content()
    ok("★ 节次时间页有「增加一节」", "增加一节" in body)
    n_rows = pg.locator("tbody tr").count()
    ok("按实际节数渲染行", n_rows == len(periods0), f"页面 {n_rows} 行 vs 后端 {len(periods0)} 节")
    ok("页面提示共几节", "当前共" in body)
    ok("有「删除」入口", "删除" in body)
    pg.screenshot(path="evidence/v24-period-times.png")

    # 排课模板页按实际节数渲染
    pg.goto(f"{WEB}/#/data/schedules", wait_until="networkidle")
    pg.wait_for_timeout(2200)
    pg.locator(".el-select").first.click()
    pg.wait_for_timeout(700)
    pg.locator(".el-select-dropdown__item").first.click()
    pg.wait_for_timeout(2000)
    sched_rows = pg.locator("tbody tr").count()
    ok("★ 排课模板按实际节数渲染（不再写死 8）", sched_rows == len(periods0),
       f"页面 {sched_rows} 行 vs 后端 {len(periods0)} 节")
    pg.screenshot(path="evidence/v24-schedules-dynamic.png")

    # 周课表仍正常
    pg.goto(f"{WEB}/#/attendance/sessions", wait_until="networkidle")
    pg.wait_for_timeout(2200)
    ok("周课表正常加载（节次读取无报错）", pg.locator(".wg-cell").count() > 0)
    b.close()

print("\n" + "═" * 58)
print(f"自测结果：PASS {passed}  FAIL {failed}")
print("═" * 58)
sys.exit(1 if failed else 0)
