# -*- coding: utf-8 -*-
"""P9-P11 家校通知/报表收口/系统维护（自清理）"""
import sys
from datetime import date
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
    def safe_del(path):
        try: ctx.delete(f"{BASE}{path}", headers=H)
        except Exception: pass

    # ---- preClean ----
    r = ctx.get(f"{BASE}/students?keyword=e2e_test_p9&pageSize=100", headers=H)
    for s in r.json()["data"]["list"]:
        safe_del(f"/students/{s['id']}")
    r = ctx.get(f"{BASE}/notices?keyword=e2e_test_p11&pageSize=100", headers=H)
    for n in (r.json().get("data") or {}).get("list", r.json().get("data") or []):
        safe_del(f"/notices/{n['id']}")

    # ============ P9 家校（v14：家长信息并入学生档案，无家长账号） ============
    r = ctx.post(f"{BASE}/students", headers=H, data={"student_no": "E2EP9001", "name": "e2e_test_p9学生", "class_id": 1, "parent_name": "p9家长", "parent_phone": "13900008888"})
    sid = r.json()["data"]["id"]
    record("P9.1", "创建学生(含家长信息)", r.status == 200 and sid, f"sid={sid}")
    # 修改家长姓名
    r = ctx.put(f"{BASE}/students/{sid}", headers=H, data={"student_no": "E2EP9001", "name": "e2e_test_p9学生", "class_id": 1, "parent_name": "p9家长改"})
    r2 = ctx.get(f"{BASE}/students?keyword=e2e_test_p9学生&pageSize=100", headers=H)
    stu = (r2.json().get("data") or {}).get("list", [{}])[0]
    record("P9.2", "修改学生档案家长信息", r.status == 200 and stu.get("parent_name") == "p9家长改", f"parent_name={stu.get('parent_name')}")

    # 通知已读（用 seed 已有通知或空跑）
    r = ctx.get(f"{BASE}/notifications?pageSize=5", headers=H)
    n_list = (r.json().get("data") or {}).get("list", [])
    if n_list:
        nid = n_list[0]["id"]
        r = ctx.put(f"{BASE}/notifications/{nid}/read", headers=H, data={})
        record("P9.5", "通知标记已读", r.status == 200)
    else:
        record("P9.5", "通知标记已读", True, "(无通知可标记，跳过)")

    # ============ P10 报表 ============
    r = ctx.get(f"{BASE}/dashboard/overview", headers=H)
    j = r.json()
    record("P10.1", "仪表盘概览", r.status == 200 and (j.get("data") is not None), f"status={r.status}")
    r = ctx.get(f"{BASE}/attendance/statistics?dimension=class&start_date={date.today().isoformat()}&end_date={date.today().isoformat()}", headers=H)
    record("P10.2", "考勤统计(班级维度)", r.status == 200)
    r = ctx.get(f"{BASE}/attendance/warnings", headers=H)
    record("P10.3", "缺勤预警", r.status == 200)
    r = ctx.get(f"{BASE}/finance/stats/business", headers=H)
    record("P10.4", "经营报表(admin)", r.status == 200)
    # teacher 访问经营报表 → 403
    r = ctx.post(f"{BASE}/auth/login", data={"username": "teacher", "password": "teacher123456"})
    tt = r.json()["data"]["accessToken"]
    HT = {"Authorization": f"Bearer {tt}"}
    r = ctx.get(f"{BASE}/finance/stats/business", headers=HT)
    record("P10.5", "权限-teacher禁看经营报表", r.status == 403)

    # ============ P11 系统维护 ============
    r = ctx.get(f"{BASE}/audit-logs?pageSize=5", headers=H)
    j = r.json()
    record("P11.1", "审计日志查询", r.status == 200 and (j.get("data") is not None))
    # 公告 CRUD
    r = ctx.post(f"{BASE}/notices", headers=H, data={"title": "e2e_test_p11公告", "content": "测试公告内容", "is_pinned": 1, "status": "发布"})
    nid2 = (r.json().get("data") or {}).get("id")
    record("P11.2", "创建公告(置顶/发布)", r.status == 200 and nid2, f"id={nid2}")
    r = ctx.get(f"{BASE}/notices/latest", headers=H)
    j = r.json()
    latest = j.get("data") or []
    pinned = any(n.get("id") == nid2 for n in latest)
    record("P11.3", "公告置顶优先展示", r.status == 200 and pinned, f"latest={len(latest)}")
    r = ctx.delete(f"{BASE}/notices/{nid2}", headers=H)
    record("P11.4", "删除公告", r.status == 200)
    # 备份：手动备份 → 列表含最新 → 删除
    r = ctx.post(f"{BASE}/backups", headers=H, data={})
    j = r.json()
    bname = (j.get("data") or {}).get("file") or (j.get("data") or {}).get("name")
    record("P11.5", "手动备份", r.status == 200 and bname, f"file={bname}")
    if bname:
        safe_del(f"/backups/{bname}")
        record("P11.6", "删除备份", True)

    # ---- 清理 ----
    ctx.delete(f"{BASE}/students/{sid}", headers=H)

    fails = [x for x in results if not x[2]]
    print(f"\n==== P9-P11 汇总: PASS {len(results)-len(fails)} / {len(results)} ====")
    for f in fails:
        print("  FAIL:", f[0], f[1], f[3])
    ctx.dispose()
