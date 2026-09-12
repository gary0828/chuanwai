# -*- coding: utf-8 -*-
"""P1-2/3/4 API 测试：用户管理、学期管理、系统参数 + 权限边界（测完自清理）"""
import sys, json
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/api"
results = []

def record(no, name, ok, detail=""):
    results.append((no, name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {no} {name} {detail}")

with sync_playwright() as p:
    ctx = p.request.new_context()

    def login(user, pwd):
        r = ctx.post(f"{BASE}/auth/login", data={"username": user, "password": pwd})
        j = r.json()
        tok = (j.get("data") or {}).get("accessToken") or (j.get("data") or {}).get("token")
        return r.status, j, tok

    st, _, at = login("admin", "admin123456")
    assert at, f"admin 登录失败: {_}"
    _, _, tt = login("teacher", "teacher123456")
    H = {"Authorization": f"Bearer {at}"}
    HT = {"Authorization": f"Bearer {tt}"}

    # ============ P1-2 用户管理 ============
    r = ctx.get(f"{BASE}/users?page=1&pageSize=100", headers=H)
    j = r.json(); lst = j["data"]["list"]; total = j["data"]["total"]
    record("P1-2.U1", "用户列表", r.status == 200 and total >= 2, f"total={total}")

    # 创建测试教师
    r = ctx.post(f"{BASE}/users", headers=H, data={"username": "e2e_test_t01", "password": "e2e123456", "name": "测试教师甲", "role": "teacher"})
    j = r.json(); tid = (j.get("data") or {}).get("id")
    record("P1-2.U2", "创建教师", r.status == 200 and tid, f"id={tid}")

    # 创建测试学生（需学号+班级，跨表建档）
    r = ctx.post(f"{BASE}/users", headers=H, data={"username": "e2e2026001", "password": "e2e123456", "name": "测试学生甲", "role": "student", "student_no": "E2E2026001", "class_id": 1})
    j = r.json(); sid = (j.get("data") or {}).get("id")
    record("P1-2.U3", "创建学生(账号+学籍同步)", r.status == 200 and sid, f"id={sid}")

    # 创建重复用户名 → 400
    r = ctx.post(f"{BASE}/users", headers=H, data={"username": "e2e_test_t01", "password": "x", "name": "重复", "role": "teacher"})
    record("P1-2.U4", "重复用户名拦截", r.status == 400, f"msg={r.json().get('message')}")

    # 修改测试用户
    r = ctx.put(f"{BASE}/users/{tid}", headers=H, data={"name": "测试教师甲改"})
    record("P1-2.U5", "修改用户", r.status == 200)

    # 删除无关联测试教师 → 成功
    r = ctx.delete(f"{BASE}/users/{tid}", headers=H)
    record("P1-2.U6", "删除无关联用户", r.status == 200, f"msg={r.json().get('message','ok')}")

    # 删除保护1：teacher(id=2)是班主任 → 400
    r = ctx.delete(f"{BASE}/users/2", headers=H)
    record("P1-2.U7", "删除保护-班主任绑定", r.status == 400, f"msg={r.json().get('message')}")

    # 删除保护2：唯一管理员 → 400（先确认 admin 是否唯一）
    r = ctx.delete(f"{BASE}/users/1", headers=H)
    record("P1-2.U8", "删除保护-唯一管理员", r.status == 400, f"msg={r.json().get('message')}")

    # 权限：teacher 创建 admin → 403
    r = ctx.post(f"{BASE}/users", headers=HT, data={"username": "e2e_x1", "password": "x", "name": "x", "role": "admin"})
    record("P1-2.U9", "权限-teacher禁建admin", r.status == 403, f"msg={r.json().get('message')}")

    # 权限：teacher 用户列表只见学生
    r = ctx.get(f"{BASE}/users?pageSize=100", headers=HT)
    roles = {u["role"] for u in r.json()["data"]["list"]}
    record("P1-2.U10", "权限-teacher仅见学生", r.status == 200 and roles <= {"student"}, f"roles={roles}")

    # 删除测试学生（其无订单 → 应成功）
    r = ctx.delete(f"{BASE}/users/{sid}", headers=H)
    record("P1-2.U11", "清理测试学生", r.status == 200, f"msg={r.json().get('message','ok')}")

    # ============ P1-3 学期管理 ============
    r = ctx.get(f"{BASE}/terms", headers=H)
    j = r.json(); terms = j["data"]["list"] if isinstance(j.get("data"), dict) else j["data"]
    current = [t for t in terms if t.get("is_current")]
    record("P1-3.T1", "学期列表+当前学期", r.status == 200 and len(current) == 1, f"term={len(terms)} current={current[0]['name'] if current else None}")

    # 创建测试学期（非当前）
    r = ctx.post(f"{BASE}/terms", headers=H, data={"name": "e2e_test_测试学期", "start_date": "2026-09-01", "end_date": "2027-01-31", "is_current": 0})
    j = r.json(); new_term_id = (j.get("data") or {}).get("id")
    record("P1-3.T2", "创建学期", r.status == 200 and new_term_id, f"id={new_term_id}")

    # 边界：开始晚于结束 → 400
    r = ctx.post(f"{BASE}/terms", headers=H, data={"name": "e2e_bad", "start_date": "2026-09-01", "end_date": "2026-08-01"})
    record("P1-3.T3", "日期边界拦截", r.status == 400, f"msg={r.json().get('message')}")

    # 切到测试学期 → 原学期自动取消
    orig_current_id = current[0]["id"]
    r = ctx.put(f"{BASE}/terms/{new_term_id}/current", headers=H)
    r2 = ctx.get(f"{BASE}/terms/current", headers=H)
    j2 = r2.json(); now_current = (j2.get("data") or {}).get("id")
    record("P1-3.T4", "切换当前学期(互斥)", r.status == 200 and now_current == new_term_id, f"now={now_current}")

    # 切回原学期
    ctx.put(f"{BASE}/terms/{orig_current_id}/current", headers=H)
    r = ctx.delete(f"{BASE}/terms/{new_term_id}", headers=H)
    record("P1-3.T5", "删除测试学期+恢复当前", r.status == 200, f"msg={r.json().get('message','ok')}")

    # 权限：teacher 创建学期 → 403
    r = ctx.post(f"{BASE}/terms", headers=HT, data={"name": "e2e_xx", "start_date": "2026-09-01", "end_date": "2027-01-31"})
    record("P1-3.T6", "权限-teacher禁建学期", r.status == 403)

    # ============ P1-4 系统参数 ============
    r = ctx.get(f"{BASE}/settings", headers=H)
    j = r.json(); s = j.get("data", {})
    record("P1-4.S1", "读取系统参数", r.status == 200 and "warn_rate" in s, f"keys={list(s.keys())}")

    old_warn = s.get("warn_rate")
    r = ctx.put(f"{BASE}/settings", headers=H, data={"warn_rate": "0.95"})
    r2 = ctx.get(f"{BASE}/settings", headers=H)
    now = r2.json().get("data", {}).get("warn_rate")
    record("P1-4.S2", "修改参数+持久化", r.status == 200 and now == "0.95", f"now={now}")

    # 恢复原值
    ctx.put(f"{BASE}/settings", headers=H, data={"warn_rate": old_warn})

    # 权限：teacher 改设置 → 403
    r = ctx.put(f"{BASE}/settings", headers=HT, data={"warn_rate": "0.1"})
    record("P1-4.S3", "权限-teacher禁改参数", r.status == 403)

    # ============ 汇总 ============
    fails = [x for x in results if not x[2]]
    print(f"\n==== P1 API 汇总: PASS {len(results)-len(fails)} / {len(results)} ====")
    for f in fails:
        print("  FAIL:", f[0], f[1], f[3])
    ctx.dispose()
