# 「批量导入学生无反应」复现与诊断
#
# 用法：python _verify_test/repro-student-import.py [WEB]
#
# 复现用户反馈：「批量上传学生信息的时候，没有任何反应」
# 诊断手段：
#   ① 监听 /api/students/import 请求 → 判断"没反应"时到底有没有发请求
#   ② 检查 input[type=file].value 是否被重置 → 判断真实用户"重选同一文件"会不会
#      因 change 不触发而完全静默（HTML 原生行为：同名文件不触发 change）
#   ③ 抓取 el-message / 弹窗 → 判断用户能否得到反馈
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import requests
from playwright.sync_api import sync_playwright

WEB = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18080"
API = WEB
TZ = timezone(timedelta(hours=8))
EV = r"C:\Users\rui08\Desktop\教学管理系统\evidence"

OK_FILE = "/tmp/import-ok.xlsx"
BAD_FILE = "/tmp/import-test.xlsx"

PASS, FAIL, FINDINGS = [], [], []


def ok(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(("[OK]  " if cond else "[FAIL]") + " " + name + (f"  -- {extra}" if extra else ""))
    return cond


def finding(name, detail):
    FINDINGS.append((name, detail))
    print(f"[发现] {name}\n        {detail}")


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


def login_api(u, p):
    r = requests.post(f"{API}/api/auth/login", json={"username": u, "password": p}, timeout=15)
    return r.json()["data"]


def student_count(token):
    r = requests.get(f"{API}/api/students?page=1&pageSize=1",
                     headers={"Authorization": f"Bearer {token}"}, timeout=15)
    return r.json().get("data", {}).get("total")


admin = login_api("admin", "admin123456")
before_total = student_count(admin["accessToken"])
print(f"[info] WEB={WEB}  导入前学员总数={before_total}")

os.makedirs(EV, exist_ok=True)


def read_feedback(page):
    """收集当前页面上所有可见反馈（消息条 + 弹窗）"""
    msgs = []
    for m in page.query_selector_all(".el-message"):
        try:
            if m.is_visible():
                msgs.append(m.inner_text().strip().replace("\n", " "))
        except Exception:
            pass
    dlg_text = ""
    for d in page.query_selector_all(".el-dialog"):
        try:
            if d.is_visible():
                dlg_text = d.inner_text().strip().replace("\n", " ")[:160]
                break
        except Exception:
            pass
    return msgs, dlg_text


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1600, "height": 1000})
    page = ctx.new_page()

    import_reqs = []
    page.on("request", lambda r: import_reqs.append(r.url) if "students/import" in r.url else None)
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))

    inject_login(page, admin)
    page.goto(f"{WEB}/#/data/students", wait_until="networkidle")
    page.wait_for_timeout(2200)
    ok("学生管理页可打开", "students" in page.url, page.url)

    # 关掉可能存在的旧消息
    page.evaluate("() => document.querySelectorAll('.el-message').forEach(e=>e.remove())")

    # ────────────── 场景 1：含 1 行错误班级 → 前端应拦截并提示 ──────────────
    print("\n=== 场景 1：导入含「班级名不存在」的文件（3 行，1 行班级错误）===")
    n0 = len(import_reqs)
    page.set_input_files("input[type=file]", BAD_FILE)
    page.wait_for_timeout(2600)
    reqs1 = len(import_reqs) - n0
    msgs1, dlg1 = read_feedback(page)
    print(f"     发出 import 请求数={reqs1}  消息={msgs1}  弹窗={dlg1!r}")
    ok("场景1：有明确反馈（消息或弹窗）", bool(msgs1 or dlg1), f"msgs={msgs1} dlg={dlg1!r}")
    if not msgs1 and not dlg1:
        finding("含错误班级的导入完全无反馈", "既无消息也无弹窗，用户会认为『点了没反应』")
    ok("场景1：前端拦截，未发请求（班级不匹配应整体拒绝）", reqs1 == 0, f"实际发请求 {reqs1} 次")

    page.evaluate("() => document.querySelectorAll('.el-message').forEach(e=>e.remove())")

    # ────────────── 场景 2：全部正确 → 应成功 ──────────────
    print("\n=== 场景 2：导入全部正确的文件（2 行）===")
    n0 = len(import_reqs)
    page.set_input_files("input[type=file]", OK_FILE)
    page.wait_for_timeout(3000)
    reqs2 = len(import_reqs) - n0
    msgs2, dlg2 = read_feedback(page)
    print(f"     发出 import 请求数={reqs2}  消息={msgs2}  弹窗={dlg2!r}")
    ok("场景2：发出了 import 请求", reqs2 == 1, f"实际 {reqs2}")
    ok("场景2：出现导入结果反馈", bool(dlg2 or msgs2), f"msgs={msgs2} dlg={dlg2!r}")
    if dlg2 and "失败" in dlg2:
        finding("正确数据也报失败", dlg2)

    # ★ 关键检查：导入后 input[type=file] 的 value 是否被重置
    input_val = page.eval_on_selector("input[type=file]", "el => el.value")
    print(f"     导入后 input[type=file].value = {input_val!r}")
    if input_val:
        finding(
            "同文件二次导入会『完全无反应』（高风险，与用户反馈吻合）",
            f"before-upload 返回 false 后 input.value 未被重置（当前={input_val!r}）。"
            "HTML 原生行为：用户再次选择**同一个文件**时 change 事件不触发 → "
            "before-upload 根本不会被调用 → 页面上不会有任何提示，用户看到的就是『点了没反应』。"
        )

    # ────────────── 场景 3：同样的操作再来一次（模拟用户重试）──────────────
    print("\n=== 场景 3：再次导入同一个文件（模拟用户『没反应就再点一次』）===")
    page.evaluate("() => document.querySelectorAll('.el-message').forEach(e=>e.remove())")
    n0 = len(import_reqs)
    page.set_input_files("input[type=file]", OK_FILE)
    page.wait_for_timeout(3000)
    reqs3 = len(import_reqs) - n0
    msgs3, dlg3 = read_feedback(page)
    print(f"     发出 import 请求数={reqs3}  消息={msgs3}  弹窗={dlg3!r}")
    # 注：Playwright 的 set_input_files 会强制派发 change，故此处必然触发；
    #     真实用户点选同一文件时不一定 —— 这正是上面 input.value 检查的意义。

    # 关闭弹窗
    try:
        if page.query_selector(".el-dialog"):
            for b in page.query_selector_all(".el-dialog button"):
                if "确定" in b.inner_text() or "关闭" in b.inner_text():
                    b.click()
                    break
            page.keyboard.press("Escape")
    except Exception:
        pass
    page.wait_for_timeout(500)

    after_total = student_count(admin["accessToken"])
    print(f"\n[info] 导入后学员总数={after_total}（导入前 {before_total}）")

    # ────────────── 场景 4：数据完整性 —— 模板里的两列是否真的写进去了 ──────────────
    print("\n=== 场景 4：核对导入结果的数据完整性（模板 11 列 vs 实际落库）===")
    # 取刚导入的学员
    r = requests.get(f"{API}/api/students?page=1&pageSize=50&keyword=IMOK",
                     headers={"Authorization": f"Bearer {admin['accessToken']}"}, timeout=15)
    rows = (r.json().get("data") or {}).get("list") or []
    if not rows:
        r = requests.get(f"{API}/api/students?page=1&pageSize=200",
                         headers={"Authorization": f"Bearer {admin['accessToken']}"}, timeout=15)
        rows = [x for x in ((r.json().get("data") or {}).get("list") or [])
                if str(x.get("student_no", "")).startswith("IMOK")]
    if rows:
        s = rows[0]
        print("     落库样本: " + json.dumps({k: s.get(k) for k in
              ["student_no", "name", "gender", "phone", "email", "status",
               "parent_name", "parent_phone", "source_channel", "enroll_date"]}, ensure_ascii=False))
        if not s.get("source_channel"):
            finding("模板的「来源渠道」列被静默丢弃",
                    "导入模板含该列、用户也填了值，但前端解析未映射该字段 → 落库为空，且无任何提示")
        else:
            ok("「来源渠道」已正确落库", True, str(s.get("source_channel")))
        if not s.get("enroll_date"):
            finding("模板的「报名日期」列被静默丢弃",
                    "同上：模板有该列、用户填了值，但前端解析未映射 → 落库为空")
        else:
            ok("「报名日期」已正确落库", True, str(s.get("enroll_date")))
    else:
        ok("找到刚导入的学员样本（用于数据完整性核对）", False, "未找到 IMOK 开头的学员")

    page.screenshot(path=os.path.join(EV, "repro-import-result.png"), full_page=False)
    print("     截图: evidence/repro-import-result.png")

    if errs:
        finding("页面出现 JS 报错", "; ".join(errs[:3]))
    browser.close()

print("\n" + "=" * 60)
print(f"断言：PASS {len(PASS)}  FAIL {len(FAIL)}")
print(f"发现的问题：{len(FINDINGS)} 条")
for i, (n, d) in enumerate(FINDINGS, 1):
    print(f"  {i}. {n}")
print("=" * 60)
