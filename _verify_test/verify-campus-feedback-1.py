# 校区反馈 ①②③ 的自测（沙箱 8848 + 本机后端 3000，不需要 Docker）
#
# 覆盖：
#   ① 菜单：学期管理从「学员管理」搬到「排课与课表」
#   ② 周课表格子「＋」新增课次（弹窗打开 + 日期/节次自动带入）
#   ③ 周课表「全校视角」（仅 admin；不标冲突；卡片显示班级名）
#   ⑥ 权限：teacher 看不到「全校视角」，且 API view=all 返回 403
#
# ★ 本脚本**不提交任何写操作**（不点"确认添加"），避免往真实库里塞测试课次
#   —— 课次目前没有删除接口，加错了删不掉（见 09-26 审计）。
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import requests
from playwright.sync_api import sync_playwright

WEB = os.environ.get("WEB", "http://127.0.0.1:8848")
API = os.environ.get("API", "http://127.0.0.1:3000")
TZ = timezone(timedelta(hours=8))

passed = failed = 0


def ok(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print("  ✅ " + name)
    else:
        failed += 1
        print("  ❌ " + name + (("  → " + str(extra)) if extra else ""))


def login(u, p):
    r = requests.post(f"{API}/api/auth/login", json={"username": u, "password": p}, timeout=15)
    return r.json().get("data")


def inject(page, d):
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
    page.wait_for_timeout(1500)


admin = login("admin", "admin123456")
teacher = login("teacher", "teacher123456")
print(f"admin token={'ok' if admin else 'FAIL'}  teacher token={'ok' if teacher else 'FAIL'}")

# ═══════════════════════════════════════════════════════════
print("\n═══ ① 菜单：学期管理的归属（接口层）═══")
r = requests.get(f"{API}/api/auth/async-routes",
                 headers={"Authorization": f"Bearer {admin['accessToken']}"}, timeout=15).json()
routes = r.get("data") if isinstance(r, dict) else r


def find_group(nodes, title):
    for n in nodes or []:
        if n.get("meta", {}).get("title") == title:
            return n
        found = find_group(n.get("children"), title)
        if found:
            return found
    return None


def child_titles(group):
    return [c.get("meta", {}).get("title") for c in (group or {}).get("children", [])]


sched_group = find_group(routes, "排课与课表")
stu_group = find_group(routes, "学员管理")
print(f"     「排课与课表」子项：{child_titles(sched_group)}")
print(f"     「学员管理」子项：{child_titles(stu_group)}")
ok("学期管理已移入「排课与课表」", "学期管理" in child_titles(sched_group))
ok("「学员管理」下已无学期管理", "学期管理" not in child_titles(stu_group))
st = child_titles(sched_group)
if "学期管理" in st and "节次时间" in st:
    ok("位置在「节次时间」之前", st.index("学期管理") < st.index("节次时间"), f"实际顺序 {st}")

print("\n═══ ⑥ 权限：teacher 不能看全校视角（接口层）═══")
r403 = requests.get(f"{API}/api/sessions/week?view=all&week_start=2026-09-28",
                    headers={"Authorization": f"Bearer {teacher['accessToken']}"}, timeout=15)
ok("teacher 调 view=all 被拒（403）", r403.status_code == 403, f"实际 {r403.status_code}")
r200 = requests.get(f"{API}/api/sessions/week?view=all&week_start=2026-09-28",
                    headers={"Authorization": f"Bearer {admin['accessToken']}"}, timeout=15)
ok("admin 调 view=all 正常（200）", r200.status_code == 200, f"实际 {r200.status_code}")
if r200.status_code == 200:
    week = r200.json()["data"]
    classes = {s.get("class_name") for s in week.get("sessions", [])}
    n_all = len(week.get("sessions", []))
    print(f"     全校视角返回课次 {n_all} 节，涉及班级 {len(classes)} 个：{sorted(classes)}")
    ok("全校视角返回课次", n_all > 0, f"{n_all} 节")
    ok("课次带 class_name（卡片可显示班级）", all(s.get("class_name") for s in week.get("sessions", [])))
    # 跨班验证用「对比法」：全校视角必须 ≥ 单个班级视角（库里本周可能只有一个班有课）
    any_cls = next(iter(classes), None)
    one_cls_id = next((s.get("class_id") for s in week.get("sessions", []) if s.get("class_name") == any_cls), None)
    if one_cls_id:
        r1 = requests.get(f"{API}/api/sessions/week?view=class&class_id={one_cls_id}&week_start=2026-09-28",
                          headers={"Authorization": f"Bearer {admin['accessToken']}"}, timeout=15)
        n_one = len(r1.json()["data"].get("sessions", [])) if r1.status_code == 200 else -1
        print(f"     对比：单个班级视角 {n_one} 节 vs 全校视角 {n_all} 节")
        ok("★ 全校视角不按班级过滤（≥ 单班视角）", n_all >= n_one >= 0 and n_all > 0, f"{n_all} vs {n_one}")

# ═══════════════════════════════════════════════════════════
print("\n═══ ②③ 周课表页面（浏览器）═══")
with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    inject(page, admin)
    page.goto(f"{WEB}/#/attendance/sessions", wait_until="networkidle")
    page.wait_for_timeout(2500)

    # ③ 全校视角入口
    radios = page.locator(".el-radio-button")
    texts = [radios.nth(i).inner_text().strip() for i in range(radios.count())]
    print(f"     视角切换按钮：{texts}")
    ok("admin 能看到「全校视角」", any("全校视角" in t for t in texts), str(texts))

    # 切到全校视角
    page.get_by_text("全校视角", exact=False).first.click()
    page.wait_for_timeout(2500)
    cells = page.locator(".sc")
    n_cards = cells.count()
    n_conflict = page.locator(".sc--conflict").count()
    n_class = page.locator(".sc__class").count()
    print(f"     全校视角：卡片 {n_cards} 张，冲突标记 {n_conflict} 个，班级名 {n_class} 处")
    ok("全校视角有课次卡片", n_cards > 0, f"{n_cards} 张")
    ok("★ 全校视角不标注冲突（同格多课是常态）", n_conflict == 0, f"仍有 {n_conflict} 个冲突标记")
    ok("★ 卡片显示班级名", n_class > 0, f"{n_class} 处")

    # ② 格子「＋」
    cell = page.locator(".wg-cell").first
    add_btn = page.locator(".wg-cell__add").first
    hidden_before = not add_btn.is_visible()
    ok("「＋」默认隐藏（不干扰阅读）", hidden_before)
    cell.hover()
    page.wait_for_timeout(400)
    ok("★ 悬停格子后「＋」出现", add_btn.is_visible())

    add_btn.click()
    page.wait_for_timeout(1200)
    dlg = page.locator(".el-dialog").filter(has_text="新增课次")
    ok("★ 弹出「新增课次」弹窗", dlg.count() > 0 and dlg.first.is_visible())
    # 日期 / 节次是否带入（★ 用 .el-date-editor 精确定位：弹窗里第一个 input 是班级下拉的）
    date_input = dlg.locator(".el-date-editor input").first.input_value()
    print(f"     弹窗带入的日期 = 「{date_input}」")
    ok("★ 日期已自动带入（非空）", bool(date_input and date_input.strip()), f"实际「{date_input}」")
    period_txt = dlg.locator(".el-select__wrapper").nth(2).inner_text().strip()
    print(f"     节次显示 = {period_txt}")
    ok("★ 节次已自动带入（非空/非占位符）", bool(period_txt) and "请选择" not in period_txt, period_txt)
    page.screenshot(path="evidence/selftest-add-dialog.png")
    page.keyboard.press("Escape")
    page.wait_for_timeout(600)

    # teacher 看不到全校视角
    ctx2 = browser.new_context(viewport={"width": 1440, "height": 900})
    page2 = ctx2.new_page()
    inject(page2, teacher)
    page2.goto(f"{WEB}/#/attendance/sessions", wait_until="networkidle")
    page2.wait_for_timeout(2500)
    radios2 = page2.locator(".el-radio-button")
    texts2 = [radios2.nth(i).inner_text().strip() for i in range(radios2.count())]
    print(f"     teacher 视角按钮：{texts2}")
    ok("★ teacher 看不到「全校视角」", not any("全校视角" in t for t in texts2), str(texts2))
    ok("★ teacher 看不到格子「＋」", page2.locator(".wg-cell__add").count() == 0,
       f"{page2.locator('.wg-cell__add').count()} 个")
    browser.close()

print("\n" + "═" * 58)
print(f"自测结果：PASS {passed}  FAIL {failed}")
print("═" * 58)
sys.exit(1 if failed else 0)
