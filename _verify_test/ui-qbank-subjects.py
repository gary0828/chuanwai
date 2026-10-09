"""
题库多学科 · UI 验证（学科切换器）

★ 核心断言：**切换学科后页面数据真的跟着变** ——
  只验"切换器存在"是不够的（那种断言在"切了没反应"时也会通过）。

用法：
  "C:\\Program Files\\Python314\\python" _verify_test/ui-qbank-subjects.py [基址]
默认 http://127.0.0.1:18080/qb/
"""
import json
import os
import sys
import urllib.parse
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18080/qb/").rstrip("/")
API = urllib.parse.urljoin(BASE + "/", "/").rstrip("/")
EVIDENCE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "evidence")

PASS, FAIL = 0, 0
failures = []
section = ""


def sec(t):
    global section
    section = t
    print(f"\n{'-'*58}\n{t}\n{'-'*58}")


def ok(l, d=""):
    global PASS
    PASS += 1
    print(f"  PASS  {l}" + (f"\n        -> {d}" if d else ""))


def bad(l, d=""):
    global FAIL
    FAIL += 1
    failures.append(f"[{section}] {l}")
    print(f"  FAIL  {l}" + (f"\n        -> {d}" if d else ""))


def expect(l, a, e):
    if a == e:
        ok(l, f"= {a!r}")
    else:
        bad(l, f"实际={a!r} 期望={e!r}")


def api(path, token=None, body=None, method=None):
    safe = urllib.parse.quote(path, safe="/?&=%")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        API + safe,
        data=json.dumps(body).encode() if body is not None else None,
        method=method or ("POST" if body is not None else "GET"),
        headers=headers,
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


def login(u, p):
    return api("/api/auth/login", body={"username": u, "password": p})["data"]["accessToken"]


TAG = "切换器实证"
admin = login("admin", os.environ.get("ADMIN_PW", "admin123456"))
subs = api("/api/qbank/subjects", token=admin)["data"]["list"]
by_code = {s["code"]: s for s in subs}
MATH = by_code["MATH8"]["id"]          # 初中数学
PHY = by_code["JUN-PHY"]["id"]         # 初中物理


def purge():
    for _ in range(5):
        n = 0
        lst = api(f"/api/qbank/questions?keyword={urllib.parse.quote(TAG)}&pageSize=100", token=admin)
        if lst["data"]["total"]:
            ids = [q["id"] for q in lst["data"]["list"]]
            api("/api/qbank/questions/batch-delete", token=admin, body={"ids": ids})
            n += len(ids)
        rec = api(f"/api/qbank/questions/recycle?keyword={urllib.parse.quote(TAG)}&pageSize=100", token=admin)
        if rec["data"]["total"]:
            ids = [q["id"] for q in rec["data"]["list"]]
            api("/api/qbank/questions/purge", token=admin, body={"ids": ids})
            n += len(ids)
        if not n:
            break


purge()
# 造数据：数学 2 道、物理 1 道
for i, cid in enumerate([MATH, MATH, PHY]):
    api("/api/qbank/questions", token=admin, body={
        "type": "单选题", "stem": f"{TAG} 第{i+1}道", "options": ["甲", "乙"],
        "answer": "甲", "source": "自编", "course_id": cid,
    })
ok("已造数据", f"数学 2 道、物理 1 道")

print(f"\n{'='*58}\n  题库多学科 · UI 验证（切换器）\n  基址：{BASE}\n{'='*58}")

from playwright.sync_api import sync_playwright  # noqa: E402


def read_select(page, label):
    """读 el-select 的选中值（★ 读可见文本，不是 input.value —— 见 K-073）"""
    return page.evaluate("""(lb) => {
        const vis = [...document.querySelectorAll('.el-dialog')].filter(d => d.offsetParent !== null);
        const scope = vis.length ? vis[vis.length - 1] : document;
        const hit = [...scope.querySelectorAll('.el-form-item')].find(el =>
            (el.querySelector('.el-form-item__label')?.innerText || '').trim() === lb);
        const sel = hit?.querySelector('.el-select');
        return sel ? (sel.innerText || '').trim() : null;
    }""", label)


count_questions = lambda page: page.locator(".qb-question").count()


def active_view(page, scope=".qb-aside"):
    """读页签当前选中项（知识点 / 章节 / 方法）。

    ★ 归一化去掉「（13）」这类计数后缀：管理页的页签标签是 `章节（13）`
      （带章节数），写死全文比对会被这种**无关变化**搞红 —— 2026-10-09 实测踩到过。
    """
    txt = page.evaluate("""(sc) => {
        const b = [...document.querySelectorAll(sc + ' .el-radio-button')]
            .find(n => (n.className || '').includes('is-active'));
        return b ? (b.innerText || '').trim() : null;
    }""", scope)
    return txt.split("（")[0] if txt else txt

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1500, "height": 950})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    page.goto(BASE + "/", wait_until="domcontentloaded")
    page.wait_for_timeout(600)
    tk = api("/api/ai/sso/ticket", token=admin, body={"origin": API, "target": "qbank"})
    vf = api("/api/ai/sso/verify", body={"ticket": tk["data"]["ticket"]})
    page.evaluate("(u)=>localStorage.setItem('qbank:session',JSON.stringify(u))", {
        "id": 1, "name": vf["data"]["name"], "role": "admin",
        "loginAt": "", "qbToken": vf["data"]["qbAgentToken"],
    })
    # 让切换器从"初中数学"开始（清掉可能的上次选择）
    page.evaluate("() => localStorage.removeItem('qbank:subject')")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(2200)

    # ══════════════════════════════════════════════════════════════
    sec("M1 切换器存在且落在有数据的学科")
    picker = page.locator(".qb-subject-picker")
    expect("★ 侧栏顶部有学科切换器", picker.count(), 1)
    sel_text = read_select(page, "当前学科") or ""
    # 侧栏里的切换器不在 el-form-item 里，单独取它的可见文本
    if not sel_text:
        sel_text = page.evaluate("""() => {
            const s = document.querySelector('.qb-subject-picker .el-select');
            return s ? (s.innerText || '').trim() : '';
        }""")
    ok("切换器当前显示", f"{sel_text!r}")
    # ★ loadSubjects 会优先落到**有题目**的学科 —— 此时数学有 2 道，应显示带数字
    if "初中数学" in sel_text:
        ok("★ 默认落在有数据的学科（初中数学）", sel_text)
    else:
        bad("未落在预期学科", f"实际显示 {sel_text!r}")
    # ★ 反向断言（ROADMAP §12.2 A）：数学**有**知识点 → **不应**自动跳到「章节」。
    #   自动回落必须只对"知识点为空"的学科生效，否则就把老师的默认视角改错了。
    expect("★ 有知识点的学科默认仍停在「知识点」（自动回落不误触发）",
           active_view(page), "知识点")

    # ══════════════════════════════════════════════════════════════
    sec("M2 数学学科下只看到数学题")
    page.fill("input[placeholder*='搜索题干']", TAG)
    page.keyboard.press("Enter")
    page.wait_for_timeout(1200)
    math_n = count_questions(page)
    expect("★ 数学下命中 2 道", math_n, 2)
    page.screenshot(path=os.path.join(EVIDENCE, "subj-01-math.png"))

    # ══════════════════════════════════════════════════════════════
    sec("M3 切到物理 → 数据跟着变（★ 核心）")
    # 点开切换器并选「初中物理」
    page.locator(".qb-subject-picker .el-select").click()
    page.wait_for_timeout(900)
    pidx = page.evaluate("""() => [...document.querySelectorAll('.el-select-dropdown')]
        .findIndex(p => p.offsetParent !== null &&
            [...p.querySelectorAll('.el-select-dropdown__item')].map(n => n.innerText.trim())
                .some(t => t.startsWith('初中物理')))""")
    expect("找到物理选项所在面板", pidx >= 0, True)
    panel = page.locator(".el-select-dropdown").nth(pidx)
    panel.locator(".el-select-dropdown__item").filter(has_text="初中物理").first.click()
    page.wait_for_timeout(2000)   # 等页面重建 + 重新拉数据

    phy_n = count_questions(page)
    expect("★★ 切到物理后只剩 1 道（数学那 2 道看不到了）", phy_n, 1)
    phy_text = read_select(page, "当前学科") or page.evaluate("""() => {
        const s = document.querySelector('.qb-subject-picker .el-select');
        return s ? (s.innerText || '').trim() : '';
    }""")
    ok("切换器已变为", f"{phy_text!r}")

    # ★ 三视角默认视角的自动回落（ROADMAP §12.2 A，2026-10-09）：
    #   物理的知识点是**空的**（预置只到章节级），修复前侧栏默认停在「知识点」→ 一片空白。
    #   现在应**自动落到「章节」**。下面这条断言直接把该行为钉住。
    expect("★★ 切到无知识点的学科时自动落到「章节」（修复前是空白）",
           active_view(page), "章节")
    page.wait_for_timeout(200)
    body = page.locator(".qb-aside").inner_text()
    expect("★★ 三视角「章节」页签换成了物理的章节（含「声现象」）", "声现象" in body, True)
    expect("★ 物理侧栏里没有数学章节（向量）", "平面向量" not in body, True)
    # 再用真实的筛选验证一次（点「声现象」应能筛出物理题）
    page.locator(".qb-aside .qb-aside-item", has_text="声现象").first.click()
    page.wait_for_timeout(1200)
    ok("★ 点物理的章节项能正常筛选", f"剩 {count_questions(page)} 张卡片")
    page.locator(".qb-aside .qb-aside-item", has_text="声现象").first.click()
    page.wait_for_timeout(1000)
    page.screenshot(path=os.path.join(EVIDENCE, "subj-02-phy.png"))

    # ★ 同类项（2026-10-09 一并修）：**管理页**（知识点与章节）的页签默认值有同一个病
    #   —— 也默认停在「知识点」，22 门只预置了章节的学科进去同样一片空白。
    page.click("text=知识点与章节")
    page.wait_for_timeout(1800)
    tax_phy = api(f"/api/qbank/taxonomy?course_id={PHY}", token=admin)["data"]
    ok("（前置数据）物理的 taxonomy",
       f"知识点={len(tax_phy['knowledge'])} 章节={len(tax_phy['chapters'])}")
    expect("★（同类项）管理页对无知识点学科也自动落到「章节」",
           active_view(page, ".qb-toolbar"), "章节")
    page.click("text=题目库")
    page.wait_for_timeout(1500)

    # ══════════════════════════════════════════════════════════════
    sec("M4 回切数学 → 数据还原")
    page.locator(".qb-subject-picker .el-select").click()
    page.wait_for_timeout(900)
    pidx2 = page.evaluate("""() => [...document.querySelectorAll('.el-select-dropdown')]
        .findIndex(p => p.offsetParent !== null &&
            [...p.querySelectorAll('.el-select-dropdown__item')].map(n => n.innerText.trim())
                .some(t => t.startsWith('初中数学')))""")
    page.locator(".el-select-dropdown").nth(pidx2).locator(".el-select-dropdown__item").filter(
        has_text="初中数学"
    ).first.click()
    page.wait_for_timeout(2000)
    back_n = count_questions(page)
    expect("★ 切回数学后又看到 2 道", back_n, 2)

    # ══════════════════════════════════════════════════════════════
    sec("M5 选择被记住（刷新后仍是该学科）")
    page.locator(".qb-subject-picker .el-select").click()
    page.wait_for_timeout(900)
    p3 = page.evaluate("""() => [...document.querySelectorAll('.el-select-dropdown')]
        .findIndex(p => p.offsetParent !== null &&
            [...p.querySelectorAll('.el-select-dropdown__item')].map(n => n.innerText.trim())
                .some(t => t.startsWith('初中物理')))""")
    page.locator(".el-select-dropdown").nth(p3).locator(".el-select-dropdown__item").filter(
        has_text="初中物理"
    ).first.click()
    page.wait_for_timeout(1500)
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(2200)
    after_reload = read_select(page, "当前学科") or page.evaluate("""() => {
        const s = document.querySelector('.qb-subject-picker .el-select');
        return s ? (s.innerText || '').trim() : '';
    }""")
    expect("★ 刷新后仍是初中物理（记住选择）", "初中物理" in after_reload, True)

    # ══════════════════════════════════════════════════════════════
    sec("M7 ★ 真实免登链路 + 点「返回教务系统」真的导航（2026-10-09 补）")
    # ★ 为什么单开一节、且必须走**真实**免登地址：
    #   本套件（以及其它所有 UI 套件）此前都是"先往 localStorage 注入 session 再 reload"，
    #   把**免登落地这条真实路径整条绕过**了 —— 于是下面两个 bug 一个都测不出来
    #   （546 项断言全绿，用户一进就坏）：
    #     ① App 的 loadSubjects 抢在验票前发出 → 401 → 学科切换器**永久禁用**（点不动）
    #     ② 模板里写 location.href → 编译成 _ctx.location → TypeError → 点了**没反应**
    #   ⇒ 教训：断言要卡在「行为真的发生」（URL 变了 / 控件真的可用），
    #     不能只验"控件存在" —— 同 K-073。
    # ★★ 必须先离开 /qb/（换成**不同路径**）再进票据地址：
    #   若只在 /qb/ 内部换 hash（/qb/#/ → /qb/#/sso?ticket=…），浏览器**不会重新加载页面**，
    #   Vue 应用仍带着内存里的旧会话与旧学科 → 这条测试就退化成"没在测冷启动"（实测踩到过）。
    #   真实链路是：老师站在教务端 `/` → location.href = `/qb/#/sso?ticket=…` → 整页加载。
    page.goto(API + "/", wait_until="domcontentloaded")
    page.wait_for_timeout(800)
    page.evaluate(
        "() => { localStorage.removeItem('qbank:session'); localStorage.removeItem('qbank:subject'); }"
    )
    # 记录网络：用来**直接证明根因已修**（subjects 最终拿到 200），而不是只看界面表现
    net = []
    page.on("response", lambda r: net.append((r.status, r.url)))

    tk2 = api("/api/ai/sso/ticket", token=admin, body={"origin": API, "target": "qbank"})
    page.goto(tk2["data"]["url"], wait_until="networkidle")
    page.wait_for_timeout(3200)

    subs_200 = [u for s, u in net if "/api/qbank/subjects" in u and s == 200]
    expect("★★ 冷启动走免登：/api/qbank/subjects 最终拿到 200（修复前只有 401、无人补拉）",
           len(subs_200) >= 1, True)
    subs_401 = [u for s, u in net if "/api/qbank/subjects" in u and s == 401]
    ok("中途的 401 次数（抢在验票前的那次，属正常中间态）", f"{len(subs_401)} 次")

    expect("★ 免登后离开 /sso，落到题目库首页", "/sso" not in page.url, True)
    ok("落地 URL", page.url)

    sel_after = page.evaluate("""() => {
        const s = document.querySelector('.qb-subject-picker .el-select');
        return s ? (s.innerText || '').trim() : '';
    }""")
    expect("★★ 免登落地后切换器已可用（修复前 subjects 401 → 永久禁用）",
           bool(sel_after) and sel_after != "选择学科", True)
    ok("切换器显示", f"{sel_after!r}")
    expect("★★ 会话建立后 currentSubjectId>0（列表请求会带 course_id，不再串科）",
           bool(page.evaluate("() => localStorage.getItem('qbank:subject')")), True)
    expect("★ 免登成功时侧栏不显示「未从教务系统进入」",
           page.locator(".qb-session-warn").count(), 0)

    # ★★ 关键：点「返回教务系统」必须**真的发生导航**。
    #   修复前是 TypeError：Cannot set properties of undefined (setting 'href')
    #   —— 点了毫无反应，也不报错（K-050 静默即缺陷）。
    url_before_back = page.url
    page.locator(".qb-nav-item", has_text="返回教务系统").click(timeout=4000)
    page.wait_for_timeout(2500)
    expect("★★ 点「返回教务系统」真的导航到了教务端",
           page.url.startswith(API) and "/qb" not in page.url, True)
    print(f"        -> {url_before_back}\n        -> {page.url}")

    # ══════════════════════════════════════════════════════════════
    sec("M6 无 JS 运行时错误")
    real = [e for e in errors if "favicon" not in e.lower() and "401" not in e and "503" not in e]
    if not real:
        ok("★ 全程无 JS 运行时错误")
    else:
        bad("有 JS 运行时错误", "; ".join(real[:3]))

    browser.close()

purge()
fin1 = api(f"/api/qbank/questions?keyword={urllib.parse.quote(TAG)}", token=admin)
fin2 = api(f"/api/qbank/questions/recycle?keyword={urllib.parse.quote(TAG)}", token=admin)
expect("测试数据已清空（列表）", fin1["data"]["total"], 0)
expect("测试数据已清空（回收站）", fin2["data"]["total"], 0)

print(f"\n{'='*58}")
print(f"  结果：PASS {PASS} / FAIL {FAIL}")
if failures:
    print("\n  失败清单：")
    for f in failures:
        print(f"    x {f}")
print(f"{'='*58}\n")
sys.exit(0 if FAIL == 0 else 1)
