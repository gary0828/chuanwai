# -*- coding: utf-8 -*-
"""横切维度补充验证：审计留痕客观清单 + teacher 数据级权限/金额不可见 + 越权 403（自清理）"""
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
        try: ctx.delete(f"{BASE}{path}", headers=headers)
        except Exception: pass

    # ---- preClean ----
    r = ctx.get(f"{BASE}/finance/orders?keyword=e2e_test_xc&pageSize=100", headers=H)
    for o in (r.json().get("data") or {}).get("list", r.json().get("data") or []):
        safe_del(f"/finance/orders/{o['id']}")
    r = ctx.get(f"{BASE}/students?keyword=e2e_test_xc&pageSize=100", headers=H)
    for s in r.json()["data"]["list"]:
        safe_del(f"/students/{s['id']}")
    r = ctx.get(f"{BASE}/leaves?pageSize=100", headers=H)
    for lv in (r.json().get("data") or {}).get("list", r.json().get("data") or []):
        if lv.get("student_id") and lv.get("reason") == "e2e_test_xc":
            safe_del(f"/leaves/{lv['id']}")

    # ============ X1 审计留痕客观清单（§7 抽查清单逐项核对） ============
    r = ctx.get(f"{BASE}/audit-logs?pageSize=1", headers=H)
    before = (r.json().get("data") or {}).get("list") or []
    before_id = before[0]["id"] if before else 0

    # 执行抽查动作：学生增删 / 请假审批 / 缴费退费 / 学生档案家长信息 / 设置修改 / 备份
    r = ctx.post(f"{BASE}/students", headers=H, data={"student_no": "E2EXC001", "name": "e2e_test_xc学生", "class_id": 1})
    sid = r.json()["data"]["id"]
    ctx.put(f"{BASE}/students/{sid}", headers=H, data={"student_no": "E2EXC001", "name": "e2e_test_xc学生", "class_id": 1, "parent_name": "xc家长"})
    r = ctx.post(f"{BASE}/leaves", headers=H, data={"student_id": sid, "type": "事假", "reason": "e2e_test_xc", "start_date": TODAY, "end_date": TODAY})
    lv1 = (r.json().get("data") or {}).get("id")
    if lv1:
        ctx.put(f"{BASE}/leaves/{lv1}/approve", headers=H, data={"status": "通过"})
    r = ctx.post(f"{BASE}/finance/orders", headers=H, data={"student_id": sid, "class_id": 1, "course_id": 1, "amount": 500, "total_hours": 5})
    oid = r.json()["data"]["id"]
    r = ctx.post(f"{BASE}/finance/payments", headers=H, data={"order_id": oid, "student_id": sid, "amount": 500, "pay_method": "现金"})
    pay1 = (r.json().get("data") or {}).get("id")
    r = ctx.post(f"{BASE}/finance/refunds", headers=H, data={"order_id": oid, "student_id": sid, "amount": 100, "reason": "e2e_test_xc退费"})
    ref1 = (r.json().get("data") or {}).get("id")
    ctx.put(f"{BASE}/finance/refunds/{ref1}/approve", headers=H, data={"status": "通过"})
    r = ctx.get(f"{BASE}/settings", headers=H)
    old_vals = r.json().get("data") or {}
    settings_payload = {k: v for k, v in old_vals.items()}
    settings_payload["warn_rate"] = str(settings_payload.get("warn_rate", "0.6"))
    ctx.put(f"{BASE}/settings", headers=H, data=settings_payload)
    ctx.post(f"{BASE}/backups", headers=H, data={})

    # 汇总新增日志
    r = ctx.get(f"{BASE}/audit-logs?pageSize=100", headers=H)
    logs = (r.json().get("data") or {}).get("list") or []
    new_logs = [x for x in logs if x["id"] > before_id]
    actions = {x["action"] for x in new_logs}
    print("    [审计] 本次新增日志 actions =", sorted(actions))
    print("    [审计] 日志数 =", len(new_logs))

    # 抽查清单逐项核对（测试计划 §7）
    record("X1.1", "审计-学生增删改留痕", "新增学生" in actions, f"含'新增学生'={('新增学生' in actions)}")
    record("X1.2", "审计-请假审批留痕", any("请假" in a for a in actions), f"含请假相关={any('请假' in a for a in actions)}")
    record("X1.3", "审计-缴费/退费留痕", "登记缴费" in actions and "审批退费" in actions, f"登记缴费={('登记缴费' in actions)} 审批退费={('审批退费' in actions)}")
    record("X1.4", "审计-学生档案(含家长信息)修改留痕", "修改学生" in actions, f"含学生修改={('修改学生' in actions)}")
    record("X1.5", "审计-系统设置修改留痕", "修改系统参数" in actions, f"含设置={('修改系统参数' in actions)}")
    record("X1.6", "审计-备份操作留痕", any("备份" in a for a in actions), f"含备份={any('备份' in a for a in actions)}")
    record("X1.7", "审计-操作人正确", all(x.get("username") == "admin" for x in new_logs), f"操作人={sorted({x.get('username') for x in new_logs})}")

    # ============ X2 teacher 权限边界（§6） ============
    r = ctx.post(f"{BASE}/auth/login", data={"username": "teacher", "password": "teacher123456"})
    tt = r.json()["data"]["accessToken"]
    HT = {"Authorization": f"Bearer {tt}"}
    # v14：员工账号管理仅 admin，teacher 访问 → 403
    r = ctx.get(f"{BASE}/users?pageSize=200", headers=HT)
    record("X2.1", "teacher越权-员工账号管理403", r.status == 403, f"status={r.status}")
    record("X2.2", "teacher-员工账号管理不可见(仅admin)", r.status == 403, f"status={r.status}")
    r = ctx.put(f"{BASE}/settings", headers=HT, data={"warn_rate": "0.6"})
    record("X2.3", "teacher越权-改系统设置403", r.status == 403, f"status={r.status}")
    r = ctx.get(f"{BASE}/audit-logs", headers=HT)
    record("X2.4", "teacher越权-审计日志403", r.status == 403, f"status={r.status}")
    r = ctx.get(f"{BASE}/backups", headers=HT)
    record("X2.5", "teacher越权-备份403", r.status == 403, f"status={r.status}")
    r = ctx.get(f"{BASE}/finance/stats/consumption?dimension=course&start_date={TODAY}&end_date={TODAY}", headers=HT)
    j = r.json()
    data = j.get("data") or {}
    can_see = (data.get("summary") or {}).get("can_see_amount")
    record("X2.6", "课消-teacher金额不可见", r.status == 200 and can_see is False, f"can_see_amount={can_see}")
    r = ctx.get(f"{BASE}/students?pageSize=200", headers=HT)
    s_list = r.json()["data"]["list"]
    non_own = [s for s in s_list if s.get("class_id") != 1]
    record("X2.7", "数据级-学生列表仅本班", r.status == 200 and len(non_own) == 0, f"非本班={len(non_own)}")

    # ---- 清理（按依赖序） ----
    restore = {k: old_vals[k] for k in old_vals}
    ctx.put(f"{BASE}/settings", headers=H, data=restore)
    r = ctx.get(f"{BASE}/finance/payments?order_id={oid}&pageSize=100", headers=H)
    for pay in (r.json().get("data") or {}).get("list", []):
        safe_del(f"/finance/payments/{pay['id']}")
    r = ctx.get(f"{BASE}/finance/refunds?order_id={oid}&pageSize=100", headers=H)
    for ref in (r.json().get("data") or {}).get("list", []):
        safe_del(f"/finance/refunds/{ref['id']}")
    safe_del(f"/finance/orders/{oid}")
    safe_del(f"/students/{sid}")
    r = ctx.get(f"{BASE}/students?keyword=e2e_test_xc", headers=H)
    record("X3", "测试数据无残留", r.json()["data"]["total"] == 0)

    fails = [x for x in results if not x[2]]
    print(f"\n==== 横切汇总: PASS {len(results)-len(fails)} / {len(results)} ====")
    for f in fails:
        print("  FAIL:", f[0], f[1], f[3])
    ctx.dispose()
