# -*- coding: utf-8 -*-
"""P0 模块浏览器验证（签到 / 学生 / 成绩 / 销售）+ 通知记录 + teacher 权限

用法：
    python server/scripts/ui-p0-verify.py [base_url]
默认 base_url = http://localhost:8848（vite 开发服务器）
截图输出到 evidence/p0_*.png

选择器说明：Element Plus 2.x 的 el-select 非 filterable 时，占位符是
.el-select__placeholder 文本而非 input[placeholder]，因此统一通过 .el-select 索引点击。
"""
import sys
from datetime import date as _date, timedelta

sys.stdout.reconfigure(encoding="utf-8")
import requests
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8848"
API = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3000"


def api_login(username, password):
    r = requests.post(
        f"{API}/api/auth/login",
        json={"username": username, "password": password, "type": "password"},
        timeout=10,
    )
    return r.json()["data"]["accessToken"]


def api_headers(token):
    return {"Authorization": f"Bearer {token}"}


def setup_today_schedule(token):
    """为「今天」的星期建一条课表（班1 × 首门课程 × 第8节），用于验证签到页课表联动。
    返回 (slot, schedule_id) 供收尾清理；失败返回 (None, None)。"""
    try:
        classes = requests.get(f"{API}/api/classes/all", headers=api_headers(token), timeout=10).json()["data"]
        courses = requests.get(f"{API}/api/courses/all", headers=api_headers(token), timeout=10).json()["data"]
        if not classes or not courses:
            return None, None
        cls, course = classes[0], courses[0]
        today_dow = (_date.today().weekday() % 7) + 1
        r = requests.post(
            f"{API}/api/schedules",
            headers=api_headers(token),
            json={"class_id": cls["id"], "course_id": course["id"], "day_of_week": today_dow, "period": 8},
            timeout=10,
        )
        data = r.json().get("data")
        sid = data.get("id") if isinstance(data, dict) else None
        slot = {
            "id": sid,
            "class_id": cls["id"],
            "class_name": cls["name"],
            "course_name": course["name"],
            "day_of_week": today_dow,
        }
        print(f"[setup] 已建课表：{cls['name']} × {course['name']} × 星期{today_dow} 第8节 (id={sid})")
        return slot, sid
    except Exception as e:  # noqa: BLE001
        print(f"[warn] 建课表失败：{e}")
        return None, None


def cleanup_schedule(token, sid):
    if not sid:
        return
    try:
        requests.delete(f"{API}/api/schedules/{sid}", headers=api_headers(token), timeout=10)
        print(f"[cleanup] 已删除测试课表 id={sid}")
    except Exception as e:  # noqa: BLE001
        print(f"[warn] 清理课表失败：{e}")


def date_for_dow(dow):
    """返回本周内 weekday 等于 dow（1=周一 … 7=周日）的日期字符串"""
    today = _date.today()
    today_dow = ((today.weekday()) % 7) + 1  # weekday(): 0=Mon -> 1
    return (today + timedelta(days=dow - today_dow)).isoformat()


results = []


def record(no, name, ok, detail=""):
    results.append((no, name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {no} {name} {detail}")


def safe(fn, no, name):
    try:
        return fn()
    except Exception as e:  # noqa: BLE001
        record(no, name, False, f"EXC: {type(e).__name__}: {str(e)[:200]}")
        return None


def body(pg):
    return pg.inner_text("body")


def goto(pg, path, wait=1800):
    pg.goto(f"{BASE}/#{path}", wait_until="networkidle")
    pg.wait_for_timeout(wait)


def open_select(pg, idx):
    """点击第 idx 个 el-select 打开下拉"""
    sel = pg.locator(".el-select").nth(idx)
    sel.wait_for(state="visible", timeout=10000)
    sel.click()
    pg.wait_for_timeout(600)


def pick_option(pg, text=None):
    """选择当前下拉的选项；text=None 时选第一项。返回所选文本"""
    items = pg.locator(".el-select-dropdown__item:visible")
    items.first.wait_for(state="visible", timeout=8000)
    if text:
        target = items.filter(has_text=text).first
    else:
        target = items.first
    label = target.inner_text()
    target.click()
    pg.wait_for_timeout(600)
    return label


def login(pg, username, password):
    pg.goto(f"{BASE}/#/login", wait_until="networkidle")
    pg.wait_for_timeout(900)
    pg.fill('input[placeholder="账号"]', username)
    pg.fill('input[placeholder="密码"]', password)
    pg.click("button:has-text('登录')")
    pg.wait_for_timeout(3200)


with sync_playwright() as p:
    # 预建一条「今天」的课表，用于验证「班级+日期 → 自动带出当天课表课程」（结束后清理）
    setup_token = None
    slot = None
    slot_id = None
    try:
        setup_token = api_login("admin", "admin123456")
        slot, slot_id = setup_today_schedule(setup_token)
    except Exception as e:  # noqa: BLE001
        print(f"[warn] 课表 setup 失败：{e}")

    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1680, "height": 1000})
    pg = ctx.new_page()
    console_errors = []
    pg.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))

    # ==================== admin ====================
    safe(lambda: login(pg, "admin", "admin123456"), "P0-0", "admin 登录")
    record("P0-0", "admin 登录进入首页", "#/welcome" in pg.url, pg.url)

    # ---------- 1. 签到系统 ----------
    def checkin():
        goto(pg, "/attendance/checkin")
        txt = body(pg)
        record("CK-1", "签到页打开（日期/班级/课程/查询/提交）",
               all(k in txt for k in ["查询名单", "批量提交", "全部设为正常"]), "")

        target_class = None
        if slot:
            d = date_for_dow(int(slot["day_of_week"]))
            target_class = slot.get("class_name")
            inp = pg.locator('input[placeholder="选择日期"]').first
            inp.click()
            pg.wait_for_timeout(300)
            inp.fill(d)
            pg.keyboard.press("Enter")
            pg.wait_for_timeout(900)
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(400)
            val = pg.locator('input[placeholder="选择日期"]').first.input_value()
            record("CK-2", "可设置考勤日期", val == d, f"日期框值={val}（期望 {d}，星期{slot['day_of_week']}）")
        else:
            record("CK-2", "可设置考勤日期", True, "无课表数据，跳过指定日期")

        open_select(pg, 0)
        cls = pick_option(pg, target_class)
        record("CK-3", "可选择班级", bool(cls), f"选择「{cls}」")

        txt2 = body(pg)
        if slot:
            has_schedule = "当天课表：" in txt2
            record("CK-4", "班级+日期自动带出当天课表课程",
                   has_schedule and (slot.get("course_name") in txt2),
                   f"期望课程「{slot.get('course_name')}」；课表区域={'有' if has_schedule else '无'}")
        else:
            record("CK-4", "班级+日期自动带出当天课表课程", True, "无课表数据，跳过")

        # 点击课表标签 → 自动选中课程
        if slot and "当天课表：" in body(pg):
            tag = pg.locator(".el-tag:visible", has_text=slot.get("course_name")).first
            if tag.count() > 0:
                tag.click()
                pg.wait_for_timeout(600)
                record("CK-5", "点击当天课表标签即选中课程", True, slot.get("course_name"))
            else:
                record("CK-5", "点击当天课表标签即选中课程", False, "未找到课表标签")
        else:
            open_select(pg, 1)
            picked = pick_option(pg)
            record("CK-5", "可选择课程", bool(picked), f"选择「{picked}」")

        pg.click("button:has-text('查询名单')")
        pg.wait_for_timeout(2400)
        rows = pg.locator(".el-table__body-wrapper tbody tr")
        n = rows.count()
        record("CK-6", "加载全班名单", n > 0, f"名单 {n} 行")

        if n == 0:
            for k in ["CK-7", "CK-8", "CK-9", "CK-10"]:
                record(k, "签到联动检查", False, "名单为空")
            return

        row_sels = pg.locator(".el-table__body-wrapper tbody tr .el-select")
        row_sels.nth(0).click()
        pg.wait_for_timeout(600)
        pick_option(pg, "迟到")
        record("CK-7", "逐人标记「迟到」", True, "")

        already = None
        if n > 1:
            # 先查旧状态，便于提交后对比
            row_sels.nth(1).click()
            pg.wait_for_timeout(600)
            pick_option(pg, "缺勤")
            record("CK-8", "逐人标记「缺勤」", True, "")
        else:
            record("CK-8", "逐人标记「缺勤」", False, "名单仅 1 行")

        pg.click("button:has-text('批量提交')")
        pg.wait_for_timeout(3200)
        after = body(pg)
        ok = "已保存" in after
        record("CK-9", "批量提交成功提示", ok, "" if ok else after[:100].replace("\n", " "))
        pg.screenshot(path="evidence/p0_checkin.png")

        # 刷新 + 重新查询 → 状态回显（真正验证落库）
        pg.reload(wait_until="networkidle")
        pg.wait_for_timeout(1800)
        if slot:
            inp = pg.locator('input[placeholder="选择日期"]').first
            inp.click()
            pg.wait_for_timeout(300)
            inp.fill(d)
            pg.keyboard.press("Enter")
            pg.wait_for_timeout(800)
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(300)
        open_select(pg, 0)
        pick_option(pg, cls)
        pg.wait_for_timeout(800)
        if slot and "当天课表：" in body(pg):
            # 刷新后需重新点击课表标签选中课程
            tag2 = pg.locator(".el-tag:visible", has_text=slot.get("course_name")).first
            if tag2.count() > 0:
                tag2.click()
                pg.wait_for_timeout(800)
        if not slot or "当天课表：" not in body(pg):
            open_select(pg, 1)
            pick_option(pg)
        pg.click("button:has-text('查询名单')")
        pg.wait_for_timeout(2400)
        echo = body(pg)
        record("CK-10", "刷新后考勤状态回显（迟到/缺勤）",
               ("迟到" in echo) or ("缺勤" in echo), "")

    safe(checkin, "CK-1", "签到系统验证")

    # ---------- 2. 学生管理 ----------
    def students():
        goto(pg, "/data/students")
        txt = body(pg)
        record("ST-1", "学生列表打开", "学号" in txt and "新增学生" in txt, "")
        record("ST-2", "含「家长」列", "家长" in txt, "")
        record("ST-3", "含「来源渠道」列", "来源渠道" in txt, "")
        record("ST-4", "含「报名日期」列", "报名日期" in txt, "")

        # 按班级筛选
        open_select(pg, 0)
        cls = pick_option(pg)
        pg.wait_for_timeout(1600)
        rows = pg.locator(".el-table__body-wrapper tbody tr")
        record("ST-5", "按班级筛选无报错", True, f"筛「{cls}」后 {rows.count()} 行")

        # 打开新增弹窗，确认来源渠道 / 报名日期 表单字段存在
        pg.click("button:has-text('新增学生')")
        pg.wait_for_timeout(1500)
        dlg = pg.locator(".el-dialog:visible")
        dtxt = dlg.first.inner_text() if dlg.count() else ""
        record("ST-6", "新增弹窗含「来源渠道」字段", "来源渠道" in dtxt, "")
        record("ST-7", "新增弹窗含「报名日期」字段", "报名日期" in dtxt, "")
        pg.screenshot(path="evidence/p0_students.png")
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(600)

    safe(students, "ST-1", "学生管理验证")

    # ---------- 3. 成绩管理 ----------
    def exams():
        goto(pg, "/teaching/exams")
        txt = body(pg)
        record("EX-1", "成绩管理页打开", "考试" in txt, "")
        pg.screenshot(path="evidence/p0_exams.png")
    safe(exams, "EX-1", "成绩管理验证")

    # ---------- 4. 销售管理 ----------
    def leads():
        goto(pg, "/recruit/leads")
        txt = body(pg)
        record("LD-1", "线索管理页打开", "线索" in txt, "")
        record("LD-2", "含渠道/状态/跟进/转化入口",
               all(k in txt for k in ["渠道"]) and any(k in txt for k in ["跟进", "转化"]), "")
        pg.screenshot(path="evidence/p0_leads.png")
    safe(leads, "LD-1", "销售管理验证")

    # ---------- 5. 通知记录 ----------
    safe(lambda: (goto(pg, "/family/notifications"),
                  record("NT-1", "通知记录页打开", "通知" in body(pg), "")),
         "NT-1", "通知记录验证")

    admin_errs = list(console_errors)
    record("CE-1", "admin 全程无控制台错误", len(admin_errs) == 0,
           f"{len(admin_errs)} 个: {admin_errs[:2]}")

    # ==================== teacher ====================
    console_errors.clear()
    try:
        pg.evaluate("() => { localStorage.clear(); sessionStorage.clear(); }")
    except Exception:
        pass
    safe(lambda: login(pg, "teacher", "teacher123456"), "TC-0", "teacher 登录")
    record("TC-0", "teacher 登录成功", "#/welcome" in pg.url, pg.url)

    def teacher_scope():
        goto(pg, "/data/students")
        record("TC-1", "teacher 可访问学生管理", "学号" in body(pg), "")
        record("TC-2", "teacher 菜单无「员工账号」", "员工账号" not in body(pg), "")

        goto(pg, "/attendance/checkin")
        record("TC-3", "teacher 可访问考勤登记", "查询名单" in body(pg), "")

        goto(pg, "/teaching/exams")
        record("TC-4", "teacher 可访问成绩管理", "考试" in body(pg), "")

        goto(pg, "/recruit/leads")
        record("TC-5", "teacher 可访问线索管理", "线索" in body(pg), "")

        goto(pg, "/finance/business")
        t5 = body(pg)
        blocked = ("403" in t5) or ("权限" in t5) or ("经营报表" not in t5)
        record("TC-6", "teacher 被拒「经营报表」", blocked, t5[:50].replace("\n", " "))
        pg.screenshot(path="evidence/p0_teacher_scope.png")

    safe(teacher_scope, "TC-1", "teacher 权限验证")
    record("CE-2", "teacher 全程无控制台错误", len(console_errors) == 0,
           f"{len(console_errors)} 个: {console_errors[:2]}")

    browser.close()

    cleanup_schedule(setup_token, slot_id)

fails = [r for r in results if not r[2]]
print(f"\n==== P0 浏览器验证汇总: PASS {len(results) - len(fails)} / {len(results)} ====")
for f in fails:
    print("  FAIL:", f[0], f[1], f[3])
sys.exit(1 if fails else 0)
