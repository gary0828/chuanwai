# -*- coding: utf-8 -*-
"""API 冒烟测试：登录 + 核心模块列表接口 + 关键权限校验"""
import requests, sys

BASE = "http://localhost:3000"
results = []

def check(no, name, ok, detail=""):
    results.append((no, name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {no} {name} {detail}")

# 1. 健康检查
try:
    r = requests.get(f"{BASE}/api/health", timeout=10)
    check(1, "健康检查", r.status_code == 200 and r.json().get("data", {}).get("status") == "ok")
except Exception as e:
    check(1, "健康检查", False, str(e))

# 2. 登录
try:
    r = requests.post(f"{BASE}/api/auth/login", json={"username": "admin", "password": "admin123456"}, timeout=10)
    token = r.json().get("data", {}).get("accessToken")
    check(2, "admin 登录", r.status_code == 200 and bool(token))
except Exception as e:
    check(2, "admin 登录", False, str(e))
    sys.exit(1)

headers = {"Authorization": f"Bearer {token}"}

# 3. 核心模块列表
modules = ["users", "students", "classes", "courses", "leaves", "schedules", "terms", "settings", "notices", "finance/orders", "leads", "notifications", "exams"]
for i, m in enumerate(modules, start=3):
    try:
        r = requests.get(f"{BASE}/api/{m}", headers=headers, timeout=10)
        ok = r.status_code in (200, 204) and r.json().get("success") is True
        check(i, f"GET /api/{m}", ok, f"status={r.status_code}")
    except Exception as e:
        check(i, f"GET /api/{m}", False, str(e))

# 3b. 考勤列表需要 date 参数（业务必填校验）
try:
    r = requests.get(f"{BASE}/api/attendance", headers=headers, params={"date": "2026-08-14", "class_id": 1, "course_id": 1}, timeout=10)
    check(16, "GET /api/attendance 带参", r.status_code == 200 and r.json().get("success") is True, f"status={r.status_code}")
except Exception as e:
    check(16, "GET /api/attendance 带参", False, str(e))

# 4. 教师账号登录 + 权限校验
try:
    r = requests.post(f"{BASE}/api/auth/login", json={"username": "teacher", "password": "teacher123456"}, timeout=10)
    t_token = r.json().get("data", {}).get("accessToken")
    check(19, "teacher 登录", r.status_code == 200 and bool(t_token))
    if t_token:
        t_headers = {"Authorization": f"Bearer {t_token}"}
        # teacher 不能访问 users（admin 专属）
        r2 = requests.get(f"{BASE}/api/users", headers=t_headers, timeout=10)
        check(20, "teacher 访问 /api/users 应被拒绝", r2.status_code == 403, f"status={r2.status_code}")
except Exception as e:
    check(19, "teacher 登录/权限", False, str(e))

# 5. v14 关键数据校验：users 只有 admin/teacher，students 有 parent_name 列
try:
    r = requests.get(f"{BASE}/api/users", headers=headers, timeout=10)
    roles = [u.get("role") for u in r.json().get("data", {}).get("list", [])]
    check(21, "users 角色无 student/parent", "student" not in roles and "parent" not in roles, f"roles={roles}")
    r = requests.get(f"{BASE}/api/students", headers=headers, timeout=10)
    first = r.json().get("data", {}).get("list", [{}])[0]
    check(22, "students 含 parent_name 字段", "parent_name" in first, f"keys={list(first.keys())[:5]}...")
except Exception as e:
    check(21, "v14 数据校验", False, str(e))

print("=" * 40)
passed = sum(1 for _, _, ok, _ in results if ok)
print(f"总计: {passed}/{len(results)} 通过")
sys.exit(0 if passed == len(results) else 1)
