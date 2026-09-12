# -*- coding: utf-8 -*-
"""P3 教务建档测试 v2：学生/课程/班级 + 删除保护 + 跨位置验证（含 P3-A 复现，自清理）"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/api"
results = []
def record(no, name, ok, detail=""):
    results.append((no, name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {no} {name} {detail}")

with sync_playwright() as p:
    ctx = p.request.new_context()
    r = ctx.post(f"{BASE}/auth/login", data={"username": "admin", "password": "admin123456"})
    at = r.json()["data"]["accessToken"]
    H = {"Authorization": f"Bearer {at}"}
    r = ctx.post(f"{BASE}/auth/login", data={"username": "teacher", "password": "teacher123456"})
    tt = r.json()["data"]["accessToken"]
    HT = {"Authorization": f"Bearer {tt}"}

    def safe_del(path, headers=H):
        try:
            ctx.delete(f"{BASE}{path}", headers=headers)
        except Exception:
            pass

    # ---- preClean：先删残留学生，再删班级/课程（依赖顺序）----
    r = ctx.get(f"{BASE}/students?keyword=e2e_test_学生甲&pageSize=100", headers=H)
    for s in r.json()["data"]["list"]:
        safe_del(f"/students/{s['id']}")
    for kw in ["e2e_test_测试班级", "e2e_test_测试班级改"]:
        r = ctx.get(f"{BASE}/classes?keyword={kw}&pageSize=100", headers=H)
        for c in (r.json().get("data") or {}).get("list", r.json().get("data") or []):
            safe_del(f"/classes/{c['id']}")
    r = ctx.get(f"{BASE}/courses?keyword=e2e_test_测试课程&pageSize=100", headers=H)
    for c in (r.json().get("data") or {}).get("list", r.json().get("data") or []):
        safe_del(f"/courses/{c['id']}")

    # ===== P3-2 课程管理 =====
    r = ctx.post(f"{BASE}/courses", headers=H, data={"code": "E2E101", "name": "e2e_test_测试课程", "teacher": "测试老师"})
    j = r.json(); cid = (j.get("data") or {}).get("id")
    record("P3.1", "创建课程", r.status == 200 and cid, f"id={cid}")
    r = ctx.put(f"{BASE}/courses/{cid}", headers=H, data={"code": "E2E101", "name": "e2e_test_测试课程改", "teacher": "测试老师"})
    record("P3.2", "修改课程", r.status == 200)
    r = ctx.post(f"{BASE}/courses", headers=HT, data={"code": "E2E999", "name": "x", "teacher": "x"})
    record("P3.3", "权限-teacher禁建课程", r.status == 403)
    r = ctx.post(f"{BASE}/courses", headers=H, data={"code": "E2E101", "name": "x", "teacher": "x"})
    record("P3.3b", "重复课程code拦截", r.status == 400, f"msg={r.json().get('message')}")

    # ===== P3-3 班级管理 =====
    r = ctx.post(f"{BASE}/classes", headers=H, data={"name": "e2e_test_测试班级", "grade": "2026级"})
    j = r.json(); cls_id = (j.get("data") or {}).get("id")
    record("P3.4", "创建班级", r.status == 200 and cls_id, f"id={cls_id}")

    # P3-A 修复验证：修改班级不带 head_teacher_id → 200（原 500 缺陷已修复）
    r = ctx.put(f"{BASE}/classes/{cls_id}", headers=H, data={"name": "e2e_test_测试班级改", "grade": "2026级"})
    record("P3-A", "【修复验证】修改班级缺省head_teacher_id不500", r.status == 200, f"status={r.status} msg={r.json().get('message','ok')}")

    # 修改班级（带 head_teacher_id=null 绕过缺陷，验证修改功能本体可用）
    r = ctx.put(f"{BASE}/classes/{cls_id}", headers=H, data={"name": "e2e_test_测试班级改", "grade": "2026级", "head_teacher_id": None})
    record("P3.5", "修改班级(带head_teacher_id)", r.status == 200, f"msg={r.json().get('message','ok')}")

    # teacher 修改非本班 → 403
    r = ctx.put(f"{BASE}/classes/{cls_id}", headers=HT, data={"name": "x", "head_teacher_id": None})
    record("P3.5b", "权限-teacher改非本班被拒", r.status == 403, f"msg={r.json().get('message')}")

    # 重复班级名 → 400（此时名字已改为 e2e_test_测试班级改）
    r = ctx.post(f"{BASE}/classes", headers=H, data={"name": "e2e_test_测试班级改"})
    record("P3.6", "重复班级名拦截", r.status == 400, f"msg={r.json().get('message')}")

    # ===== P3-1 学生管理 =====
    r = ctx.post(f"{BASE}/students", headers=H, data={"student_no": "E2E2026001", "name": "e2e_test_学生甲", "class_id": cls_id, "phone": "13900009999"})
    j = r.json(); sid = (j.get("data") or {}).get("id")
    record("P3.7", "创建学生(自动建账号)", r.status == 200 and sid, f"id={sid}")

    # 跨位置：班级成员出现该学生（data.students）
    r = ctx.get(f"{BASE}/classes/{cls_id}/students", headers=H)
    j = r.json()
    d = (j.get("data") or {})
    students = d.get("students") or []
    in_class = any(s.get("id") == sid for s in students)
    record("P3.8", "跨位置-班级成员可见", r.status == 200 and in_class, f"student_total={d.get('student_total')}")

    # 跨位置：学生列表可见（含班级名）
    r = ctx.get(f"{BASE}/students?keyword=e2e_test_学生甲", headers=H)
    j = r.json()
    s = j["data"]["list"][0] if j["data"]["list"] else {}
    record("P3.9", "跨位置-学生列表可见(含班级)", r.status == 200 and s.get("class_name") == "e2e_test_测试班级改", f"class_name={s.get('class_name')}")

    # 修改学生（全量更新：学号/姓名/班级必填；补全 gender/phone/email/status 避免 undefined 绑定）
    r = ctx.put(f"{BASE}/students/{sid}", headers=H, data={"student_no": "E2E2026001", "name": "e2e_test_学生甲改", "gender": "男", "phone": "13900009999", "email": "", "class_id": cls_id, "status": "在读"})
    record("P3.10", "修改学生(完整字段)", r.status == 200, f"msg={r.json().get('message','ok')}")
    # P3-B 修复验证：修改学生缺省 gender 等字段 → 200（原 500 缺陷已修复，保留原值）
    r = ctx.put(f"{BASE}/students/{sid}", headers=H, data={"student_no": "E2E2026001", "name": "e2e_test_学生甲改", "class_id": cls_id})
    record("P3-B", "【修复验证】修改学生缺省字段不500", r.status == 200, f"status={r.status} msg={r.json().get('message','ok')}")
    # 重复学号 → 400
    r = ctx.post(f"{BASE}/students", headers=H, data={"student_no": "E2E2026001", "name": "x", "class_id": cls_id})
    record("P3.11", "重复学号拦截", r.status == 400, f"msg={r.json().get('message')}")

    # 删除保护：建订单后学生不可删
    r = ctx.post(f"{BASE}/finance/orders", headers=H, data={"student_id": sid, "class_id": cls_id, "course_id": cid, "amount": 500, "total_hours": 5})
    oid = (r.json().get("data") or {}).get("id")
    record("P3.12", "创建订单(供删除保护)", r.status == 200 and oid)
    r = ctx.delete(f"{BASE}/students/{sid}", headers=H)
    record("P3.13", "删除保护-有订单学生", r.status == 400, f"msg={r.json().get('message')}")
    # 删除保护：有学生班级禁止删除
    r = ctx.delete(f"{BASE}/classes/{cls_id}", headers=H)
    record("P3.14", "删除保护-有学生班级", r.status == 400, f"msg={r.json().get('message')}")

    # ---- 清理 ----
    ctx.delete(f"{BASE}/finance/orders/{oid}", headers=H)  # 订单删除级联缴费/退费
    rd = ctx.delete(f"{BASE}/students/{sid}", headers=H)
    record("P3.15", "删除无关联学生(含账号)", rd.status == 200, f"msg={rd.json().get('message','ok')}")
    rd = ctx.delete(f"{BASE}/classes/{cls_id}", headers=H)
    record("P3.16", "删除空班级", rd.status == 200, f"msg={rd.json().get('message','ok')}")
    rd = ctx.delete(f"{BASE}/courses/{cid}", headers=H)
    record("P3.17", "删除无引用课程", rd.status == 200, f"msg={rd.json().get('message','ok')}")

    # 残留检查
    r = ctx.get(f"{BASE}/students?keyword=e2e_test_学生甲", headers=H)
    record("P3.18", "学生无残留", r.json()["data"]["total"] == 0)

    fails = [x for x in results if not x[2]]
    print(f"\n==== P3 汇总: PASS {len(results)-len(fails)} / {len(results)} ====")
    for f in fails:
        print("  FAIL:", f[0], f[1], f[3])
    ctx.dispose()
