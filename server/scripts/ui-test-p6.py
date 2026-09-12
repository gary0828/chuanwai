# -*- coding: utf-8 -*-
"""P6 调课补课：调课提交/去重/审批同步/冲突拒绝/撤销 + 补课课时联动（自清理）"""
import sys
from datetime import date, timedelta
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/api"
results = []
def record(no, name, ok, detail=""):
    results.append((no, name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {no} {name} {detail}")

TODAY = date.today().isoformat()
YEST = (date.today() - timedelta(days=1)).isoformat()

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
    def schs(cid, dow):
        r = ctx.get(f"{BASE}/schedules?class_id={cid}&day_of_week={dow}", headers=H)
        d = r.json().get("data") or []
        return d.get("list") if isinstance(d, dict) else d or []

    # ---- preClean ----
    r = ctx.get(f"{BASE}/finance/orders?keyword=e2e_test_p6&pageSize=100", headers=H)
    for o in (r.json().get("data") or {}).get("list", r.json().get("data") or []):
        safe_del(f"/finance/orders/{o['id']}")
    r = ctx.get(f"{BASE}/students?keyword=e2e_test_p6&pageSize=100", headers=H)
    for s in r.json()["data"]["list"]:
        safe_del(f"/students/{s['id']}")
    r = ctx.get(f"{BASE}/makeup-classes?keyword=e2e_test_p6&pageSize=100", headers=H)
    for m in (r.json().get("data") or {}).get("list", r.json().get("data") or []):
        safe_del(f"/makeup-classes/{m['id']}")
    # 清理可能残留的课表（班级1 周一/周二 1-3节）与调课申请（先删申请再删课表，因有调课历史的课表受保护）
    for cid in [1]:
        for dow in [1, 2]:
            for s in schs(cid, dow):
                if s.get("period") in (1, 2, 3):
                    r = ctx.get(f"{BASE}/schedule-adjustments?schedule_id={s['id']}&pageSize=100", headers=H)
                    for a in (r.json().get("data") or {}).get("list", []):
                        safe_del(f"/schedule-adjustments/{a['id']}")
                    safe_del(f"/schedules/{s['id']}")

    # ===== P6-1 调课 =====
    # 课表：班级1+课程1 周一第1节
    r = ctx.post(f"{BASE}/schedules", headers=H, data={"class_id": 1, "course_id": 1, "day_of_week": 1, "period": 1})
    schA = r.json()["data"]["id"]
    # 提交调课：周一第1节 → 周一第2节
    r = ctx.post(f"{BASE}/schedule-adjustments", headers=H, data={"schedule_id": schA, "to_day_of_week": 1, "to_period": 2, "reason": "e2e_test_p6调课"})
    adjA = (r.json().get("data") or {}).get("id")
    record("P6.1", "提交调课申请", r.status == 200 and adjA, f"id={adjA}")
    # 重复提交 → 400 去重
    r = ctx.post(f"{BASE}/schedule-adjustments", headers=H, data={"schedule_id": schA, "to_day_of_week": 1, "to_period": 2})
    record("P6.2", "调课去重(待审批唯一)", r.status == 400, f"msg={r.json().get('message')}")
    # 审批通过 → 课表同步为 周一第2节
    r = ctx.put(f"{BASE}/schedule-adjustments/{adjA}/approve", headers=H, data={"action": "通过"})
    schA_now = [s for s in schs(1, 1) if s.get("id") == schA]
    moved = schA_now and schA_now[0].get("period") == 2
    record("P6.3", "审批通过课表同步", r.status == 200 and moved, f"period={schA_now[0].get('period') if schA_now else '?'}")

    # 目标时段冲突拒绝：课表B(周一第2节) 提交调课到 周一第3节 已占 → 先建 周一第3节 课表
    r = ctx.post(f"{BASE}/schedules", headers=H, data={"class_id": 1, "course_id": 2, "day_of_week": 1, "period": 3})
    schB = r.json()["data"]["id"]
    r = ctx.post(f"{BASE}/schedule-adjustments", headers=H, data={"schedule_id": schA, "to_day_of_week": 1, "to_period": 3})
    record("P6.4", "目标时段冲突拒绝", r.status == 400, f"msg={r.json().get('message')}")

    # 撤销：新建课表C(周二第1节) → 提交调课 → 撤销
    r = ctx.post(f"{BASE}/schedules", headers=H, data={"class_id": 1, "course_id": 1, "day_of_week": 2, "period": 1})
    schC = r.json()["data"]["id"]
    r = ctx.post(f"{BASE}/schedule-adjustments", headers=H, data={"schedule_id": schC, "to_day_of_week": 2, "to_period": 2, "reason": "e2e_test_p6撤销"})
    adjC = (r.json().get("data") or {}).get("id")
    r = ctx.delete(f"{BASE}/schedule-adjustments/{adjC}", headers=H)
    record("P6.5", "撤销待审批调课", r.status == 200, f"msg={r.json().get('message','ok')}")

    # ===== P6-2 补课 =====
    r = ctx.post(f"{BASE}/students", headers=H, data={"student_no": "E2EP6001", "name": "e2e_test_p6学生", "class_id": 1})
    sid = r.json()["data"]["id"]
    r = ctx.post(f"{BASE}/finance/orders", headers=H, data={"student_id": sid, "class_id": 1, "course_id": 1, "amount": 1000, "total_hours": 10})
    oid = r.json()["data"]["id"]
    # 补课登记
    r = ctx.post(f"{BASE}/makeup-classes", headers=H, data={"student_id": sid, "class_id": 1, "course_id": 1, "original_date": YEST, "makeup_date": TODAY, "remark": "e2e_test_p6"})
    mup = (r.json().get("data") or {}).get("id")
    record("P6.6", "登记补课", r.status == 200 and mup, f"id={mup}")
    # 补课日期早于原始 → 400
    r = ctx.post(f"{BASE}/makeup-classes", headers=H, data={"student_id": sid, "class_id": 1, "original_date": TODAY, "makeup_date": YEST})
    record("P6.7", "补课日期边界拦截", r.status == 400, f"msg={r.json().get('message')}")
    # 完成 → 扣课时
    r = ctx.put(f"{BASE}/makeup-classes/{mup}/status", headers=H, data={"status": "已完成"})
    rem1 = (ctx.get(f"{BASE}/finance/orders/{oid}", headers=H).json().get("data") or {}).get("remain_hours")
    record("P6.8", "补课完成扣课时", r.status == 200 and rem1 == 9, f"remain={rem1}")
    # 撤销完成（待安排）→ 回补课时
    r = ctx.put(f"{BASE}/makeup-classes/{mup}/status", headers=H, data={"status": "待安排"})
    rem2 = (ctx.get(f"{BASE}/finance/orders/{oid}", headers=H).json().get("data") or {}).get("remain_hours")
    record("P6.9", "撤销补课回补课时", r.status == 200 and rem2 == 10, f"remain={rem2}")

    # ---- 清理（依赖序：先删业务记录/调课申请，再删课表；有调课历史的课表受保护） ----
    ctx.delete(f"{BASE}/finance/orders/{oid}", headers=H)
    ctx.delete(f"{BASE}/students/{sid}", headers=H)
    safe_del(f"/makeup-classes/{mup}")
    safe_del(f"/schedule-adjustments/{adjA}")  # 已通过申请须先删（删除接口支持，避免课表受保护）
    safe_del(f"/schedules/{schA}")
    safe_del(f"/schedules/{schB}")
    safe_del(f"/schedules/{schC}")
    r = ctx.get(f"{BASE}/students?keyword=e2e_test_p6", headers=H)
    record("P6.10", "测试数据无残留", r.json()["data"]["total"] == 0)

    fails = [x for x in results if not x[2]]
    print(f"\n==== P6 汇总: PASS {len(results)-len(fails)} / {len(results)} ====")
    for f in fails:
        print("  FAIL:", f[0], f[1], f[3])
    ctx.dispose()
