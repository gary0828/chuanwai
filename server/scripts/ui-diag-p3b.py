# -*- coding: utf-8 -*-
"""验证 P3-A 根因：PUT 班级 head_teacher_id 传 null vs 不传"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/api"
with sync_playwright() as p:
    ctx = p.request.new_context()
    r = ctx.post(f"{BASE}/auth/login", data={"username": "admin", "password": "admin123456"})
    at = r.json()["data"]["accessToken"]
    H = {"Authorization": f"Bearer {at}"}
    # 临时建一个班级测试
    r = ctx.post(f"{BASE}/classes", headers=H, data={"name": "e2e_test_bug验证", "grade": "2026级"})
    cid = r.json()["data"]["id"]
    r1 = ctx.put(f"{BASE}/classes/{cid}", headers=H, data={"name": "e2e_test_bug验证改", "grade": "2026级"})
    print(f"不传 head_teacher_id: {r1.status} {r1.json().get('message','ok')}")
    r2 = ctx.put(f"{BASE}/classes/{cid}", headers=H, data={"name": "e2e_test_bug验证改2", "grade": "2026级", "head_teacher_id": None})
    print(f"传 head_teacher_id=null: {r2.status} {r2.json().get('message','ok')}")
    # 清理
    r = ctx.get(f"{BASE}/classes/{cid}/students", headers=H)
    if r.json()["data"]["student_total"] == 0:
        ctx.delete(f"{BASE}/classes/{cid}", headers=H)
        print("已删除验证班级")
    ctx.dispose()
