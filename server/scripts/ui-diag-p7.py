# -*- coding: utf-8 -*-
"""诊断 P7：成绩单/学习报告/时间线 返回结构"""
import sys
from datetime import date
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/api"
TODAY = date.today().isoformat()
with sync_playwright() as p:
    ctx = p.request.new_context()
    r = ctx.post(f"{BASE}/auth/login", data={"username": "admin", "password": "admin123456"})
    at = r.json()["data"]["accessToken"]
    H = {"Authorization": f"Bearer {at}"}
    def safe_del(path):
        try: ctx.delete(f"{BASE}{path}", headers=H)
        except Exception: pass
    # 清理+准备
    r = ctx.get(f"{BASE}/students?keyword=e2e_test_p7&pageSize=100", headers=H)
    for s in r.json()["data"]["list"]: safe_del(f"/students/{s['id']}")
    r = ctx.post(f"{BASE}/students", headers=H, data={"student_no": "E2EP7001", "name": "e2e_test_p7学生", "class_id": 1})
    sid = r.json()["data"]["id"]
    r = ctx.post(f"{BASE}/exams", headers=H, data={"name": "e2e_test_p7考试", "course_id": 1, "class_id": 1, "exam_date": TODAY, "type": "单元测", "full_score": 100})
    eid = r.json()["data"]["id"]
    ctx.put(f"{BASE}/exams/{eid}/scores", headers=H, data={"scores": [{"student_id": sid, "score": 95}]})

    r = ctx.get(f"{BASE}/exams/{eid}/scorecard", headers=H)
    print("== scorecard ==")
    print(str(r.json())[:600])
    r = ctx.get(f"{BASE}/reports/students/{sid}", headers=H)
    print("\n== report ==")
    print(str(r.json())[:600])
    r = ctx.get(f"{BASE}/reports/students/{sid}/timeline", headers=H)
    print("\n== timeline ==")
    print(str(r.json())[:800])
    # 清理
    safe_del(f"/exams/{eid}")
    safe_del(f"/students/{sid}")
    ctx.dispose()
