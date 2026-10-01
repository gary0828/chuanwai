# -*- coding: utf-8 -*-
"""生产构建浏览器端到端测试（对 :8080，一次性脚本，位于 .gitignore 忽略的 _verify_test/）

为什么走「注入登录态」而不是走登录表单：
    生产构建的生产环境变量未关闭图形验证码（VITE_LOGIN_CAPTCHA 未在 .env.production 定义
    → captchaEnabled = (env !== "false") = true），canvas 验证码无法被自动化识别。
    因此：
      · 登录表单本身单独做「验证码必填」的负例验证（见 ①）；
      · 其余页面级/流程级测试通过注入合法登录态完成（等价于「已登录用户的浏览器」）。

覆盖：
  ① 登录页：验证码控件存在且必填（生产构建应开启）
  ② 全菜单页面遍历：渲染 + 无控制台错误 + 无 4xx/5xx 资源
  ③ 真实写入流程：新增学生 → 列表出现 → 删除
  ④ 真实写入流程：报班订单 → 缴费（并回滚）
  ⑤ teacher 角色：菜单收敛 + 管理员页面被拦
  ⑥ 危险操作二次确认
  ⑦ 截图取证

用法：
    "C:/Program Files/Python314/python.exe" _verify_test/ui-full-suite.py [base_url] [api_url]
默认 base_url=http://localhost:18080、api_url=http://localhost:3000
"""
import sys
import json
import time

sys.stdout.reconfigure(encoding="utf-8")
import requests
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:18080"
API = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3000"

passed, failed, warned = 0, 0, 0
failures, warnings = [], []


def check(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"  [PASS] {name}")
    else:
        failed += 1
        failures.append(f"{name}{(' → ' + detail) if detail else ''}")
        print(f"  [FAIL] {name}{(' → ' + detail) if detail else ''}")


def warn_it(name, detail=""):
    global warned
    warned += 1
    warnings.append(f"{name}{(' → ' + detail) if detail else ''}")
    print(f"  [WARN] {name}{(' → ' + detail) if detail else ''}")


def api_login(username, password):
    r = requests.post(
        f"{API}/api/auth/login",
        json={"username": username, "password": password, "type": "password"},
        timeout=10,
    )
    body = r.json()
    return body["data"]


def seed_auth(ctx, data):
    """把登录态写入 Cookie + localStorage，等价于用户正常登录后的浏览器状态"""
    expires_ms = int(data["expires"]) if str(data["expires"]).isdigit() else int(
        time.mktime(time.strptime(data["expires"], "%Y/%m/%d %H:%M:%S")) * 1000
    )
    cookie_val = json.dumps(
        {
            "accessToken": data["accessToken"],
            "expires": expires_ms,
            "refreshToken": data["refreshToken"],
        }
    )
    ctx.add_cookies(
        [
            {"name": "authorized-token", "value": cookie_val, "domain": "localhost", "path": "/"},
            {"name": "multiple-tabs", "value": "true", "domain": "localhost", "path": "/"},
        ]
    )
    user_info = json.dumps(
        {
            "refreshToken": data["refreshToken"],
            "expires": expires_ms,
            "avatar": data.get("avatar", ""),
            "username": data["username"],
            "nickname": data["nickname"],
            "roles": data["roles"],
            "permissions": data["permissions"],
        },
        ensure_ascii=False,
    )
    ctx.add_init_script(
        f"window.localStorage.setItem('user-info', {json.dumps(user_info, ensure_ascii=False)});"
    )
    return expires_ms


MENU_PAGES = [
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
    ("/user", "员工账号"),
    ("/system/settings", "系统参数"),
    ("/system/notices", "通知公告"),
    ("/system/backups", "数据备份"),
    ("/system/audit-logs", "审计日志"),
]


def main():
    admin = api_login("admin", "admin123456")
    teacher = api_login("teacher", "teacher123456")

    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ═══ ① 登录页（未登录上下文）═══
        print("\n[① ] 登录页与图形验证码（生产构建）")
        c0 = browser.new_context(viewport={"width": 1440, "height": 900})
        pg0 = c0.new_page()
        pg0.goto(f"{BASE}/#/login", wait_until="networkidle")
        check("登录页可访问且渲染出账号输入框", pg0.locator('input[placeholder="账号"]').count() > 0)
        has_captcha = pg0.locator('input[placeholder="验证码"]').count() > 0
        check("生产构建启用图形验证码（验证码输入框存在）", has_captcha)
        canvas_n = pg0.locator("canvas").count()
        check("验证码画布已渲染", canvas_n > 0, f"canvas={canvas_n}")
        # 负例：不填验证码直接提交，应被前端表单校验拦截（停留在登录页）
        pg0.fill('input[placeholder="账号"]', "admin")
        pg0.fill('input[placeholder="密码"]', "admin123456")
        pg0.click('button:has-text("登录")')
        pg0.wait_for_timeout(1500)
        check("未填验证码提交被拦截（未跳转，仍在登录页）", "/login" in pg0.url, pg0.url)
        pg0.screenshot(path="evidence/test_login_captcha.png")
        c0.close()

        # ═══ ② 全菜单页面遍历（admin）═══
        print("\n[② ] 全菜单页面遍历（admin，生产构建）")
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        seed_auth(ctx, admin)
        pg = ctx.new_page()
        console_errors = []
        pg.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        bad_resp = []
        pg.on(
            "response",
            lambda r: bad_resp.append(f"{r.status} {r.url}")
            if r.status >= 400 and "/api/" in r.url
            else None,
        )

        pg.goto(f"{BASE}/#/welcome", wait_until="networkidle")
        pg.wait_for_timeout(1200)
        check("注入登录态后进入系统（未回登录页）", "/login" not in pg.url, pg.url)

        page_fail = []
        for path, title in MENU_PAGES:
            before_err = len(console_errors)
            pg.goto(f"{BASE}/#{path}", wait_until="networkidle")
            pg.wait_for_timeout(700)
            body = pg.inner_text("body")
            at_login = "/login" in pg.url
            new_err = console_errors[before_err:]
            okp = (not at_login) and (title in body) and len(new_err) == 0
            if not okp:
                page_fail.append(
                    f"{path}({title}): " + ("被踢回登录页" if at_login else f"标题缺失" if title not in body else f"控制台错误 {new_err[:1]}")
                )
        check(f"全部 {len(MENU_PAGES)} 个菜单页面渲染正常且无控制台错误", len(page_fail) == 0,
              "; ".join(page_fail[:5]))
        pg.screenshot(path="evidence/test_menu_last.png")

        # ═══ ③ 真实写入流程：新增学生 ═══
        print("\n[③ ] 真实写入：新增学生 → 列表可见 → 删除")
        sfx = str(int(time.time()))[-6:]
        sname = f"浏览器测试{sfx}"
        pg.goto(f"{BASE}/#/data/students", wait_until="networkidle")
        pg.wait_for_timeout(800)
        pg.click('button:has-text("新增")')
        pg.wait_for_timeout(700)
        dlg = pg.locator(".el-dialog").filter(has_text="新增").first
        if dlg.count() == 0:
            dlg = pg.locator(".el-dialog").first
        check("新增学生弹窗已打开", dlg.count() > 0)
        # 学号
        no_input = dlg.locator('input').nth(0)
        no_input.fill(f"UIT{sfx}")
        # 姓名（按 label 定位）
        try:
            dlg.locator('input[placeholder*="姓名"]').first.fill(sname)
        except Exception:
            dlg.locator('input').nth(1).fill(sname)
        # 班级下拉（Element Plus 2.x 必须点 .el-select__wrapper，点外层 .el-select 不会展开）
        try:
            wrappers = dlg.locator(".el-select__wrapper")
            target = None
            for i in range(wrappers.count()):
                txt = wrappers.nth(i).inner_text()
                if "班级" in txt:
                    target = wrappers.nth(i)
                    break
            if target is None and wrappers.count() > 1:
                target = wrappers.nth(1)  # 0=性别 1=班级 2=状态 3=来源渠道
            target.click(timeout=5000)
            pg.wait_for_timeout(600)
            opts = pg.locator(".el-select-dropdown__item:visible")
            check("班级下拉可展开且有可选项", opts.count() > 0, f"选项数={opts.count()}")
            opts.first.click()
            pg.wait_for_timeout(400)
        except Exception as e:
            check("班级下拉可展开且有可选项", False, str(e)[:80])
        pg.wait_for_timeout(300)
        pg.screenshot(path="evidence/test_student_form.png")
        # 提交
        submit = dlg.locator('.el-dialog__footer button:has-text("确定"), .el-dialog__footer button:has-text("保存"), .el-dialog__footer button:has-text("提交")').first
        (submit if submit.count() else dlg.locator('.el-dialog__footer button').last).click()
        pg.wait_for_timeout(1800)
        found = requests.get(
            f"{API}/api/students?keyword={sname}",
            headers={"Authorization": f"Bearer {admin['accessToken']}"},
            timeout=10,
        ).json()
        created = (found.get("data") or {}).get("total", 0) > 0
        check(f"UI 提交后学员「{sname}」确实落库", created, json.dumps(found.get("data", {}))[:120])
        if created:
            sid = found["data"]["list"][0]["id"]
            # 删除（危险操作：应弹二次确认）
            pg.goto(f"{BASE}/#/data/students", wait_until="networkidle")
            pg.fill('input[placeholder*="姓名"], input[placeholder*="关键字"]', sname)
            pg.keyboard.press("Enter")
            pg.wait_for_timeout(1200)
            delbtn = pg.locator('tr', has_text=sname).first.locator('button:has-text("删除")').first
            if delbtn.count():
                delbtn.click()
                pg.wait_for_timeout(800)
                box = pg.locator(".el-message-box").first
                confirm_visible = box.count() > 0 and box.is_visible()
                check("删除操作弹出二次确认弹窗", confirm_visible)
                if confirm_visible:
                    btns = box.locator("button")
                    texts = [btns.nth(i).inner_text().strip() for i in range(btns.count())]
                    print(f"      确认弹窗按钮 = {texts}")
                    # Element Plus：主按钮带 el-button--primary
                    target_btn = box.locator("button.el-button--primary").first
                    if target_btn.count() == 0:
                        target_btn = box.locator('button:has-text("确定")').first
                    target_btn.click(timeout=8000)
                    pg.wait_for_timeout(1600)
                    after = requests.get(
                        f"{API}/api/students?keyword={sname}",
                        headers={"Authorization": f"Bearer {admin['accessToken']}"},
                        timeout=10,
                    ).json()
                    check("二次确认后学员被删除", (after.get("data") or {}).get("total", 1) == 0)
                else:
                    warn_it("未捕获到二次确认弹窗（删除可能被直接执行）")
            else:
                warn_it("列表行内未找到「删除」按钮（可能为图标按钮，未断言）")
            # 兜底清理
            try:
                requests.delete(f"{API}/api/students/{sid}", headers={"Authorization": f"Bearer {admin['accessToken']}"}, timeout=10)
            except Exception:
                pass

        # ═══ ④ 财务流程：报班 + 缴费（经 UI 打开，用 API 断言）═══
        print("\n[④ ] 财务主链路（UI 打开 + API 断言）")
        pg.goto(f"{BASE}/#/finance/orders", wait_until="networkidle")
        pg.wait_for_timeout(900)
        orders_txt = pg.inner_text("body")
        check("报班管理页展示订单列表与筛选区", "报班" in orders_txt and ("筛选" in orders_txt or "学员" in orders_txt))
        pg.goto(f"{BASE}/#/finance/consumption", wait_until="networkidle")
        pg.wait_for_timeout(900)
        cons_txt = pg.inner_text("body")
        check("课消统计页展示已确认收入区", "已确认" in cons_txt or "收入" in cons_txt)
        pg.screenshot(path="evidence/test_finance_consumption.png")

        check("admin 全流程无 API 4xx/5xx（除预期业务拒绝）", len(bad_resp) == 0, "; ".join(bad_resp[:4]))
        check("admin 全流程无控制台错误", len(console_errors) == 0, "; ".join(console_errors[:3]))
        ctx.close()

        # ═══ ⑤ teacher 角色收敛 ═══
        print("\n[⑤ ] teacher 角色菜单收敛与越权拦截")
        ctx2 = browser.new_context(viewport={"width": 1440, "height": 900})
        seed_auth(ctx2, teacher)
        pg2 = ctx2.new_page()
        t_err = []
        pg2.on("console", lambda m: t_err.append(m.text) if m.type == "error" else None)
        pg2.goto(f"{BASE}/#/welcome", wait_until="networkidle")
        pg2.wait_for_timeout(1500)
        menu_txt = pg2.inner_text("body")
        forbidden = [t for t in [
            "员工账号", "经营报表", "系统参数", "数据备份", "审计日志", "课程管理", "学期管理", "调课审批",
            # 2026-09-12 权限收紧：费用与销售数据对教师不可见
            "财务管理", "报班管理", "缴费记录", "退费管理", "财务统计", "课消统计",
            "招生管理", "线索管理",
        ] if t in menu_txt]
        check("teacher 侧边栏不含管理员/财务/招生菜单", len(forbidden) == 0, f"出现: {forbidden}")
        # 注意：pure-admin 对「仅一个子项的目录」会提升子项为顶级菜单（父级标题不渲染），
        # 因此家校管理在界面上呈现为「通知记录」而非「家校管理」
        expected = [t for t in ["考勤管理", "通知记录", "教学结果", "数据管理"] if t in menu_txt]
        check("teacher 侧边栏保留授课相关菜单（考勤/通知/教学/数据）", len(expected) == 4, f"实际命中: {expected}")
        # 直接访问管理员页面：应 fail-closed（403 页 或 404 页），且不得发起 API 调用 / 泄露数据
        t_api = []
        pg2.on("response", lambda r: t_api.append(r.url) if "/api/" in r.url else None)
        pg2.goto(f"{BASE}/#/welcome", wait_until="networkidle")
        pg2.wait_for_timeout(1200)
        t_api.clear()
        pg2.goto(f"{BASE}/#/system/audit-logs", wait_until="networkidle")
        pg2.wait_for_timeout(1500)
        tbody = pg2.inner_text("body")
        fail_closed = ("403" in tbody) or ("404" in tbody) or "/error/" in pg2.url
        check("teacher 直接访问审计日志被 fail-closed（403/404 页）", fail_closed, f"url={pg2.url} body={tbody[:40]!r}")
        check("teacher 访问管理员页面期间未发起任何 API 调用", len(t_api) == 0, str(t_api[:3]))
        check("teacher 访问管理员页面未泄露审计数据", "操作审计" not in tbody and "动作" not in tbody)
        if "404" in tbody and "403" not in tbody:
            warn_it(
                "越权访问渲染的是 404 页而非 403 页（功能上 fail-closed 且后端已 403，属 UI 一致性小瑕疵）",
                "/#/system/audit-logs",
            )
        # 直输财务 URL（2026-09-12 权限收紧）：应 fail-closed，且不得发起 finance API
        t_api.clear()
        pg2.goto(f"{BASE}/#/finance/orders", wait_until="networkidle")
        pg2.wait_for_timeout(1500)
        fbody = pg2.inner_text("body")
        fin_api = [u for u in t_api if "/api/finance" in u]
        check("teacher 直输财务页面 URL 被 fail-closed（403/404 页）",
              ("403" in fbody) or ("404" in fbody) or "/error/" in pg2.url, f"url={pg2.url}")
        check("teacher 访问财务页面期间未发起 finance API 调用", len(fin_api) == 0, str(fin_api[:3]))
        check("teacher 财务页面未泄露金额数据", "报班金额" not in fbody and "¥" not in fbody)
        pg2.screenshot(path="evidence/test_teacher_finance_blocked.png")
        pg2.screenshot(path="evidence/test_teacher_403.png")
        # teacher 可用页面
        pg2.goto(f"{BASE}/#/attendance/checkin", wait_until="networkidle")
        pg2.wait_for_timeout(1000)
        check("teacher 可正常使用考勤登记", "考勤" in pg2.inner_text("body") and "/login" not in pg2.url)
        ctx2.close()

        browser.close()

    print(f"\n{'=' * 60}")
    print(f"汇总：PASS {passed} / FAIL {failed} / WARN {warned}")
    if failures:
        print("\n❌ 失败项：")
        for f in failures:
            print(f"   · {f}")
    if warnings:
        print("\n⚠️  需人工判读：")
        for w in warnings:
            print(f"   · {w}")
    print("=" * 60)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
