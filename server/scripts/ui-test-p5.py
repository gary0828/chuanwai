# -*- coding: utf-8 -*-
"""P5 请假联动：考勤↔请假双向（同步单/审批通过回补+通知/撤销/驳回回滚/幂等）（自清理）"""
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

    def remain(oid):
        r = ctx.get(f"{BASE}/finance/orders/{oid}", headers=H)
        return (r.json().get("data") or {}).get("remain_hours")

    def att_status(sid):
        r = ctx.get(f"{BASE}/attendance?class_id=1&course_id=1&date={TODAY}", headers=H)
        d = r.json().get("data") or []
        lst = d.get("list") if isinstance(d, dict) else d
        for x in lst:
            if x.get("student_id") == sid:
                return x.get("status")
        return None

    def sync_leaves(sid):
        r = ctx.get(f"{BASE}/leaves?pageSize=100", headers=H)
        d = (r.json().get("data") or {})
        lst = d.get("list") if isinstance(d, dict) else d or []
        return [l for l in lst if l.get("student_id") == sid and l.get("source") == "考勤同步"]

    def notices(sid, t):
        # 注意：/notifications 接口不支持 student_id 参数，用学员姓名 keyword 过滤避免混入历史数据
        r = ctx.get(f"{BASE}/notifications?keyword=e2e_test_p5&pageSize=100", headers=H)
        d = (r.json().get("data") or {})
        lst = d.get("list") if isinstance(d, dict) else d or []
        return [n for n in lst if n.get("student_id") == sid and n.get("type") == t]

    def mark(sid, status):
        return ctx.post(f"{BASE}/attendance/batch", headers=H, data={"date": TODAY, "course_id": 1, "records": [{"student_id": sid, "status": status}]})

    # ---- preClean ----
    r = ctx.get(f"{BASE}/finance/orders?keyword=e2e_test_p5&pageSize=100", headers=H)
    for o in (r.json().get("data") or {}).get("list", r.json().get("data") or []):
        safe_del(f"/finance/orders/{o['id']}")
    r = ctx.get(f"{BASE}/students?keyword=e2e_test_p5&pageSize=100", headers=H)
    for s in r.json()["data"]["list"]:
        safe_del(f"/students/{s['id']}")

    # ---- 准备：学生（家长信息随档案）+ 课时包订单 ----
    r = ctx.post(f"{BASE}/students", headers=H, data={"student_no": "E2EP5001", "name": "e2e_test_p5学生", "class_id": 1, "parent_name": "p5家长", "parent_phone": "13900005555"})
    sid = r.json()["data"]["id"]
    r = ctx.post(f"{BASE}/finance/orders", headers=H, data={"student_id": sid, "class_id": 1, "course_id": 1, "amount": 1000, "total_hours": 10})
    oid = r.json()["data"]["id"]
    record("P5.0", "准备(学生含家长信息+订单)", sid and oid, f"sid={sid} oid={oid}")

    # 1) 正常考勤 → 扣课时
    mark(sid, "正常")
    r1 = remain(oid)
    record("P5.1", "正常考勤扣课时", r1 == 9, f"remain={r1}")

    # 2) 标记请假 → 生成同步单 + 考勤=请假
    mark(sid, "请假")
    sl = sync_leaves(sid)
    st = att_status(sid)
    record("P5.2", "标记请假生成同步单+考勤请假", len(sl) == 1 and sl[0]["status"] == "待审批" and st == "请假", f"同步单={len(sl)} 考勤={st}")

    # 3) 幂等：重复标记请假 → 同步单仍 1 条
    mark(sid, "请假")
    sl2 = sync_leaves(sid)
    record("P5.3", "重复标记请假不重复生成(幂等)", len(sl2) == 1, f"同步单={len(sl2)}")

    # 4) 审批通过 → 考勤保持请假 + 回补课时 + 通知家长
    lid = sl2[0]["id"]
    r = ctx.put(f"{BASE}/leaves/{lid}/approve", headers=H, data={"status": "通过"})
    r4 = remain(oid)
    n4 = notices(sid, "请假审批通过")
    st4 = att_status(sid)
    record("P5.4", "审批通过(回补课时+通知)", r.status == 200 and r4 == 10 and len(n4) >= 1 and st4 == "请假", f"remain={r4} 通知={len(n4)} 考勤={st4}")

    # 5) 考勤改回正常 → 撤销已通过同步单 + 撤销通知
    mark(sid, "正常")
    sl5 = sync_leaves(sid)
    n5 = notices(sid, "请假审批通过")
    r5 = remain(oid)
    record("P5.5", "改回正常撤销同步单+通知", len(sl5) == 0 and len(n5) == 0 and r5 == 9, f"同步单={len(sl5)} 通知={len(n5)} remain={r5}")

    # 6) 驳回：再标记请假 → 同步单 → 审批驳回 → 考勤回滚缺勤
    mark(sid, "请假")
    sl6 = sync_leaves(sid)
    r6b = remain(oid)
    r = ctx.put(f"{BASE}/leaves/{sl6[0]['id']}/approve", headers=H, data={"status": "驳回"})
    st6 = att_status(sid)
    r6 = remain(oid)
    # 说明：标记请假（正常→请假）时已回补 1 课时；驳回后请假→缺勤均为不扣状态，remain 保持不变
    record("P5.6", "驳回回滚考勤为缺勤", r.status == 200 and st6 == "缺勤" and r6 == r6b, f"考勤={st6} remain={r6b}->{r6}（一致）")

    # ---- 清理 ----
    ctx.delete(f"{BASE}/finance/orders/{oid}", headers=H)
    ctx.delete(f"{BASE}/students/{sid}", headers=H)
    r = ctx.get(f"{BASE}/students?keyword=e2e_test_p5", headers=H)
    record("P5.7", "测试数据无残留", r.json()["data"]["total"] == 0)

    fails = [x for x in results if not x[2]]
    print(f"\n==== P5 汇总: PASS {len(results)-len(fails)} / {len(results)} ====")
    for f in fails:
        print("  FAIL:", f[0], f[1], f[3])
    ctx.dispose()
