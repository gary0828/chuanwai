# -*- coding: utf-8 -*-
"""P7 教学结果：考试/成绩录入(通知幂等)/成绩单/学习报告/成长档案/考试删除（自清理）"""
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

    # ---- preClean ----
    r = ctx.get(f"{BASE}/finance/orders?keyword=e2e_test_p7&pageSize=100", headers=H)
    for o in (r.json().get("data") or {}).get("list", r.json().get("data") or []):
        safe_del(f"/finance/orders/{o['id']}")
    r = ctx.get(f"{BASE}/students?keyword=e2e_test_p7&pageSize=100", headers=H)
    for s in r.json()["data"]["list"]:
        safe_del(f"/students/{s['id']}")
    r = ctx.get(f"{BASE}/exams?keyword=e2e_test_p7&pageSize=100", headers=H)
    for e in (r.json().get("data") or {}).get("list", r.json().get("data") or []):
        safe_del(f"/exams/{e['id']}")

    # 准备：学生（家长信息随档案，用于成绩通知家长姓名快照）
    r = ctx.post(f"{BASE}/students", headers=H, data={"student_no": "E2EP7001", "name": "e2e_test_p7学生", "class_id": 1, "parent_name": "p7家长", "parent_phone": "13900007777"})
    sid = r.json()["data"]["id"]
    record("P7.0", "准备(学生含家长信息)", bool(sid), f"sid={sid}")

    # 创建考试
    r = ctx.post(f"{BASE}/exams", headers=H, data={"name": "e2e_test_p7考试", "course_id": 1, "class_id": 1, "exam_date": TODAY, "type": "单元测", "full_score": 100})
    eid = (r.json().get("data") or {}).get("id")
    record("P7.1", "创建考试", r.status == 200 and eid, f"id={eid}")

    # 成绩录入（新插入 → 生成成绩发布通知）
    r = ctx.put(f"{BASE}/exams/{eid}/scores", headers=H, data={"scores": [{"student_id": sid, "score": 92}]})
    n1 = [n for n in (ctx.get(f"{BASE}/notifications?keyword=e2e_test_p7&pageSize=100", headers=H).json().get("data") or {}).get("list", []) if n.get("student_id") == sid and n.get("type") == "成绩发布"]
    record("P7.2", "成绩录入+发布通知", r.status == 200 and len(n1) >= 1, f"通知={len(n1)}")

    # 修改成绩（不重复通知，幂等）
    r = ctx.put(f"{BASE}/exams/{eid}/scores", headers=H, data={"scores": [{"student_id": sid, "score": 95}]})
    n2 = [n for n in (ctx.get(f"{BASE}/notifications?keyword=e2e_test_p7&pageSize=100", headers=H).json().get("data") or {}).get("list", []) if n.get("student_id") == sid and n.get("type") == "成绩发布"]
    record("P7.3", "修改成绩不重复通知(幂等)", r.status == 200 and len(n2) == len(n1), f"通知 {len(n1)}->{len(n2)}")

    # 成绩单（排名/等级：95→优；字段 grade）
    r = ctx.get(f"{BASE}/exams/{eid}/scorecard", headers=H)
    j = r.json()
    rows = (j.get("data") or {}).get("list", [])
    row = next((x for x in rows if x.get("student_id") == sid), None)
    record("P7.4", "成绩单排名与等级", r.status == 200 and row and row.get("score") == 95 and row.get("grade") == "优", f"rank={row.get('rank') if row else '?'} grade={row.get('grade') if row else '?'}")

    # 学习报告（student + scores）
    r = ctx.get(f"{BASE}/reports/students/{sid}", headers=H)
    j = r.json()
    rp = (j.get("data") or {})
    rp_stu = rp.get("student") or {}
    rp_scores = rp.get("scores") or []
    record("P7.5", "学习报告", r.status == 200 and rp_stu.get("name") == "e2e_test_p7学生" and len(rp_scores) > 0 and rp_scores[0].get("score") == 95, f"scores={len(rp_scores)}")

    # 成长档案时间线（data 直接为数组）
    r = ctx.get(f"{BASE}/reports/students/{sid}/timeline", headers=H)
    j = r.json()
    tl = j.get("data") or []
    has_score_event = any(x.get("type") == "成绩" for x in tl)
    record("P7.6", "成长档案时间线", r.status == 200 and len(tl) > 0 and has_score_event, f"事件数={len(tl)}")

    # 删除考试（级联删成绩，README 设计）
    r = ctx.delete(f"{BASE}/exams/{eid}", headers=H)
    record("P7.7", "删除考试(级联成绩)", r.status == 200, f"msg={r.json().get('message','ok')}")

    # 删除保护：教师访问非本班考试 → 403
    r = ctx.post(f"{BASE}/auth/login", data={"username": "teacher", "password": "teacher123456"})
    tt = r.json()["data"]["accessToken"]
    HT = {"Authorization": f"Bearer {tt}"}
    r = ctx.post(f"{BASE}/exams", headers=H, data={"name": "e2e_test_p7b考试", "course_id": 1, "class_id": 3, "exam_date": TODAY, "type": "期中", "full_score": 100})
    eid2 = (r.json().get("data") or {}).get("id")
    r = ctx.get(f"{BASE}/exams/{eid2}/scorecard", headers=HT)
    record("P7.8", "teacher非本班考试被拒", r.status == 403, f"msg={r.json().get('message')}")
    ctx.delete(f"{BASE}/exams/{eid2}", headers=H)

    # 清理
    ctx.delete(f"{BASE}/students/{sid}", headers=H)
    r = ctx.get(f"{BASE}/students?keyword=e2e_test_p7", headers=H)
    record("P7.9", "测试数据无残留", r.json()["data"]["total"] == 0)

    fails = [x for x in results if not x[2]]
    print(f"\n==== P7 汇总: PASS {len(results)-len(fails)} / {len(results)} ====")
    for f in fails:
        print("  FAIL:", f[0], f[1], f[3])
    ctx.dispose()
