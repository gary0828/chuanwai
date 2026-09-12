# -*- coding: utf-8 -*-
"""P8 课消财务：订单/缴费/退费/状态流转/删除保护/课消统计口径（自清理）"""
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
    def safe_del(path):
        try: ctx.delete(f"{BASE}{path}", headers=H)
        except Exception: pass
    def order_data(oid):
        return (ctx.get(f"{BASE}/finance/orders/{oid}", headers=H).json().get("data") or {})
    def order_paid(oid):
        # paid 仅在列表返回（SUM payments），详情无此字段
        r = ctx.get(f"{BASE}/finance/orders?pageSize=200", headers=H)
        for o in (r.json().get("data") or {}).get("list", []):
            if o.get("id") == oid:
                return o.get("paid")
        return None

    # ---- preClean ----
    r = ctx.get(f"{BASE}/finance/orders?keyword=e2e_test_p8&pageSize=100", headers=H)
    for o in (r.json().get("data") or {}).get("list", r.json().get("data") or []):
        safe_del(f"/finance/orders/{o['id']}")
    r = ctx.get(f"{BASE}/students?keyword=e2e_test_p8&pageSize=100", headers=H)
    for s in r.json()["data"]["list"]:
        safe_del(f"/students/{s['id']}")

    # 准备：学生 + 订单（1000元/10课时）
    r = ctx.post(f"{BASE}/students", headers=H, data={"student_no": "E2EP8001", "name": "e2e_test_p8学生", "class_id": 1})
    sid = r.json()["data"]["id"]
    r = ctx.post(f"{BASE}/finance/orders", headers=H, data={"student_id": sid, "class_id": 1, "course_id": 1, "amount": 1000, "total_hours": 10})
    oid = r.json()["data"]["id"]
    record("P8.1", "创建订单(课时包10)", r.status == 200 and order_data(oid).get("remain_hours") == 10, f"oid={oid}")

    # 缴费 500 → 已缴 500
    r = ctx.post(f"{BASE}/finance/payments", headers=H, data={"order_id": oid, "student_id": sid, "amount": 500, "pay_method": "现金"})
    pay1 = (r.json().get("data") or {}).get("id")
    paid = order_paid(oid)
    record("P8.2", "缴费登记+已缴汇总", r.status == 200 and pay1 and paid == 500, f"pay={pay1} paid={paid}")

    # 修改缴费 500→600 → 已缴 600
    r = ctx.put(f"{BASE}/finance/payments/{pay1}", headers=H, data={"amount": 600})
    paid2 = order_paid(oid)
    record("P8.3", "修改缴费+已缴联动", r.status == 200 and paid2 == 600, f"paid={paid2}")

    # 退费申请 200 → 审批通过（记录留痕；paid 为 SUM(payments)，不含退费）
    r = ctx.post(f"{BASE}/finance/refunds", headers=H, data={"order_id": oid, "student_id": sid, "amount": 200, "reason": "e2e_test_p8退费"})
    ref1 = (r.json().get("data") or {}).get("id")
    r = ctx.put(f"{BASE}/finance/refunds/{ref1}/approve", headers=H, data={"status": "通过"})
    detail = order_data(oid)
    ref_ok = any(x.get("id") == ref1 and x.get("status") == "通过" for x in detail.get("refunds", []))
    record("P8.4", "退费审批通过留痕", r.status == 200 and ref_ok, f"ref={ref1} 详情退费={len(detail.get('refunds',[]))}")

    # 删除保护：有缴费/退费记录的订单 → 400
    r = ctx.delete(f"{BASE}/finance/orders/{oid}", headers=H)
    record("P8.5", "删除保护-有缴费退费订单", r.status == 400, f"msg={r.json().get('message')}")

    # 状态流转：结业
    r = ctx.put(f"{BASE}/finance/orders/{oid}/status", headers=H, data={"status": "结业"})
    record("P8.6", "订单状态流转(结业)", r.status == 200 and order_data(oid).get("status") == "结业")
    # 退班
    r = ctx.put(f"{BASE}/finance/orders/{oid}/status", headers=H, data={"status": "退班"})
    record("P8.7", "订单状态流转(退班)", r.status == 200 and order_data(oid).get("status") == "退班")
    # 非法状态 → 400
    r = ctx.put(f"{BASE}/finance/orders/{oid}/status", headers=H, data={"status": "作废"})
    record("P8.8", "非法订单状态拦截", r.status == 400)

    # 课消统计口径（维度查询）
    r = ctx.get(f"{BASE}/finance/stats/consumption?dimension=course&start_date={TODAY}&end_date={TODAY}", headers=H)
    j = r.json()
    record("P8.9", "课消统计(维度查询)", r.status == 200, f"status={r.status}")

    # 营收统计
    r = ctx.get(f"{BASE}/finance/stats/revenue?granularity=day&start_date={TODAY}&end_date={TODAY}", headers=H)
    record("P8.10", "营收统计", r.status == 200)

    # 欠费统计
    r = ctx.get(f"{BASE}/finance/stats/arrears", headers=H)
    record("P8.11", "欠费统计", r.status == 200)

    # ---- 清理 ----
    rp = ctx.get(f"{BASE}/finance/payments?order_id={oid}&pageSize=100", headers=H)
    for pay in (rp.json().get("data") or {}).get("list", []):
        safe_del(f"/finance/payments/{pay['id']}")
    rr = ctx.get(f"{BASE}/finance/refunds?keyword=e2e_test_p8&pageSize=100", headers=H)
    for ref in (rr.json().get("data") or {}).get("list", []):
        if ref.get("order_id") == oid:
            safe_del(f"/finance/refunds/{ref['id']}")
    ctx.delete(f"{BASE}/finance/orders/{oid}", headers=H)
    ctx.delete(f"{BASE}/students/{sid}", headers=H)
    r = ctx.get(f"{BASE}/students?keyword=e2e_test_p8", headers=H)
    record("P8.12", "测试数据无残留", r.json()["data"]["total"] == 0)

    fails = [x for x in results if not x[2]]
    print(f"\n==== P8 汇总: PASS {len(results)-len(fails)} / {len(results)} ====")
    for f in fails:
        print("  FAIL:", f[0], f[1], f[3])
    ctx.dispose()
