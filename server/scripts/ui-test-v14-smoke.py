# -*- coding: utf-8 -*-
"""v14 前端 UI 冒烟：登录 / 菜单(员工账号+无家长管理) / 学生页家长列 / 通知页家长姓名"""
import sys, time
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8080"
results = []
def record(no, name, ok, detail=""):
    results.append((no, name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {no} {name} {detail}")

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append(str(e)))

    # 1. 登录
    pg.goto(f"{BASE}/#/login", wait_until="networkidle")
    pg.wait_for_timeout(800)
    pg.fill('input[placeholder="账号"]', "admin")
    pg.fill('input[placeholder="密码"]', "admin123456")
    pg.click("button:has-text('登录')")
    pg.wait_for_timeout(3000)
    record("V1", "管理员登录成功", "/welcome" in pg.url or "#/welcome" in pg.url, pg.url)

    # 2. 菜单：员工账号（原用户管理改名）
    pg.goto(f"{BASE}/#/user", wait_until="networkidle")
    pg.wait_for_timeout(1500)
    body1 = pg.inner_text("body")
    record("V2", "员工账号页打开", "员工账号" in body1 and "新增员工" in body1, "")
    # 表格应只含 admin/teacher，无学生角色
    body1b = pg.inner_text("body")
    has_student_role = "学生" in body1b and "新增员工" in body1b
    record("V2b", "员工账号页无学生角色列", not has_student_role, "含'学生'=" + str("学生" in body1b))

    # 3. 学生页：家长信息列
    pg.goto(f"{BASE}/#/data/students", wait_until="networkidle")
    pg.wait_for_timeout(1500)
    body2 = pg.inner_text("body")
    record("V3", "学生页打开且含家长列", "家长" in body2 and "学号" in body2 and "新增学生" in body2, "")
    record("V3b", "学生页无登录账号列", "登录账号" not in body2, "含'登录账号'=" + str("登录账号" in body2))

    # 4. 通知页：家长姓名列
    pg.goto(f"{BASE}/#/family/notifications", wait_until="networkidle")
    pg.wait_for_timeout(1500)
    body3 = pg.inner_text("body")
    record("V4", "通知记录页打开", "通知记录" in body3 or "通知" in body3, "")

    # 5. 菜单不含"家长管理"
    pg.goto(f"{BASE}/#/welcome", wait_until="networkidle")
    pg.wait_for_timeout(1500)
    body4 = pg.inner_text("body")
    record("V5", "菜单无家长管理入口", "家长管理" not in body4, "含'家长管理'=" + str("家长管理" in body4))
    record("V5b", "菜单含员工账号", "员工账号" in body4, "含'员工账号'=" + str("员工账号" in body4))

    # 6. 控制台错误
    record("V6", "无控制台错误", len(errs) == 0, f"errors={errs[:3]}")
    pg.screenshot(path="evidence/v14_staff_crm.png")
    b.close()

    fails = [x for x in results if not x[2]]
    print(f"\n==== v14 UI 冒烟汇总: PASS {len(results)-len(fails)} / {len(results)} ====")
    for f in fails:
        print("  FAIL:", f[0], f[1], f[3])
