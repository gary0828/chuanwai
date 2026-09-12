# -*- coding: utf-8 -*-
"""诊断 P3：班级 PUT/POST/成员接口"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/api"
with sync_playwright() as p:
    ctx = p.request.new_context()
    r = ctx.post(f"{BASE}/auth/login", data={"username": "admin", "password": "admin123456"})
    at = r.json()["data"]["accessToken"]
    H = {"Authorization": f"Bearer {at}"}
    # 找一个测试班级
    r = ctx.get(f"{BASE}/classes?keyword=e2e_test_测试班级", headers=H)
    print("班级查询:", r.status, str(r.json())[:200])
    classes = (r.json().get("data") or {}).get("list") or r.json().get("data") or []
    print("班级数:", len(classes))
    for c in classes[:3]:
        cid = c["id"]
        r2 = ctx.put(f"{BASE}/classes/{cid}", headers=H, data={"name": "e2e_test_测试班级改", "grade": "2026级"})
        print(f"PUT /classes/{cid}: {r2.status} {str(r2.json())[:150]}")
        r3 = ctx.get(f"{BASE}/classes/{cid}/students", headers=H)
        print(f"GET /classes/{cid}/students: {r3.status} {str(r3.json())[:250]}")
    ctx.dispose()
