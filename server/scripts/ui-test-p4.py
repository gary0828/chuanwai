# -*- coding: utf-8 -*-
"""P4 排课考勤：课表冲突检测 + 考勤批量登记课时联动 + 记录筛选（自清理）"""
import sys
from datetime import date
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/api"
results = []
def record(no, name, ok, detail=""):
    results.append((no, name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {no} {name} {detail}")

TODAY = date.today().isoformat()

with sync_playwright() as p:
    ctx = p.request.new_context()
    r = ctx.post(f"{BASE}/auth/login", data={"username": "admin", "password": "admin123456"})
    at = r.json()["data"]["accessToken"]
    H = {"Authorization": f"Bearer {at}"}

    def safe_del(path, headers=H):
        try:
            ctx.delete(f"{BASE}{path}", headers=headers)
        except Exception:
            pass

    # ---- preClean：先删 e2e 残留订单/学生，再删课表（依赖顺序）----
    r = ctx.get(f"{BASE}/finance/orders?keyword=e2e_test_p4&pageSize=100", headers=H)
    for o in (r.json().get("data") or {}).get("list", r.json().get("data") or []):
        safe_del(f"/finance/orders/{o['id']}")
    r = ctx.get(f"{BASE}/students?keyword=e2e_test_p4&pageSize=100", headers=H)
    for s in r.json()["data"]["list"]:
        safe_del(f"/students/{s['id']}")
    # 清理 e2e 测试课表（周一第1/2节 班级1/2，若上次残留）
    for cid in [1, 2]:
        r = ctx.get(f"{BASE}/schedules?class_id={cid}&day_of_week=1", headers=H)
        for s in (r.json().get("data") or {}).get("list", r.json().get("data") or []):
            if s.get("period") in (1, 2):
                safe_del(f"/schedules/{s['id']}")

    # ===== P4-1 课表管理 =====
    # 创建课表：班级1 + 课程1，周一第1节
    r = ctx.post(f"{BASE}/schedules", headers=H, data={"class_id": 1, "course_id": 1, "day_of_week": 1, "period": 1})
    j = r.json(); sch1 = (j.get("data") or {}).get("id")
    record("P4.1", "创建课表", r.status == 200 and sch1, f"id={sch1}")

    # 同班同时段（不同课程）→ 400 拒绝
    r = ctx.post(f"{BASE}/schedules", headers=H, data={"class_id": 1, "course_id": 2, "day_of_week": 1, "period": 1})
    record("P4.2", "冲突检测-同班同时段拒绝", r.status == 400, f"msg={r.json().get('message')}")

    # 同教师跨班同时段（班级2 + 同课程1=李老师，周一第1节）→ 200 + warnings
    r = ctx.post(f"{BASE}/schedules", headers=H, data={"class_id": 2, "course_id": 1, "day_of_week": 1, "period": 1})
    j = r.json(); sch2 = (j.get("data") or {}).get("id")
    warn = (j.get("data") or {}).get("warnings") or []
    record("P4.3", "冲突检测-同教师跨班警告", r.status == 200 and len(warn) > 0 and sch2, f"warnings={len(warn)}")

    # 查询课表（按班）
    r = ctx.get(f"{BASE}/schedules?class_id=1", headers=H)
    j = r.json()
    lst = (j.get("data") or {}).get("list", j.get("data") or [])
    record("P4.4", "课表查询(按班)", r.status == 200 and any(s.get("id") == sch1 for s in lst), f"count={len(lst)}")

    # 冲突预览接口
    r = ctx.post(f"{BASE}/schedules/check-conflict", headers=H, data={"class_id": 1, "course_id": 2, "day_of_week": 1, "period": 1})
    j = r.json()
    cf = (j.get("data") or {}).get("class_conflict") or []
    record("P4.5", "冲突预览接口", r.status == 200 and len(cf) > 0, f"class_conflict={len(cf)}")

    # ===== P4-2 考勤登记 + 课时联动 =====
    # 创建 e2e_test 学生（班级1）+ 课时包订单
    r = ctx.post(f"{BASE}/students", headers=H, data={"student_no": "E2EP4001", "name": "e2e_test_p4学生", "class_id": 1})
    sid = r.json()["data"]["id"]
    r = ctx.post(f"{BASE}/finance/orders", headers=H, data={"student_id": sid, "class_id": 1, "course_id": 1, "amount": 1000, "total_hours": 10})
    oid = r.json()["data"]["id"]
    record("P4.6", "准备学生+课时包订单", r.status == 200, f"sid={sid} oid={oid}")

    # 取订单当前 remain
    def remain():
        r = ctx.get(f"{BASE}/finance/orders/{oid}", headers=H)
        return (r.json().get("data") or {}).get("remain_hours")

    r0 = remain()
    # 标记正常 → 扣 1 课时
    r = ctx.post(f"{BASE}/attendance/batch", headers=H, data={"date": TODAY, "course_id": 1, "records": [{"student_id": sid, "status": "正常"}]})
    rn = remain()
    record("P4.7", "考勤正常扣课时", r.status == 200 and rn == r0 - 1, f"remain {r0}->{rn}")

    # 改缺勤 → 回补课时（缺勤不扣）
    r = ctx.post(f"{BASE}/attendance/batch", headers=H, data={"date": TODAY, "course_id": 1, "records": [{"student_id": sid, "status": "缺勤"}]})
    ra = remain()
    record("P4.8", "考勤改缺勤回补课时", r.status == 200 and ra == rn + 1, f"remain {rn}->{ra}")

    # 改回正常 → 再扣 1
    r = ctx.post(f"{BASE}/attendance/batch", headers=H, data={"date": TODAY, "course_id": 1, "records": [{"student_id": sid, "status": "正常"}]})
    rn2 = remain()
    record("P4.9", "考勤改回正常再扣", r.status == 200 and rn2 == ra - 1, f"remain {ra}->{rn2}")

    # 非法状态 → 400
    r = ctx.post(f"{BASE}/attendance/batch", headers=H, data={"date": TODAY, "course_id": 1, "records": [{"student_id": sid, "status": "未知状态"}]})
    record("P4.10", "非法考勤状态拦截", r.status == 400, f"msg={r.json().get('message')}")

    # 考勤记录查询
    r = ctx.get(f"{BASE}/attendance/records?date={TODAY}&course_id=1&student_id={sid}", headers=H)
    j = r.json()
    recs = (j.get("data") or {}).get("list", j.get("data") or [])
    record("P4.11", "考勤记录筛选查询", r.status == 200 and any(x.get("student_id") == sid and x.get("status") == "正常" for x in recs), f"count={len(recs)}")

    # 跨位置：考勤登记带出课表课程（班级1 周一有课表，课程1）
    r = ctx.get(f"{BASE}/attendance?class_id=1&course_id=1&date={TODAY}", headers=H)
    j = r.json()
    d = j.get("data") or []
    att_students = d.get("list") if isinstance(d, dict) else d
    record("P4.12", "考勤登记全班名单", r.status == 200 and any(x.get("student_id") == sid for x in att_students), f"名单人数={len(att_students)}")

    # ---- 清理 ----
    # 删订单 → 删学生（级联删考勤）→ 删课表
    ctx.delete(f"{BASE}/finance/orders/{oid}", headers=H)
    ctx.delete(f"{BASE}/students/{sid}", headers=H)
    safe_del(f"/schedules/{sch1}")
    safe_del(f"/schedules/{sch2}")
    # 残留检查
    r = ctx.get(f"{BASE}/students?keyword=e2e_test_p4", headers=H)
    record("P4.13", "测试数据无残留", r.json()["data"]["total"] == 0)

    fails = [x for x in results if not x[2]]
    print(f"\n==== P4 汇总: PASS {len(results)-len(fails)} / {len(results)} ====")
    for f in fails:
        print("  FAIL:", f[0], f[1], f[3])
    ctx.dispose()
