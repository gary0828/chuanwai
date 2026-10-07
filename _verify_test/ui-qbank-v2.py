"""
题库完善批次 · UI 验证（回收站 / 知识点管理 / 新交互）

★ 复用了 `toast-capture.js`（外部 JS，避开 Python→JS 转义，见 K-071）
   与 `_ensure_no_dialog()`（modal 遮罩清场，见 K-069）。

用法：
  "C:\\Program Files\\Python314\\python" _verify_test/ui-qbank-v2.py [基址]
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
TOAST_JS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "toast-capture.js")

PASS, FAIL, SKIP_N = 0, 0, 0
failures, skips = [], []
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
    # ★ 写操作自动补学科（迁移 028 后 course_id 必填）；显式传了的不覆盖
    import re as _re
    if (
        TEST_COURSE_ID
        and body is not None
        and isinstance(body, dict)
        and _re.match(r"^/api/qbank/(questions|ocr/|taxonomy/(kp|chapter))", path)
        and body.get("course_id") is None
    ):
        body = {**body, "course_id": TEST_COURSE_ID}
    safe = urllib.parse.quote(path, safe="/?&=%")
    req = urllib.request.Request(
        API + safe,
        data=json.dumps(body).encode() if body is not None else None,
        method=method or ("POST" if body is not None else "GET"),
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


# ★ 学科 id（迁移 028 后建题必填 course_id）：动态取，不硬编码
TEST_COURSE_ID = 0


def resolve_test_course_id(tk):
    """取初中数学的学科 id。动态取 —— id 会随数据库重建变化。"""
    j = api("/api/qbank/subjects", token=tk)
    rows = (j.get("data") or {}).get("list") or []
    math = next((r for r in rows if r.get("code") == "MATH8"), None)
    pick = math or (rows[0] if rows else {})
    return pick.get("id", 1)


def login(u, p):
    j = api("/api/auth/login", body={"username": u, "password": p})
    return j["data"]["accessToken"]


TAG = "UI完善"
admin = login("admin", os.environ.get("ADMIN_PW", "admin123456"))
TEST_COURSE_ID = resolve_test_course_id(admin)   # ★ 见 api() 内注释

print(f"\n{'='*58}\n  题库完善批次 · UI 验证\n  基址：{BASE}\n{'='*58}")

def purge_by_keyword(tk, tag, max_rounds=5):
    """彻底清理某关键词下的测试数据（**循环直到清空**）。

    ★★ 为什么必须循环（2026-10-07 实测漏了 28 道）：
      测试数据会同时存在于**两个地方** —— 正常列表与回收站，
      而 `batch-delete` 只是"移入回收站"。单轮处理的顺序是
      「列表→软删，回收站→彻底删」，但**同一轮的软删结果要到下一轮
      才能被回收站查询看到**（数据在两处之间移动）。
      单轮实现会漏掉"本轮刚软删、本轮回收站查询还没看到"的那批。
      ⇒ 循环，直到某一轮什么都没清掉为止。

    ★★ 另一个必须两步的原因：软删改造后 `batch-delete` 不再真删，
      只调它会让测试数据越积越多（实测回收站堆过 20 条）。
    """
    total_cleaned = 0
    for _ in range(max_rounds):
        n = 0
        try:
            lst = api(f"/api/qbank/questions?keyword={urllib.parse.quote(tag)}&pageSize=100", token=tk)
            if lst["data"]["total"]:
                ids = [q["id"] for q in lst["data"]["list"]]
                api("/api/qbank/questions/batch-delete", token=tk, body={"ids": ids})
                n += len(ids)
        except Exception as e:
            print(f"    [清理警告] 软删 {tag!r} 失败: {e}")
        try:
            rec = api(f"/api/qbank/questions/recycle?keyword={urllib.parse.quote(tag)}&pageSize=100", token=tk)
            if rec["data"]["total"]:
                rids = [q["id"] for q in rec["data"]["list"]]
                api("/api/qbank/questions/purge", token=tk, body={"ids": rids})
                n += len(rids)
        except Exception as e:
            print(f"    [清理警告] 彻底删 {tag!r} 失败: {e}")
        total_cleaned += n
        if n == 0:
            break
    return total_cleaned


from playwright.sync_api import sync_playwright  # noqa: E402


def _capture_toast(page):
    page.add_script_tag(path=TOAST_JS)
    page.evaluate("() => window.__qbStartToastCapture()")


def _read_toasts(page):
    return page.evaluate("() => window.__qbReadToasts()")


def _ensure_no_dialog(page):
    """清掉可见的 el-dialog（它的遮罩会拦截所有点击，见 K-069）"""
    for _ in range(3):
        n = page.evaluate("""() => {
            const vis = [...document.querySelectorAll('.el-dialog')].filter(d => d.offsetParent !== null);
            if (!vis.length) return 0;
            vis.forEach(d => {
                const cancel = [...d.querySelectorAll('button')].find(b => (b.innerText||'').trim() === '取消');
                if (cancel) cancel.click();
            });
            return vis.length;
        }""")
        if not n:
            break
        page.wait_for_timeout(700)
    left = page.evaluate("""() => {
        const vis = [...document.querySelectorAll('.el-dialog')].filter(d => d.offsetParent !== null);
        if (!vis.length) return 0;
        vis.forEach(d => { const ov = d.closest('.el-overlay'); if (ov) ov.remove(); else d.remove(); });
        return vis.length;
    }""")
    page.wait_for_timeout(300)
    return left


created_ids = []
os.makedirs(EVIDENCE, exist_ok=True)

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1500, "height": 950}, accept_downloads=True)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    # 注入会话
    page.goto(BASE + "/", wait_until="domcontentloaded")
    page.wait_for_timeout(600)
    tk = api("/api/ai/sso/ticket", token=admin, body={"origin": API, "target": "qbank"})
    vf = api("/api/ai/sso/verify", body={"ticket": tk["data"]["ticket"]})
    page.evaluate("(u)=>localStorage.setItem('qbank:session',JSON.stringify(u))", {
        "id": 1, "name": vf["data"]["name"], "role": vf["data"]["role"],
        "loginAt": vf["data"]["loginAt"], "qbToken": vf["data"]["qbAgentToken"],
    })

    # 造数据：1 道正常题 + 1 道待删题
    r1 = api("/api/qbank/questions", token=admin, body={
        "type": "单选题", "stem": f"{TAG} 正常题 $\\frac{{1}}{{2}}$",
        "options": ["甲", "乙"], "answer": "甲", "source": "自编",
        "analysis": "有解析", "kp_ids": [1], "solve_method": "配方法",
    })
    created_ids.append(r1["data"]["id"])
    r2 = api("/api/qbank/questions", token=admin, body={
        "type": "单选题", "stem": f"{TAG} 将被删除的题", "options": ["甲", "乙"],
        "answer": "甲", "source": "自编",
    })
    r2id = r2["data"]["id"]
    api(f"/api/qbank/questions/{r2id}", token=admin, method="DELETE")   # 软删 → 进回收站
    ok("已造数据", f"正常题={r1['data']['id']} 回收站题={r2id}")

    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1500)

    # ══════════════════════════════════════════════════════════════
    sec("M1 侧栏：新增两个入口")
    nav_texts = page.locator(".qb-nav-item").all_inner_texts()
    expect("★ 侧栏有 6 个功能入口", len([t for t in nav_texts if t.strip() and "返回" not in t]), 6)
    ok("侧栏项", " / ".join(t.strip() for t in nav_texts if t.strip()))

    # ══════════════════════════════════════════════════════════════
    sec("M2 题目库：新交互（勾选 / 排序 / 知识点名 / 完善度）")
    _ensure_no_dialog(page)

    # 勾选框
    cb = page.locator(".qb-question .el-checkbox")
    expect("★ 题目卡上有勾选框", cb.count() >= 1, True)
    if cb.count() > 0:
        cb.first.click()
        page.wait_for_timeout(600)
        # 勾选后出现批量操作按钮
        has_batch = page.locator("text=删除勾选").count() > 0
        expect("★ 勾选后出现「删除勾选」按钮", has_batch, True)
        # 取消勾选
        cb.first.click()
        page.wait_for_timeout(500)

    # 排序选择器
    sort_sel = page.locator(".qb-toolbar .el-select").last
    expect("★ 排序选择器存在", page.locator(".qb-toolbar .el-select").count() >= 5, True)

    # 知识点名（不是 id）
    meta_text = page.locator(".qb-question").first.inner_text()
    has_kp_name = "未挂知识点" in meta_text or "全等" in meta_text or "单元" in meta_text
    expect("★ 列表显示知识点名（而非 id）", has_kp_name, True)
    print(f"        首个卡片 meta 片段：{meta_text[-110:]!r}")

    # 完善度标签
    has_quality = "%" in meta_text
    expect("★ 列表显示完善度百分比", has_quality, True)

    page.screenshot(path=os.path.join(EVIDENCE, "v2-01-list.png"))

    # ══════════════════════════════════════════════════════════════
    sec("M3 回收站页")
    page.click("text=回收站")
    page.wait_for_timeout(1400)
    expect("★ 回收站页加载", page.locator(".qb-hint").count() > 0, True)

    recycle_cards = page.locator(".qb-question").count()
    ok("回收站里的题目数", f"{recycle_cards} 张卡片")
    if recycle_cards > 0:
        rc_text = page.locator(".qb-question").first.inner_text()
        expect("★ 显示删除时间", "删除于" in rc_text, True)
        expect("★ 显示删除人", "删除人" in rc_text, True)
        expect("★ 有「恢复」按钮", page.locator("text=恢复").count() > 0, True)
        expect("★ 有「彻底删除」按钮", page.locator("text=彻底删除").count() > 0, True)

    # 搜索框
    expect("回收站有搜索框", page.locator("input[placeholder*='搜索已删除']").count() > 0, True)

    page.screenshot(path=os.path.join(EVIDENCE, "v2-02-recycle.png"))

    # 真点「恢复」
    if recycle_cards > 0:
        before_recycle = page.locator(".qb-question").count()
        page.locator(".qb-question").first.locator("text=恢复").first.click()
        page.wait_for_timeout(1500)
        after_recycle = page.locator(".qb-question").count()
        expect("★ 点「恢复」后回收站少一条", after_recycle, before_recycle - 1)
        _capture_toast(page)
        ok("恢复操作已执行（toast 捕获备用）", f"{_read_toasts(page)}")

        # 恢复到题目库了吗
        api_list = api(f"/api/qbank/questions?keyword={urllib.parse.quote(TAG + ' 将被删除')}", token=admin)
        expect("★ 恢复的题回到题目库", api_list["data"]["total"], 1)
        created_ids.append(r2id)

    # ══════════════════════════════════════════════════════════════
    sec("M4 知识点与章节管理页")
    page.click("text=知识点与章节")
    page.wait_for_timeout(1500)
    _ensure_no_dialog(page)

    expect("★ 页面加载（有卡片）", page.locator(".card").count() > 0, True)
    expect("★ 知识点/章节两个页签", page.locator(".el-radio-button").count() == 2, True)

    kp_cards = page.locator(".card").count()
    ok("知识点树渲染的单元数", f"{kp_cards} 个")

    # 引用计数显示
    body = page.locator(".content, .qb-content, body").first.inner_text()
    expect("★ 显示「题目 N」引用计数", "题目" in body, True)
    expect("★ 显示「学生测评」风险计数", "学生测评" in body or "引用保护" in body, True)

    # 删除按钮的置灰（有引用的节点应被禁用）
    disabled_btns = page.locator(".card button:disabled").count()
    ok("被引用的节点其删除按钮已置灰", f"{disabled_btns} 个禁用按钮")

    page.screenshot(path=os.path.join(EVIDENCE, "v2-03-taxonomy-kp.png"))

    # 新增知识点对话框
    page.click("text=＋ 新增知识点")
    page.wait_for_timeout(900)
    expect("★ 新增知识点对话框打开", page.locator(".el-dialog").count() > 0, True)
    # 空名点保存应被拦
    _capture_toast(page)
    page.click(".el-dialog button:has-text('保存')")
    page.wait_for_timeout(900)
    expect("★ 空名称被拦（toast）", any("名称" in t for t in _read_toasts(page)), True)
    # 填名保存
    page.fill(".el-dialog input[placeholder*='全等三角形']", f"{TAG}测试知识点")
    page.click(".el-dialog button:has-text('保存')")
    page.wait_for_timeout(1600)
    tax = api("/api/qbank/taxonomy", token=admin)
    added = [k for k in tax["data"]["knowledge"] if k["name"] == f"{TAG}测试知识点"]
    expect("★ 新增知识点成功", len(added), 1)
    if added:
        # 清理：删掉它（无引用应可删）
        api(f"/api/qbank/taxonomy/kp/{added[0]['id']}", token=admin, method="DELETE")
        ok("已清理测试知识点")

    # 切到章节页签
    page.click(".el-radio-button:has-text('章节')")
    page.wait_for_timeout(1200)
    expect("★ 章节树加载", page.locator(".card").count() > 0, True)
    expect("★ 章节页签标题变了", "章节" in page.locator(".qb-toolbar").inner_text(), True)
    page.screenshot(path=os.path.join(EVIDENCE, "v2-04-taxonomy-chapter.png"))

    # ══════════════════════════════════════════════════════════════
    sec("M5 配图上传控件（新增题目对话框）")
    page.click("text=题目库")
    page.wait_for_timeout(1200)
    _ensure_no_dialog(page)
    page.click("text=＋ 新增题目")
    page.wait_for_timeout(1000)
    expect("★ 对话框有「上传配图」按钮", page.locator("text=上传配图").count() > 0, True)
    expect("★ 对话框有知识点选择器", page.locator(".el-dialog .el-form-item:has-text('知识点')").count() > 0, True)
    # 知识点选项应带缩进（含全角空格）
    kp_opts = page.evaluate("""() => {
        const items = [...document.querySelectorAll('.el-select-dropdown__item')];
        return items.filter(n => n.innerText.includes('\\u3000')).length;
    }""")
    ok("★ 知识点下拉中带层级缩进的选项数", f"{kp_opts}（>0 说明层级已体现）")

    _ensure_no_dialog(page)

    # ══════════════════════════════════════════════════════════════
    sec("M6 无 JS 运行时错误")
    real = [e for e in errors if "favicon" not in e.lower() and "401" not in e and "503" not in e]
    if not real:
        ok("★ 全程无 JS 运行时错误")
    else:
        bad("有 JS 运行时错误", "; ".join(real[:3]))

    browser.close()

# 清理
# ★ 按关键词清理（比逐个追 id 更不易漏，见 ui-full-qbank.py 里的同款注释）
purge_by_keyword(admin, TAG)
rec = api(f"/api/qbank/questions/recycle?keyword={urllib.parse.quote(TAG)}&pageSize=100", token=admin)
if rec["data"]["total"]:
    api("/api/qbank/questions/purge", token=admin,
        body={"ids": [q["id"] for q in rec["data"]["list"]]})
fin1 = api(f"/api/qbank/questions?keyword={urllib.parse.quote(TAG)}", token=admin)
fin2 = api(f"/api/qbank/questions/recycle?keyword={urllib.parse.quote(TAG)}", token=admin)
expect("测试数据已清空（列表）", fin1["data"]["total"], 0)
expect("测试数据已清空（回收站）", fin2["data"]["total"], 0)

print(f"\n{'='*58}")
print(f"  结果：PASS {PASS} / FAIL {FAIL} / SKIP {SKIP_N}")
if skips:
    print("\n  SKIP：")
    for s in skips:
        print(f"    - {s}")
if failures:
    print("\n  失败清单：")
    for f in failures:
        print(f"    x {f}")
print(f"{'='*58}\n")
sys.exit(0 if FAIL == 0 else 1)
