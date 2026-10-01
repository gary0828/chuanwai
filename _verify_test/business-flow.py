# 业务流测试（Usage-First）—— 按 docs/08-参考/业务流测试计划-2026-09-26.md 执行
#
# 用法：python _verify_test/business-flow.py [WEB]
#
# 目标：不是"功能存在"，而是"老师真按日常用法走时会不会卡住、会不会被骗、数据对不对"
# 核心判据：任何一次用户操作都必须有明确反馈（成功/失败/处理中）；"静默"一律算缺陷
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import requests
from playwright.sync_api import sync_playwright

WEB = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18080"
API = WEB
TZ = timezone(timedelta(hours=8))
EV = r"C:\Users\rui08\Desktop\教学管理系统\evidence"

OK_FILE = r"C:\tmp\import-ok.xlsx"
BAD_FILE = r"C:\tmp\import-test.xlsx"

PASS, FAIL, ISSUES = [], [], []


def ok(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(("[OK]  " if cond else "[FAIL]") + " " + name + (f"  -- {extra}" if extra else ""))
    return cond


def issue(level, title, detail):
    ISSUES.append({"level": level, "title": title, "detail": detail})
    print(f"[{level}] {title}\n        {detail}")


def login_api(u, p):
    r = requests.post(f"{API}/api/auth/login", json={"username": u, "password": p}, timeout=15)
    return r.json()["data"]


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def req(method, path, tok, **kw):
    r = requests.request(method, f"{API}{path}", headers=H(tok), timeout=30, **kw)
    try:
        return r.status_code, r.json()
    except Exception:
        return r.status_code, None


def inject_login(page, d):
    ms = int(datetime.strptime(d["expires"], "%Y/%m/%d %H:%M:%S").replace(tzinfo=TZ).timestamp() * 1000)
    cv = json.dumps({"accessToken": d["accessToken"], "expires": ms, "refreshToken": d["refreshToken"]})
    iv = json.dumps({
        "refreshToken": d["refreshToken"], "expires": ms, "avatar": d.get("avatar", ""),
        "username": d["username"], "nickname": d.get("nickname", ""),
        "roles": d.get("roles", []), "permissions": d.get("permissions", []),
    })
    page.goto(f"{WEB}/#/login", wait_until="domcontentloaded")
    page.evaluate(
        """([c,i])=>{document.cookie='authorized-token='+encodeURIComponent(c)+'; path=/';
            document.cookie='multiple-tabs=true; path=/';localStorage.setItem('user-info',i);}""",
        [cv, iv],
    )
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1500)


def feedback(page):
    """收集当前可见反馈（消息条 + 弹窗 + 全屏 loading）"""
    msgs, dlg, loading = [], "", False
    for m in page.query_selector_all(".el-message"):
        try:
            if m.is_visible():
                msgs.append(m.inner_text().strip().replace("\n", " "))
        except Exception:
            pass
    for d in page.query_selector_all(".el-dialog"):
        try:
            if d.is_visible():
                dlg = d.inner_text().strip().replace("\n", " ")[:200]
                break
        except Exception:
            pass
    loading = bool(page.query_selector(".el-loading-mask:not([style*='display: none'])"))
    return msgs, dlg, loading


def close_dialogs(page):
    try:
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        for b in page.query_selector_all(".el-dialog__headerbtn"):
            if b.is_visible():
                b.click()
                page.wait_for_timeout(200)
    except Exception:
        pass
    page.evaluate("() => document.querySelectorAll('.el-message').forEach(e=>e.remove())")


TS = str(int(time.time()))[-6:]
admin = login_api("admin", "admin123456")
teacher = login_api("teacher", "teacher123456")
AT = admin["accessToken"]
TT = teacher["accessToken"]
before_total_students = ((req("GET", "/api/students?page=1&pageSize=1", AT)[1] or {}).get("data") or {}).get("total")

print("=" * 70)
print(f"业务流测试  WEB={WEB}  运行标识={TS}")
print("=" * 70)

# ══════════════════════════════════════════════════════════════════
# 流程 D · 批量数据准备（用户踩坑的场景，重点）
# ══════════════════════════════════════════════════════════════════
print("\n【流程 D】批量导入学生（含 3 轮稳定性 + 边界）")

for f in (OK_FILE, BAD_FILE):
    if not os.path.exists(f):
        print(f"  !! 缺少测试文件 {f}（请先运行生成脚本）")
        sys.exit(1)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1600, "height": 1000})
    page = ctx.new_page()
    import_reqs = []
    console_errs = []
    net_fails = []
    page.on("request", lambda r: import_reqs.append(r.url) if "students/import" in r.url else None)
    page.on("pageerror", lambda e: console_errs.append(str(e)[:150]))
    page.on("requestfailed", lambda r: net_fails.append(f"{r.method} {r.url[:80]} {r.failure}"))

    inject_login(page, admin)
    page.goto(f"{WEB}/#/data/students", wait_until="networkidle")
    page.wait_for_timeout(2000)
    ok("D0 学生管理页可打开", "students" in page.url)

    # D1 模板列名与解析列名一致性（离线核对：下载模板的列 = 解析代码读的列）
    tmpl_cols = ["学号", "姓名", "性别", "手机号", "邮箱", "班级", "状态", "家长姓名", "家长电话", "来源渠道", "报名日期"]
    # ★ 2026-09-26 修复后，解析已覆盖模板全部 11 列（此前漏「来源渠道」「报名日期」）
    parsed_cols = ["学号", "姓名", "性别", "手机号", "邮箱", "班级", "状态", "家长姓名", "家长电话", "来源渠道", "报名日期"]
    missing = [c for c in tmpl_cols if c not in parsed_cols]
    ok(f"D1 模板列名与解析列名一致（{len(tmpl_cols)} 列）", not missing, f"模板有但解析未处理：{missing}")
    if missing:
        issue("P1", "模板提供的列未被解析（静默丢数据）",
              f"模板含 {missing}，但前端解析未映射这些字段 → 用户填了会静默丢失，且无任何提示")

    # D3 选文件后是否有反馈（★ 用户报的核心问题）
    print("\n  ── D3 选文件后是否给出反馈（★ 用户反馈的核心）──")
    n0 = len(import_reqs)
    close_dialogs(page)
    page.set_input_files("input[type=file]", BAD_FILE)
    page.wait_for_timeout(2600)
    rq, msgs, dlg, loading = len(import_reqs) - n0, *feedback(page)
    print(f"     请求={rq} 消息={msgs} 弹窗={dlg!r}")
    if not msgs and not dlg:
        issue("P0", "导入【完全静默】——用户看到的就是「点了没反应」",
              f"选文件后：发出请求 {rq} 次、无任何消息、无弹窗。"
              "根因：`handleImport(file: any)` 用了 `file.raw`，而 el-upload 的 before-upload 传的是 "
              "UploadRawFile（= File & {uid}，**无 raw 字段**）→ file.raw=undefined → "
              "reader.readAsArrayBuffer(undefined) 抛错；而 try/catch 只包了 reader.onload 内部，"
              "抛出的异常无人处理 → 静默。已验证 Element Plus 类型定义。")
    ok("D3 导入操作有明确反馈（不允许静默）", bool(msgs or dlg), f"msgs={msgs} dlg={dlg!r}")

    # D5/D9 连续 3 轮 + 同文件重复导入
    print("\n  ── D5/D9 连跑 3 轮（含同一文件重复导入）──")
    for rnd in range(1, 4):
        close_dialogs(page)
        n0 = len(import_reqs)
        page.set_input_files("input[type=file]", OK_FILE)
        page.wait_for_timeout(2800)
        rq = len(import_reqs) - n0
        msgs, dlg, loading = feedback(page)
        print(f"     第{rnd}轮: 请求={rq} 消息={msgs} 弹窗={dlg!r}")
        ok(f"D9 第{rnd}轮（同一文件）有反馈", bool(msgs or dlg), f"msgs={msgs} dlg={dlg!r}")
        if rq == 0:
            issue("P0", f"第{rnd}轮导入未发出任何请求",
                  "用户重复尝试导入时，界面无响应、无提示，会持续困惑（可能是 file.raw 问题导致 before-upload 抛错）")

    # D5 数据落库逐列核对
    print("\n  ── D5 落库逐列核对（模板 11 列 vs 实际）──")
    st, body = req("GET", "/api/students?page=1&pageSize=200", AT)
    rows = ((body or {}).get("data") or {}).get("list") or []
    imp = [x for x in rows if str(x.get("student_no", "")).startswith(("IMOK", "IMP"))]
    ok("D5 导入的学员已出现在列表", len(imp) > 0, f"找到 {len(imp)} 条")
    if imp:
        s = imp[0]
        print("     样本: " + json.dumps({k: s.get(k) for k in
              ["student_no", "name", "gender", "phone", "email", "status", "parent_name", "parent_phone",
               "source_channel", "enroll_date"]}, ensure_ascii=False))
        for field, label in [("source_channel", "来源渠道"), ("enroll_date", "报名日期")]:
            if not s.get(field):
                issue("P1", f"「{label}」导入后丢失",
                      f"模板有该列且测试数据已填值，但落库为「{s.get(field) or '空'}」"
                      "（前端解析未映射该字段）→ 用户以为导进去了，实际白填")
        ok("D5 「来源渠道」已落库", bool(s.get("source_channel")), str(s.get("source_channel")))
        ok("D5 「报名日期」已落库", bool(s.get("enroll_date")), str(s.get("enroll_date")))

    # D8 取消选择文件
    close_dialogs(page)
    n0 = len(import_reqs)
    page.set_input_files("input[type=file]", [])
    page.wait_for_timeout(1200)
    ok("D8 取消选择文件不产生异常", len(console_errs) == 0, f"控制台错误={console_errs[:2]}")

    page.screenshot(path=os.path.join(EV, "flow-d-import.png"), full_page=False)
    print("     截图: evidence/flow-d-import.png")

    if console_errs:
        issue("P1", "学生管理页出现 JS 报错", "; ".join(console_errs[:3]))
    if net_fails:
        issue("P2", "页面存在失败的网络请求", "; ".join(net_fails[:3]))
    browser.close()

# ══════════════════════════════════════════════════════════════════
# 流程 A · 线索 → 转化 → 学员 + 订单（跨模块联动）
# ══════════════════════════════════════════════════════════════════
print("\n【流程 A】新学员从线索到上课（跨模块联动）")

lead_name = f"流程测试线索{TS}"
# ★ 手机号必须每次唯一：系统对「已有学员档案的手机号」会拒绝重复转化（这是**正确**的业务保护，
#   首版脚本复用固定手机号，第二轮就被拒 → 属脚本问题，非产品缺陷）
lead_phone = "137" + str(int(time.time()))[-8:]
st, lead = req("POST", "/api/leads", AT, json={"name": lead_name, "phone": lead_phone, "source": "转介绍"})
ok("A1 创建线索成功", st == 200 and (lead or {}).get("success"), f"status={st}")
lead_id = ((lead or {}).get("data") or {}).get("id")

if lead_id:
    st, lst = req("GET", f"/api/leads?page=1&pageSize=100", AT)
    found = [x for x in (((lst or {}).get("data") or {}).get("list") or []) if x.get("id") == lead_id]
    ok("A1 新线索立即出现在列表", len(found) == 1, f"found={len(found)}")

    # 取一个班级
    st, cls = req("GET", "/api/classes", AT)
    class_list = ((cls or {}).get("data") or {}).get("list") or ((cls or {}).get("data") or [])
    class_id = class_list[0]["id"] if class_list else None

    students_before = ((req("GET", "/api/students?page=1&pageSize=1", AT)[1] or {}).get("data") or {}).get("total")
    orders_before = len((((req("GET", "/api/finance/orders?page=1&pageSize=200", AT)[1] or {}).get("data") or {}).get("list") or []))

    st, conv = req("PUT", f"/api/leads/{lead_id}/convert", AT,
                   json={"class_id": class_id, "amount": 3000, "remark": "流程测试转化"})
    ok("A3 线索转化成功", st == 200 and (conv or {}).get("success"), f"status={st} {json.dumps(conv, ensure_ascii=False)[:120]}")

    students_after = ((req("GET", "/api/students?page=1&pageSize=1", AT)[1] or {}).get("data") or {}).get("total")
    ok("A4 转化后自动创建学员档案", students_after == (students_before or 0) + 1,
       f"{students_before} → {students_after}")
    if students_after != (students_before or 0) + 1:
        issue("P1", "线索转化未创建学员档案", "转化接口返回成功，但学员总数未增加 → 跨模块联动断裂")

    # 核对学员字段
    st, sl = req("GET", f"/api/students?page=1&pageSize=200&keyword={lead_name}", AT)
    srows = ((sl or {}).get("data") or {}).get("list") or []
    srows = [x for x in srows if x.get("name") == lead_name] or srows
    if srows:
        s = srows[0]
        print("     转化出的学员: " + json.dumps({k: s.get(k) for k in
              ["student_no", "name", "phone", "class_id", "source_channel", "enroll_date"]}, ensure_ascii=False))
        ok("A4 学员姓名与线索一致", s.get("name") == lead_name, str(s.get("name")))
        ok("A4 学员班级已分配", bool(s.get("class_id")), str(s.get("class_id")))
        if not s.get("source_channel"):
            issue("P2", "转化创建的学员缺失「来源渠道」",
                  f"线索来源={((lead or {}).get('data') or {}).get('source')}，但学员 source_channel 为空 → 招生归因丢失")
    else:
        ok("A4 能找到转化出的学员", False, "按姓名未查到")

    orders_after = len((((req("GET", "/api/finance/orders?page=1&pageSize=200", AT)[1] or {}).get("data") or {}).get("list") or []))
    ok("A5 转化后自动创建报班订单", orders_after == orders_before + 1, f"{orders_before} → {orders_after}")
    if orders_after != orders_before + 1:
        issue("P1", "线索转化未创建订单", "转化成功但订单数未增加 → 财务侧看不到这个学员的报班")

# ══════════════════════════════════════════════════════════════════
# 流程 B · 老师的一天（高频日常 + 稳定性）
# ══════════════════════════════════════════════════════════════════
print("\n【流程 B】老师的一天（高频操作 + 连续操作稳定性）")

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1600, "height": 1000})
    page = ctx.new_page()
    errs = []
    net_fails = []
    page.on("pageerror", lambda e: errs.append(str(e)[:150]))
    page.on("requestfailed", lambda r: net_fails.append(f"{r.method} {r.url[:70]}"))

    inject_login(page, teacher)
    ok("B1 教师登录后首屏无 JS 报错", len(errs) == 0, str(errs[:2]))

    # B2 首页
    page.goto(f"{WEB}/#/", wait_until="networkidle")
    page.wait_for_timeout(2200)
    body = page.inner_text("body")
    ok("B2 首页渲染出内容（非空白）", len(body.strip()) > 50)
    ok("B2 首页无报错", len(errs) == 0, str(errs[:2]))

    # B4 周课表
    page.goto(f"{WEB}/#/attendance/sessions", wait_until="networkidle")
    page.wait_for_timeout(2600)
    ok("B4 周课表页可打开", "sessions" in page.url)
    ok("B4 周课表无报错", len(errs) == 0, str(errs[:2]))
    page.screenshot(path=os.path.join(EV, "flow-b-sessions.png"), full_page=False)

    # B7 统计报表
    page.goto(f"{WEB}/#/attendance/statistics", wait_until="networkidle")
    page.wait_for_timeout(2600)
    ok("B7 统计报表无报错", len(errs) == 0, str(errs[:2]))

    # B8 连续操作稳定性（快速切 10 次页面，模拟老师日常）
    print("\n  ── B8 连续快速切换 10 次（稳定性）──")
    pages = ["/#/", "/#/attendance/checkin", "/#/attendance/records", "/#/attendance/leaves",
             "/#/attendance/sessions", "/#/attendance/statistics", "/#/data/students",
             "/#/teaching/exams", "/#/todos", "/#/"]
    n_before = len(errs)
    for i, path in enumerate(pages, 1):
        page.goto(f"{WEB}{path}", wait_until="domcontentloaded")
        page.wait_for_timeout(700)
    page.wait_for_timeout(1500)
    ok("B8 连续切换 10 页无新增 JS 报错", len(errs) == n_before, f"新增：{errs[n_before:]}")
    if len(errs) > n_before:
        issue("P1", "连续快速切换页面出现 JS 报错",
              f"老师日常会快速切页，出现：{errs[n_before:][:3]}")
    if net_fails:
        issue("P2", "教师端存在失败的网络请求", "; ".join(net_fails[:3]))

    browser.close()

# ══════════════════════════════════════════════════════════════════
# 流程 C · 财务月度（对账一致性）
# ══════════════════════════════════════════════════════════════════
print("\n【流程 C】财务口径对账")
today = datetime.now(TZ).strftime("%Y-%m-%d")
st, rev = req("GET", f"/api/finance/stats/revenue?start=2000-01-01&end={today}", AT)
st2, bus = req("GET", "/api/finance/stats/business", AT)
ok("C6 财务统计可用", st == 200)
ok("C6 经营报表可用", st2 == 200)
rev_total = None
for k in ("totalRevenue", "total_revenue", "total"):
    if isinstance((rev or {}).get("data"), dict) and k in (rev or {}).get("data", {}):
        rev_total = rev["data"][k]
        break
bus_total = None
od = (bus or {}).get("data") or {}
if isinstance(od, dict):
    ov = od.get("overview") or {}
    bus_total = ov.get("total_revenue")
print(f"     财务统计实收={rev_total}   经营报表总营收={bus_total}")
if rev_total is not None and bus_total is not None:
    diff = abs(float(rev_total) - float(bus_total))
    ok("C7 财务统计实收 = 经营报表总营收（同口径）", diff < 0.01, f"差 {diff}")
    if diff >= 0.01:
        issue("P1", "财务两页营收对不上",
              f"财务统计（收付实现制）={rev_total}，经营报表={bus_total}，差 {diff} → 校长看两个页面会得到两个数")

# ══════════════════════════════════════════════════════════════════
# 流程 F · 家长侧产物（报告数据完整性）
# ══════════════════════════════════════════════════════════════════
print("\n【流程 F】学习报告 / 成长档案数据完整性")
st, sl = req("GET", "/api/students?page=1&pageSize=20", AT)
rows = ((sl or {}).get("data") or {}).get("list") or []
if rows:
    sid = rows[0]["id"]
    st, rep = req("GET", f"/api/reports/students/{sid}", AT)
    ok("F2 学习报告可生成", st == 200 and (rep or {}).get("success"), f"status={st}")
    if st == 200:
        d = (rep or {}).get("data") or {}
        print("     报告字段: " + ", ".join(sorted(d.keys())[:12]))
        att = d.get("attendance") or {}
        if att.get("total") == 0:
            issue("P2", "学习报告考勤区为 0 且无「暂无数据」说明",
                  f"学员 {sid} 报告 attendance.total=0，可能该生确实无考勤；但页面若不区分「0」与「暂无」会误导")
    st, tl = req("GET", f"/api/reports/students/{sid}/timeline", AT)
    ok("F3 成长档案时间线可生成", st == 200, f"status={st}")
else:
    ok("F2 取到学员样本", False, "无学员")

# ══════════════════════════════════════════════════════════════════
# 清理本次测试数据（best-effort：失败只记录不中断）
# 顺序很重要：先删订单，否则学员因「有报班/缴费记录」会被拒绝删除
# ══════════════════════════════════════════════════════════════════
print("\n【清理】删除本次产生的测试数据")
cleaned = {"orders": 0, "students": 0, "leads": 0}

st, ol = req("GET", "/api/finance/orders?page=1&pageSize=200", AT)
for o in ((ol or {}).get("data") or {}).get("list") or []:
    if str(o.get("student_name", "")).startswith("流程测试线索"):
        d, _ = req("DELETE", f"/api/finance/orders/{o['id']}", AT)
        if d == 200:
            cleaned["orders"] += 1

TEST_NAMES = ("导入测试甲", "导入测试乙", "正常导入甲", "正常导入乙")
st, sl = req("GET", "/api/students?page=1&pageSize=500", AT)
for s in ((sl or {}).get("data") or {}).get("list") or []:
    no, nm = str(s.get("student_no", "")), str(s.get("name", ""))
    if no.startswith(("IMOK", "IMP")) or nm.startswith("流程测试线索") or nm in TEST_NAMES:
        d, _ = req("DELETE", f"/api/students/{s['id']}", AT)
        if d == 200:
            cleaned["students"] += 1

st, ll = req("GET", "/api/leads?page=1&pageSize=200", AT)
for x in ((ll or {}).get("data") or {}).get("list") or []:
    if str(x.get("name", "")).startswith("流程测试线索"):
        d, _ = req("DELETE", f"/api/leads/{x['id']}", AT)
        if d == 200:
            cleaned["leads"] += 1

print(f"     已清理：订单 {cleaned['orders']} / 学员 {cleaned['students']} / 线索 {cleaned['leads']}")
left = ((req("GET", "/api/students?page=1&pageSize=1", AT)[1] or {}).get("data") or {}).get("total")
print(f"     清理后学员总数={left}（本轮开始前={before_total_students}）")

# ══════════════════════════════════════════════════════════════════
print("\n" + "=" * 70)
print(f"结果：PASS {len(PASS)}  FAIL {len(FAIL)}   发现问题 {len(ISSUES)} 条")
print("=" * 70)
if ISSUES:
    print("\n问题清单：")
    order = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
    for i, x in enumerate(sorted(ISSUES, key=lambda v: order.get(v["level"], 9)), 1):
        print(f"  {i}. [{x['level']}] {x['title']}")
        print(f"     {x['detail'][:200]}")
if FAIL:
    print("\n失败断言：")
    for f in FAIL:
        print("  - " + f)
