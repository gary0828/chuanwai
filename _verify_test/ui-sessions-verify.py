#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ui-sessions-verify.py —— T05 前端交互浏览器验证（admin / teacher 双角色）

对照 PRD §4.2 与验收标准 F：「浏览器用 admin 与 teacher 各一遍」。
- admin：四个新菜单（周课表 / 回填报告 / 任课关系 / 节次时间）均可用、页面不空白、0 报错；
         周课表=时间网格、两视角可切、生成弹窗三步、详情抽屉四页签、状态视觉。
- teacher：侧边栏只应有「周课表」（三个 admin-only 菜单不得出现）；
           直连 admin-only 路由不得渲染其内容；默认锁定本人；无「生成本学期课次」按钮；0 报错。

前置：被测站 = 生产构建产物 + serve-dist.mjs（/api 代理到 3000 副本库）。
      登录验证码已在构建期以 VITE_LOGIN_CAPTCHA=false 关闭（登录请求本就不携带验证码）。
运行：python ui-sessions-verify.py
"""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8848"
ADMIN = ("admin", "admin123456")
TEACHER = ("teacher", "teacher123456")

ADMIN_NEW_MENUS = ["周课表", "回填报告", "任课关系", "节次时间"]
ADMIN_ONLY_MENUS = ["回填报告", "任课关系", "节次时间"]

PASS = 0
FAIL = 0
FAILURES = []


def ck(cond, label, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("[PASS] " + label)
    else:
        FAIL += 1
        FAILURES.append(label)
        print("[FAIL] " + label + (("  -> " + str(extra)) if extra else ""))


def section(t):
    print("\n---------- " + t + " ----------")


class Console:
    """收集页面级报错（pageerror / console.error / requestfailed）。"""

    def __init__(self, page):
        self.pageerrors = []
        self.console_errors = []
        self.failed_requests = []
        page.on("pageerror", lambda e: self.pageerrors.append(str(e)))
        page.on(
            "console",
            lambda m: self.console_errors.append(m.text) if m.type == "error" else None,
        )
        page.on(
            "requestfailed",
            lambda r: self.failed_requests.append(
                r.url + " :: " + str(r.failure)
            ),
        )

    def reset(self):
        self.pageerrors.clear()
        self.console_errors.clear()
        self.failed_requests.clear()


def login(page, user, pwd):
    page.goto(BASE + "/#/login")
    page.wait_for_selector('input[placeholder="账号"]', timeout=20000)
    page.fill('input[placeholder="账号"]', user)
    page.fill('input[placeholder="密码"]', pwd)
    page.click('button:has-text("登录")')
    page.wait_for_function(
        "() => !location.hash.includes('/login')", timeout=25000
    )
    page.wait_for_timeout(1800)


def sidebar_text(page):
    """展开「考勤管理」分组（pure-admin 手风琴：同时只开一个），返回侧边栏可见文本。"""
    try:
        title = page.locator(
            '.sidebar-container .el-sub-menu__title:has-text("考勤管理")'
        ).first
        if title.count() > 0:
            parent_cls = title.locator("xpath=..").get_attribute("class") or ""
            if "is-opened" not in parent_cls:
                title.click()
                page.wait_for_timeout(600)
        return page.locator(".sidebar-container").inner_text()
    except Exception:
        return ""


def toolbar_select_texts(page):
    """工具栏内所有 el-select 当前显示文本（Element Plus 占位/已选都渲染在 span 里）。"""
    sels = page.locator(".page-toolbar .el-select")
    out = []
    for i in range(sels.count()):
        try:
            out.append((sels.nth(i).inner_text() or "").strip())
        except Exception:
            out.append("")
    return out


def goto_path(page, path):
    page.goto(BASE + "/#" + path)
    page.wait_for_timeout(1400)


def has_header(page, text):
    try:
        return page.locator(f'.app-page-header :text("{text}")').first.is_visible(
            timeout=2500
        )
    except Exception:
        try:
            return page.locator(f'text="{text}"').first.is_visible(timeout=2500)
        except Exception:
            return False


def visible_count(page, sel):
    try:
        return page.locator(sel).count()
    except Exception:
        return 0


def run_admin(pw):
    section("F-ADMIN：admin 四菜单 + 周课表交互")
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    con = Console(page)

    login(page, *ADMIN)
    ck("登录" not in page.url, "A1 admin 登录成功并离开登录页", page.url)

    # 侧边栏：四个新菜单都在
    stext = sidebar_text(page)
    for m in ADMIN_NEW_MENUS:
        ck(m in stext, f"A2 admin 侧边栏含菜单「{m}」")

    # 周课表页
    con.reset()
    goto_path(page, "/attendance/sessions")
    ck(has_header(page, "课次课表"), "A3 周课表页头「课次课表」渲染")
    grid_or_empty = visible_count(page, ".week-grid") + visible_count(
        page, ".app-empty"
    )
    ck(grid_or_empty > 0, "A4 周课表页非空白（网格或空态出现）", grid_or_empty)
    ck(
        visible_count(page, ".week-grid") > 0,
        "A5 周课表为时间网格（.week-grid，非列表）",
    )
    # 两视角
    ck(
        page.locator('label:has-text("班级视角")').first.is_visible(timeout=2000),
        "A6 视角切换·班级视角存在",
    )
    ck(
        page.locator('label:has-text("教师视角")').first.is_visible(timeout=2000),
        "A7 视角切换·教师视角存在",
    )
    # admin 默认班级视角 → 首个下拉已选中某班级（非占位/筛选）
    texts = toolbar_select_texts(page)
    class_selected = bool(
        texts
        and texts[0] not in ("", "请选择班级", "状态筛选", "请选择教师")
    )
    ck(
        class_selected,
        "A8 admin 默认班级视角（班级下拉已选中班级）",
        texts,
    )
    # 切到教师视角 → 出现教师下拉（占位「请选择教师」）
    page.locator('label:has-text("教师视角")').first.click()
    page.wait_for_timeout(1100)
    texts2 = toolbar_select_texts(page)
    ck(
        "请选择教师" in texts2,
        "A9 切「教师视角」出现教师下拉（占位请选择教师）",
        texts2,
    )
    page.locator('label:has-text("班级视角")').first.click()
    page.wait_for_timeout(700)

    # a11
    ck(len(con.pageerrors) == 0, "A10 周课表页 0 pageerror", con.pageerrors)
    ck(len(con.console_errors) == 0, "A11 周课表页 0 console.error", con.console_errors)

    # 生成弹窗三步
    con.reset()
    try:
        page.click('button:has-text("生成本学期课次")', timeout=3000)
        page.wait_for_timeout(800)
        steps_ok = all(
            page.locator(f'.el-step :text("{t}")').first.is_visible(timeout=1500)
            for t in ["选择学期", "预览", "确认"]
        )
        ck(steps_ok, "A12 生成弹窗三步（选择学期/预览/确认）")
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)
    except Exception as e:
        ck(False, "A12 生成弹窗三步（选择学期/预览/确认）", e)

    # 详情抽屉四页签（若当前周有课次则可点开）
    con.reset()
    cards = page.locator(".week-grid .sc")
    if cards.count() > 0:
        try:
            cards.first.click()
            page.wait_for_timeout(1000)
            tabs_ok = all(
                page.locator(f'.el-tabs__item:has-text("{t}")').first.is_visible(
                    timeout=2000
                )
                for t in ["点名", "课评", "课消", "挪课记录"]
            )
            ck(tabs_ok, "A13 课次详情抽屉四页签（点名/课评/课消/挪课记录）")
            # 状态视觉：抽屉里应有状态标签
            body = page.locator(".el-drawer").inner_text()
            ck(
                any(s in body for s in ["待上课", "已上课", "已停课", "已挪课", "已取消"]),
                "A14 详情/网格呈现课次状态文案",
            )
            page.keyboard.press("Escape")
            page.wait_for_timeout(500)
        except Exception as e:
            ck(False, "A13 课次详情抽屉四页签（点名/课评/课消/挪课记录）", e)
    else:
        # 无课次时退化为：空态可用（不伪装通过，明确标注）
        ck(
            visible_count(page, ".app-empty") > 0,
            "A13 当前周无课次→校验空态可用（未验到抽屉）",
        )

    # 其余三个 admin 菜单页
    con.reset()
    for path, header in [
        ("/attendance/sessions/migration-report", "课次回填报告"),
        ("/attendance/teaching-assignments", "任课关系"),
        ("/attendance/period-times", "节次时间"),
    ]:
        goto_path(page, path)
        app_page = visible_count(page, ".app-page")
        hdr = has_header(page, header)
        ck(app_page > 0, f"A15 {path} 非空白页")
        ck(hdr, f"A16 {path} 页头「{header}」渲染")

    ck(len(con.pageerrors) == 0, "A17 admin 三页 0 pageerror", con.pageerrors)
    ck(len(con.console_errors) == 0, "A18 admin 三页 0 console.error", con.console_errors)

    browser.close()


def run_teacher(pw):
    section("F-TEACHER：teacher 侧边栏/权限/周课表")
    browser = pw.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    con = Console(page)

    login(page, *TEACHER)
    ck("登录" not in page.url, "T1 teacher 登录成功并离开登录页", page.url)

    stext = sidebar_text(page)
    ck("周课表" in stext, "T2 teacher 侧边栏含「周课表」")
    for m in ADMIN_ONLY_MENUS:
        ck(m not in stext, f"T3 teacher 侧边栏不含 admin-only 菜单「{m}」")

    # 周课表：默认锁定本人
    con.reset()
    goto_path(page, "/attendance/sessions")
    ck(has_header(page, "课次课表"), "T4 teacher 周课表页头渲染")
    ttexts = toolbar_select_texts(page)
    ck(
        "请选择教师" not in ttexts and "请选择班级" not in ttexts,
        "T5 teacher 无班级/教师下拉（锁定本人）",
        ttexts,
    )
    locked = False
    try:
        inputs = page.locator("input")
        for i in range(inputs.count()):
            v = inputs.nth(i).input_value()
            if "本人" in (v or ""):
                locked = True
                break
    except Exception:
        pass
    ck(locked, "T6 teacher 教师框锁定为「本人」")
    ck(
        visible_count(page, ".week-grid") > 0
        or visible_count(page, ".app-empty") > 0,
        "T7 teacher 周课表非空白",
    )
    ck(
        page.locator('button:has-text("生成本学期课次")').count() == 0,
        "T8 teacher 无「生成本学期课次」按钮（admin-only）",
    )
    ck(len(con.pageerrors) == 0, "T9 teacher 周课表 0 pageerror", con.pageerrors)
    ck(len(con.console_errors) == 0, "T10 teacher 周课表 0 console.error", con.console_errors)

    # 直连三个 admin-only 路由：不得渲染其内容
    con.reset()
    for path, header in [
        ("/attendance/sessions/migration-report", "课次回填报告"),
        ("/attendance/teaching-assignments", "任课关系"),
        ("/attendance/period-times", "节次时间"),
    ]:
        goto_path(page, path)
        ck(
            not has_header(page, header),
            f"T11 teacher 直连 {path} 不渲染「{header}」（越权被拦）",
        )
    ck(
        len(con.pageerrors) == 0,
        "T12 teacher 越权直连 0 pageerror",
        con.pageerrors,
    )
    ck(
        len(con.console_errors) == 0,
        "T13 teacher 越权直连 0 console.error",
        con.console_errors,
    )

    browser.close()


def main():
    with sync_playwright() as pw:
        run_admin(pw)
        run_teacher(pw)
    print("\n========================================")
    print(f"UI VERIFY RESULT: PASS {PASS} / {PASS + FAIL}")
    if FAILURES:
        print("FAILED:")
        for f in FAILURES:
            print("  - " + f)
    print("========================================")
    sys.exit(0 if FAIL == 0 else 1)


if __name__ == "__main__":
    main()
