# -*- coding: utf-8 -*-
"""P2 线索管理测试：创建/跟进/转化跨模块联动/删除保护/跨位置验证（自清理）"""
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

    # ---- preClean：清理上次可能遗留的 e2e_test_线索甲 数据 ----
    def safe_del(path, headers=H):
        try:
            ctx.delete(f"{BASE}{path}", headers=headers)
        except Exception:
            pass
    r = ctx.get(f"{BASE}/students?keyword=e2e_test_线索甲", headers=H)
    for s in r.json()["data"]["list"]:
        safe_del(f"/students/{s['id']}")
    # 按订单关联清理：先删缴费/退费，再删订单
    r = ctx.get(f"{BASE}/finance/orders?keyword=e2e_test_线索甲", headers=H)
    od = (r.json().get("data") or {})
    for o in (od.get("list") if isinstance(od, dict) else od or []):
        oid = o["id"]
        rp = ctx.get(f"{BASE}/finance/payments?order_id={oid}&pageSize=100", headers=H)
        for pay in (rp.json().get("data", {}).get("list") or []):
            safe_del(f"/finance/payments/{pay['id']}")
        rr = ctx.get(f"{BASE}/finance/refunds?keyword=e2e_test_&pageSize=100", headers=H)
        for ref in (rr.json().get("data", {}).get("list") or []):
            if ref.get("order_id") == oid:
                safe_del(f"/finance/refunds/{ref['id']}")
        safe_del(f"/finance/orders/{oid}")

    # 1) 创建线索
    r = ctx.post(f"{BASE}/leads", headers=H, data={"name": "e2e_test_线索甲", "phone": "13900001234", "source": "转介绍", "remark": "测试线索"})
    j = r.json(); lid = (j.get("data") or {}).get("id")
    record("P2.1", "创建线索", r.status == 200 and lid, f"id={lid}")

    # 2) 跟进
    r = ctx.put(f"{BASE}/leads/{lid}/follow", headers=H, data={"content": "电话沟通，意向报班"})
    record("P2.2", "线索跟进", r.status == 200)

    # 3) 改状态（流转；枚举：新线索/跟进中/已流失）
    r = ctx.put(f"{BASE}/leads/{lid}/status", headers=H, data={"status": "跟进中"})
    record("P2.3", "线索状态流转", r.status == 200)

    # 4) 转化（跨模块联动：学生+家长+订单+线索状态）
    r = ctx.put(f"{BASE}/leads/{lid}/convert", headers=H, data={"class_id": 1, "course_id": 1, "amount": 1000})
    j = r.json(); d = j.get("data") or {}
    sid = d.get("student_id"); sno = d.get("student_no")
    record("P2.4", "线索转化(生成学生)", r.status == 200 and sid, f"student_id={sid} no={sno}")

    # 5) 防重：已转化线索再次转化 → 400
    r = ctx.put(f"{BASE}/leads/{lid}/convert", headers=H, data={"class_id": 1, "course_id": 1})
    record("P2.5", "转化幂等(防重复)", r.status == 400, f"msg={r.json().get('message')}")

    # 6) 跨位置验证：线索列表带 converted_name
    r = ctx.get(f"{BASE}/leads?keyword=e2e_test_线索甲", headers=H)
    j = r.json(); lead = j["data"]["list"][0] if j["data"]["list"] else {}
    record("P2.6", "跨位置-线索列表显示转化学员", lead.get("status") == "已转化" and lead.get("converted_name") == "e2e_test_线索甲", f"status={lead.get('status')} cn={lead.get('converted_name')}")

    # 7) 跨位置验证：学生管理出现新学生
    r = ctx.get(f"{BASE}/students?keyword=e2e_test_线索甲", headers=H)
    j = r.json()
    found = any(s.get("name") == "e2e_test_线索甲" for s in j["data"]["list"])
    record("P2.7", "跨位置-学生列表可见", r.status == 200 and found)

    # 8) 跨位置验证：家长信息已写入学生档案（v14：无家长账号，家长姓名/电话随档案）
    r = ctx.get(f"{BASE}/students?keyword=e2e_test_线索甲", headers=H)
    j = r.json()
    stu = next((s for s in j["data"]["list"] if s.get("name") == "e2e_test_线索甲"), None)
    record("P2.8", "跨位置-学生档案含家长信息", r.status == 200 and bool(stu and stu.get("parent_name")), f"parent_name={stu and stu.get('parent_name')} parent_phone={stu and stu.get('parent_phone')}")

    # 9) 跨位置验证：订单已生成（报班）
    r = ctx.get(f"{BASE}/orders?keyword=e2e_test_线索甲", headers=H)
    if r.status == 404:
        r = ctx.get(f"{BASE}/finance/orders?keyword=e2e_test_线索甲", headers=H)
    j = r.json()
    od = (j.get("data") or {})
    lst = od.get("list") if isinstance(od, dict) else od
    found_order = any((o.get("student_name") or "") == "e2e_test_线索甲" for o in (lst or []))
    record("P2.9", "跨位置-订单已生成", r.status == 200 and found_order, f"status={r.status}")

    # 10) 删除保护：已转化线索禁止删除
    r = ctx.delete(f"{BASE}/leads/{lid}", headers=H)
    record("P2.10", "已转化线索删除保护", r.status == 400, f"msg={r.json().get('message')}")

    # ---- 清理（逆序）----
    r = ctx.get(f"{BASE}/finance/orders?keyword=e2e_test_线索甲", headers=H)
    j = r.json(); od = (j.get("data") or {})
    lst = od.get("list") if isinstance(od, dict) else od
    for o in (lst or []):
        oid = o.get("id")
        if oid:
            rp = ctx.get(f"{BASE}/finance/payments?order_id={oid}&pageSize=100", headers=H)
            for pay in (rp.json().get("data", {}).get("list") or []):
                ctx.delete(f"{BASE}/finance/payments/{pay['id']}", headers=H)
            ctx.delete(f"{BASE}/finance/orders/{oid}", headers=H)
    # 删除学生
    if sid:
        ctx.delete(f"{BASE}/students/{sid}", headers=H)
    # 删除线索
    ctx.delete(f"{BASE}/leads/{lid}", headers=H)

    # 11) 验证清理：学生/订单无残留；已转化线索按 v13 保护保留（转化历史不可删）
    r2 = ctx.get(f"{BASE}/students?keyword=e2e_test_线索甲", headers=H)
    clean = r2.json()["data"]["total"] == 0
    r3 = ctx.get(f"{BASE}/leads?keyword=e2e_test_线索甲", headers=H)
    lead_left = r3.json()["data"]["total"]
    record("P2.11", "学生/订单已清理", clean, f"学生残留={r2.json()['data']['total']}")
    # 已转化线索受 v13 删除保护无法经 API 删除，允许累积；仅验证残留均为已转化状态
    r3 = ctx.get(f"{BASE}/leads?keyword=e2e_test_线索甲", headers=H)
    left_list = r3.json()["data"]["list"]
    all_converted = len(left_list) > 0 and all(l["status"] == "已转化" for l in left_list)
    record("P2.11b", "已转化线索按保护保留(符合v13)", all_converted, f"残留线索数={len(left_list)} 状态={[l['status'] for l in left_list]}")

    # ===== 汇总 =====
    fails = [x for x in results if not x[2]]
    print(f"\n==== P2 汇总: PASS {len(results)-len(fails)} / {len(results)} ====")
    for f in fails:
        print("  FAIL:", f[0], f[1], f[3])
    ctx.dispose()
