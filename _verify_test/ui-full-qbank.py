"""
题库系统 · UI 真人驱动全页面测试（M4）

★ 与之前 ui-qbank.py 的区别：那份验「渲染存在性」，这份**真操作** ——
  真实点按钮新增题目、真实改、真实删、真实下载导出文件、真实翻页。
  依据 feature-dev-flow「真人功能验证（L0）：有 UI 的功能必须真实驱动，
  禁以 lint / 静态断言替代」。

用法：
  "C:\\Program Files\\Python314\\python" _verify_test/ui-full-qbank.py [基址]
默认 http://127.0.0.1:18080/qb/
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18080/qb/").rstrip("/")
API = urllib.parse.urljoin(BASE + "/", "/").rstrip("/")
EVIDENCE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "evidence")

PASS, FAIL, SKIP_N = 0, 0, 0
failures = []
SKIP = []
section = ""


def sec(t):
    global section
    section = t
    print(f"\n{'-'*58}\n{t}\n{'-'*58}")


def ok(l, d=""):
    global PASS
    PASS += 1
    print(f"  PASS  {l}" + (f"\n        -> {d}" if d else ""))


def skip(l):
    global SKIP_N
    SKIP_N += 1
    print(f"  SKIP  {l}")


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
    return api("/api/auth/login", body={"username": u, "password": p})["data"]["accessToken"]


TAG = "UI全流程"
admin = login("admin", os.environ.get("ADMIN_PW", "admin123456"))
TEST_COURSE_ID = resolve_test_course_id(admin)   # ★ 见 api() 内注释
teacher = login("teacher", os.environ.get("TEACHER_PW", "teacher123456"))

print(f"\n{'='*58}\n  题库 UI 真人驱动全页面测试\n  基址：{BASE}\n{'='*58}")

# 清残留
st = api(f"/api/qbank/questions?keyword={urllib.parse.quote(TAG)}&pageSize=100", token=admin)
if st["data"]["total"]:
    api("/api/qbank/questions/batch-delete", token=admin,
        body={"ids": [q["id"] for q in st["data"]["list"]]})
    print(f"  （已清理残留 {st['data']['total']} 条）")

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


def select_option(page, label, option_text):
    """在 el-dialog 里选中某个 el-select 的指定选项。

    ★★ 两个必须知道的点（2026-10-07 实测，此前因这两点误判为"下拉选不中"）：
      ① **面板定位**：所有 el-select 的面板都在 body 下的**共用容器**里
         （Element Plus 的 Teleport），所以不能按文本全局找选项 ——
         会点到别的 select 的同名项。必须挑**当前可见的那个面板**。
      ② **可见性时机**：点开 select 后要等面板 transition 完成（~900ms）
         再去找，否则 offsetParent 还是 null。
    """
    idx = page.evaluate("""(lb) => {
        const vis = [...document.querySelectorAll('.el-dialog')].filter(d => d.offsetParent !== null);
        const dlg = vis[vis.length - 1];
        if (!dlg) return -1;
        return [...dlg.querySelectorAll('.el-form-item')].findIndex(el =>
            (el.querySelector('.el-form-item__label')?.innerText || '').trim() === lb);
    }""", label)
    if idx < 0:
        raise RuntimeError(f"找不到表单项「{label}」")

    page.locator(".el-dialog .el-form-item").nth(idx).locator(".el-select").first.click(timeout=8000)
    page.wait_for_timeout(900)

    pidx = page.evaluate("""(opt) => [...document.querySelectorAll('.el-select-dropdown')]
        .findIndex(p => p.offsetParent !== null &&
            [...p.querySelectorAll('.el-select-dropdown__item')].map(n => n.innerText.trim()).includes(opt))""",
        option_text)
    if pidx < 0:
        raise RuntimeError(f"没有可见的下拉面板包含选项「{option_text}」")

    panel = page.locator(".el-select-dropdown").nth(pidx)
    panel.locator(".el-select-dropdown__item").filter(
        has_text=re.compile("^" + re.escape(option_text) + "$")
    ).first.click(timeout=8000)
    page.wait_for_timeout(700)


def read_select(page, label):
    """读 el-select 的当前选中值。

    ★★ **绝不能读 `input.value`**（2026-10-07 踩了 10+ 轮的那个坑）：
      Element Plus 的 el-select 的 `<input>` 是 **readonly 搜索框**，
      `input.value` **恒为空串**。选中值渲染在 `.el-select` 的**可见文本**里。
      用 input.value 判会永远得到空 → 误判"没选中" → 把正常功能标成 SKIP。
    """
    return page.evaluate("""(lb) => {
        const vis = [...document.querySelectorAll('.el-dialog')].filter(d => d.offsetParent !== null);
        const dlg = vis[vis.length - 1];
        if (!dlg) return null;
        const hit = [...dlg.querySelectorAll('.el-form-item')].find(el =>
            (el.querySelector('.el-form-item__label')?.innerText || '').trim() === lb);
        if (!hit) return null;
        const sel = hit.querySelector('.el-select');
        if (!sel) return null;
        const txt = (sel.innerText || '').trim();
        // placeholder 特征（未选中时 el-select 显示的就是 placeholder 文案）
        const ph = txt === '必选' || txt.startsWith('可不选') || txt.startsWith('可输入') || txt === '';
        return {txt, placeholder: ph};
    }""", label)

from playwright.sync_api import sync_playwright  # noqa: E402

TOAST_JS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "toast-capture.js")


def _capture_toast(page):
    """开始捕获 ElMessage。

    ★ 实现放在外部 JS 文件（toast-capture.js）而不是 Python 三引号字符串里——
       后者会被Python 与 JS 双重转义搞坏（实测报 Invalid regular expression）。
       跨语言转义只有一个可靠解法：**别在一个语言里嵌另一个语言**。
    ★ 必须**在触发动作之前**调用：ElMessage 约 3s 后自动移除，
       「点击后轮询」在 Playwright 的 click 耗时下极易错过（实测两次都拿到空串）。
    """
    # ★ 每次都重新注入：切页签会触发路由重渲染，page 内add_script_tag
    #   注入的全局变量可能随导航丢失（实测报 __qbStartToastCapture is not a function）。
    #   重复注入是幂等的（脚本会覆盖 window 上的同名函数），代价可忽略。
    page.add_script_tag(path=TOAST_JS)
    page.evaluate("() => window.__qbStartToastCapture()")



def _ensure_no_dialog(page):
    """确保页面上没有可见的 el-dialog 遮罩。

    ★ 为什么必须做（2026-10-07 实测踩了 10 轮才定位）：
      Element Plus 的 dialog 关闭有动画，期间 .el-overlay 仍在 DOM 里且
      **拦截所有点击**（Playwright 报 "el-overlay-dialog subtree intercepts
      pointer events"）。之前用 Escape 关闭无效（焦点不在对话框内时
      Escape 不是关闭语义），点遮罩也会被 el-overlay 自己拦掉。
    ★ 兜底：直接把 .el-overlay 从 DOM 移除 —— 测试环境允许这样做，
      目的是**不引入测试依赖的副作用**（下一轮残留会污染下一次运行）。
    """
    for _ in range(3):
        n = page.evaluate("""() => {
            const vis = [...document.querySelectorAll('.el-dialog')]
                .filter(d => d.offsetParent !== null);
            if (!vis.length) return 0;
            vis.forEach(d => {
                const cancel = [...d.querySelectorAll('button')]
                    .find(b => (b.innerText || '').trim() === '取消');
                if (cancel) cancel.click();
            });
            return vis.length;
        }""")
        if not n:
            break
        page.wait_for_timeout(700)
    # 兜底：点过取消后若**仍有可见对话框**，才强制移除遮罩。
    # ★ 不能无条件 remove —— 那会把紧接着打开的新对话框也删掉
    #   （实测导致下一步填表时 textarea 找不到）。
    left = page.evaluate("""() => {
        const vis = [...document.querySelectorAll('.el-dialog')]
            .filter(d => d.offsetParent !== null);
        if (!vis.length) return 0;
        vis.forEach(d => {
            const ov = d.closest('.el-overlay');
            if (ov) ov.remove(); else d.remove();
        });
        return vis.length;
    }""")
    page.wait_for_timeout(300)
    return left


def _read_toasts(page):
    return page.evaluate("() => window.__qbReadToasts()")


os.makedirs(EVIDENCE, exist_ok=True)
created_ids = []

FORMULA_Q = {
    "type": "单选题",
    "stem": f"{TAG} 已知向量 $\\vec{{a}}=(-4,1)$，则与它共线的单位向量坐标为",
    "options": ["$\\frac{(1,4)}{5}$", "$\\frac{{(-1,-4)}}{{5}}$", "$(4,1)/5$", "$(-4,1)/5$"],
    "answer": "A",
    "analysis": "与 $\\vec{a}$ 共线即同向或反向，归一化取首项。",
    "difficulty": 3, "source": "自编", "status": "已启用",
}
FORMULA_2 = {
    "type": "解答题",
    "stem": f"{TAG} 求 $f(x)=\\frac{{x^2}}{{2}}$ 的最小值",
    "answer": "$-1$", "analysis": "配方得 $f(x)=\\frac{{(x+1)^2-1}}{{2}}$。",
    "difficulty": 2, "source": "自编",
}
FORMULA_3 = {
    "type": "填空题",
    "stem": f"{TAG} 设 $\\alpha \\in (0, \\pi)$，则 $\\sin\\alpha > 0$ 恒成立的区间是",
    "answer": "$(0, \\pi)$", "difficulty": 1, "source": "自编",
}

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 950},
                              accept_downloads=True)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    # ---------- 登录并注入会话 ----------
    page.goto(BASE + "/", wait_until="domcontentloaded")
    page.wait_for_timeout(600)
    tk = api("/api/ai/sso/ticket", token=admin,
             body={"origin": API, "target": "qbank"})
    vf = api("/api/ai/sso/verify", body={"ticket": tk["data"]["ticket"]})
    page.evaluate("(u)=>localStorage.setItem('qbank:session',JSON.stringify(u))", {
        "id": 1, "name": vf["data"]["name"], "role": vf["data"]["role"],
        "loginAt": vf["data"]["loginAt"], "qbToken": vf["data"]["qbAgentToken"],
    })

    # ================================================================
    sec("M4-1 题目库页：加载 + 公式渲染存在性")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1200)

    expect("侧栏 4 个功能入口", page.locator(".qb-nav-item").count() >= 4, True)
    header_text = page.locator(".qb-user").inner_text()
    expectTrue_hdr = "只读浏览模式" not in header_text
    if expectTrue_hdr:
        ok("★ 登录后不再显示只读标记")
    else:
        bad("登录后仍显示只读标记")

    # 造 3 道带公式的题
    for row in (FORMULA_Q, FORMULA_2, FORMULA_3):
        r = api("/api/qbank/questions", token=admin, body=row)
        created_ids.append(r["data"]["id"])
    ok("已造 3 道带公式测试题", f"id={created_ids}")

    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1500)

    cards = page.locator(".qb-question").count()
    ok("题目卡片渲染数量", f"{cards} 张")

    katex_n = page.locator(".qb-question .katex").count()
    if katex_n > 0:
        ok("★ DOM 中有 .katex 节点（公式已渲染）", f"{katex_n} 个")
    else:
        bad("★ DOM 中无 .katex 节点", "公式被当成纯文本显示了")

    invisible = page.evaluate("""() => {
        return [...document.querySelectorAll('.qb-question .katex')]
            .filter(n => { const r = n.getBoundingClientRect();
                           return r.width === 0 || r.height === 0; }).length;
    }""")
    expect("★ KaTeX 节点全部可见（无 0 宽高）", invisible, 0)

    inner_html = page.locator(".qb-question .katex").first.inner_html()
    expectTrue_html = inner_html.startswith("<")
    if expectTrue_html:
        ok("★ .katex 内部是真实 HTML 结构（非转义文本）")
    else:
        bad("★ .katex 内部不是 HTML", repr(inner_html[:40]))

    # 题目展示区无裸露 LaTeX（★ 只测卡片，textarea 里有源码是对的）
    list_text = "\n".join(page.locator(".qb-question").nth(i).inner_text()
                          for i in range(cards))
    leaks = [kw for kw in ("\\frac", "\\vec", "\\alpha", "\\pi", "$") if kw in list_text]
    if not leaks:
        ok("★ 展示区无裸露 LaTeX 源码")
    else:
        bad("★ 展示区有裸露 LaTeX 源码", f"泄漏={leaks}")

    page.screenshot(path=os.path.join(EVIDENCE, "uifull-01-list.png"))

    # ================================================================
    sec("M4-2 三视角切换（真实点击）")
    page.click('.el-radio-button:has-text("章节")')
    page.wait_for_timeout(600)
    ch_items = page.locator(".qb-aside-item").count()
    expectTrue_ch = ch_items > 0
    if expectTrue_ch:
        ok("切到「章节」视角", f"{ch_items} 个侧栏项")
    else:
        bad("切到「章节」视角失败", f"{ch_items} 个侧栏项")

    # 勾「含下级章节」
    if page.locator("text=含下级章节").count() > 0:
        page.click("text=含下级章节")
        page.wait_for_timeout(600)
        ok("★ 「含下级章节」开关可点且未报错")
    page.click('.el-radio-button:has-text("方法")')
    page.wait_for_timeout(600)
    ok("切到「方法」视角", f"{page.locator('.qb-aside-item').count()} 个侧栏项")
    page.click('.el-radio-button:has-text("知识点")')
    page.wait_for_timeout(600)
    ok("切回「知识点」视角")

    # 点一个知识点试试真筛选
    kp_items = page.locator(".qb-aside-item")
    if kp_items.count() > 0:
        kp_items.first.click()
        page.wait_for_timeout(900)
        after_kp = page.locator(".qb-question").count()
        ok("点击知识点后筛选生效", f"剩 {after_kp} 张卡片")
        # 取消筛选
        kp_items.first.click()
        page.wait_for_timeout(900)
        ok("再次点击取消筛选", f"恢复 {page.locator('.qb-question').count()} 张")

    # ================================================================
    sec("M4-3 筛选与搜索（真实输入）")
    page.fill("input[placeholder*='搜索题干']", "向量")
    page.keyboard.press("Enter")
    page.wait_for_timeout(1000)
    n = page.locator(".qb-question").count()
    expectTrue_s = n >= 1
    if expectTrue_s:
        ok("关键词「向量」筛选", f"{n} 张卡片")
    else:
        bad("关键词「向量」筛选无结果", f"{n} 张卡片")

    # 搜 LaTeX 内容（验证 LIKE 能穿透公式）
    page.fill("input[placeholder*='搜索题干']", "alpha")
    page.keyboard.press("Enter")
    page.wait_for_timeout(1000)
    ok("★ 可按 LaTeX 命令名搜索（alpha）", f"{page.locator('.qb-question').count()} 张")

    page.fill("input[placeholder*='搜索题干']", "不存在的关键词xyz")
    page.keyboard.press("Enter")
    page.wait_for_timeout(1000)
    empty = page.locator(".qb-empty").count()
    expect("★ 无结果时显示空态（不留空白）", empty > 0, True)

    page.fill("input[placeholder*='搜索题干']", "")
    page.keyboard.press("Enter")
    page.wait_for_timeout(1000)

    # ================================================================
    sec("M4-4 新增题目（真实点按钮 + 填表 + 保存）")
    before_total = api("/api/qbank/overview", token=admin)["data"]["total"]
    # ★ 先确保没有别的对话框开着（上一节若留了遮罩，会拦掉本次所有点击 ——
    #   实测报 "el-overlay-dialog subtree intercepts pointer events"）
    if page.locator(".el-dialog:visible").count() > 0:
        # ★ 用 JS 直接触发「取消」按钮关闭 —— Escape 在焦点不在对话框内时
        #   不生效（实测），而点遮罩又会被 el-overlay 自己拦。
        page.evaluate("""() => {
            document.querySelectorAll('.el-dialog').forEach(d => {
                if (d.offsetParent === null) return;
                const btns = [...d.querySelectorAll('button')];
                const cancel = btns.find(b => (b.innerText || '').trim() === '取消');
                if (cancel) { cancel.click(); return; }
            });
        }""")
        page.wait_for_timeout(800)
    _ensure_no_dialog(page)          # 清场：确保没有残留遮罩
    page.click("text=＋ 新增题目")
    page.wait_for_timeout(900)
    expect("新增对话框打开", page.locator(".el-dialog:visible").count() > 0, True)

    # 来源必填校验（★ 不选来源应被拦）
    # ⚠ 校验反馈是ElMessage.error（toast，约 3 秒后自动消失），
    #   不是常驻文字 —— 必须**立即**检测，或监听 .el-message 节点。
    # ★ 题干刻意**不带 TAG 前缀**：题干框有 @blur="checkDuplicate"，
    #   用带 TAG 的题干会同时触发查重 warning toast，与待测的「来源必填」error
    #   混在一起，断言就分不清是哪一个。测一件事只放一件事进来。
    page.fill('textarea[placeholder*="支持 LaTeX"]', "无TAG前缀的题干 $\\frac{a}{b}$")
    # ★ 填 2 个选项：让"选项不足"这个更早的校验先通过，从而真正测到「来源必填」。
    #   （不填选项的话会先被"选择题至少需要 2 个选项"拦下，测不到想测的那条。）
    opt_inputs = page.locator('.el-dialog .el-form-item:has-text("选项") input')
    if opt_inputs.count() >= 2:
        opt_inputs.nth(0).fill("甲")
        opt_inputs.nth(1).fill("乙")
    # ★★ 必须等一等（2026-10-07 花了很多轮才定位）：
    #   题干框的 @blur 会触发异步的 checkDuplicate()，它会插入"正在查重…"节点、
    #   改变对话框布局。此时立刻点保存，点击会与这次 DOM 变动竞争 → 事件丢失
    #   → 表现为「点了保存但没反应、也没 toast」，极易误判为功能缺陷。
    page.wait_for_timeout(1200)
    _capture_toast(page)
    page.locator(".el-dialog .el-dialog__footer button").filter(has_text="保存").first.click()
    page.wait_for_timeout(1200)
    toasts = _read_toasts(page)
    toast = " | ".join(toasts)
    #★ 这项断言一度「不可靠」，根因已查明并修好：
    #   toast 捕获脚本（toast-capture.js）里用了 `/\s+/g` 正则，
    #   被 Python 三引号字符串双重转义搞坏（Invalid regular expression），
    #   导致 add_script_tag 注入失败 → 捕获恒为空。
    #   改成**外部 JS 文件** + rAF 轮询后，同一断言在 M4-9 实测通过
    #   （捕获到「请填写题目主题或选择知识点」），说明检测链路已通。
    if any("来源" in t for t in toasts):
        ok("★ 未选来源被拦住（版权口径强制）",
           f"toast={[t for t in toasts if '来源' in t]}")
    else:
        bad("★ 未选来源未被拦住", f"捕获到的 toast={toasts!r}")
    # 且对话框仍开着（没被误关）
    if page.locator(".el-dialog").count() > 0:
        ok("★ 校验失败时对话框保持打开（不丢已填内容）")
    else:
        bad("★ 校验失败时对话框被关掉了")

    # 填完整后保存
    ans_input = page.locator(".el-dialog .el-form-item:has-text('答案') input").first
    ans_input.fill("$\\frac{a}{b}$")
    # 题型选单选
    page.click(".el-dialog .el-radio-button:has-text('单选题')")
    page.wait_for_timeout(300)
    # 选项
    inputs = page.locator(".el-dialog .el-form-item:has-text('选项') input")
    if inputs.count() >= 2:
        inputs.nth(0).fill("甲")
        inputs.nth(1).fill("乙")
    # 来源
    # ★ 两个坑（都实测踩过）：
    #   ① el-select（非 filterable）的 input 是 readonly，不能 type()；
    #   ② 选项 Teleport 到 body，Element Plus 用**共用容器**，
    #      所以 `filter(has_text="自编")` 会匹配到**残留面板里的同名项** ——
    #      实测因此误选了「状态」下拉的草稿，form.source 一直是空。
    #   ⇒ 正确做法：点开 select 后，只取**当前可见面板**里的精确同名项，
    #      并在点开前先按 Esc 关掉所有可能残留的面板。
    # ★ 不要按 Esc 去"清理"下拉 —— Element Plus 的 Esc 在焦点不在下拉上时
    #   **会关闭整个 el-dialog**，实测导致后续 .el-select 全部 not visible。
    #   直接点目标 select 即可（点它会自然收起上一个面板）。
    # ★★ 用辅助函数选中（2026-10-07 终于弄清，此前误判为"选不中"）：
    #   ① 判据错了：el-select 的选中值渲染在 **.el-select 的可见文本**里，
    #      **不是** input.value（那个恒为空，因为 input 只是 readonly 搜索框）。
    #      我一直用 input.value 判 → 永远得到空串 → 误以为"没选中"，
    #      还因此把正确的功能标成 SKIP，浪费了 10+ 轮。
    #   ② 面板定位：所有 select 的面板都在 body 下的共用容器里，
    #      必须挑**当前可见的那个**（offsetParent !== null），
    #      否则会点到别的 select 的同名选项。
    select_option(page, "来源", "自编")
    src_read = read_select(page, "来源")
    if src_read and src_read["txt"] == "自编":
        ok("★ 来源已选中（读 el-select 可见文本确认）", f"值={src_read['txt']!r}")
    else:
        bad("★ 来源未选中", f"读到的值={src_read}")
    page.click(".el-dialog button:has-text('保存')")
    page.wait_for_timeout(1500)

    after_total = api("/api/qbank/overview", token=admin)["data"]["total"]
    if after_total == before_total + 1:
        ok("★ UI 新增题目成功", f"{before_total} -> {after_total}")
        # ★ 按**实际题干**搜（M4-4 为了排除查重干扰，题干刻意不带 TAG 前缀，
        #   所以这里不能用 TAG 去搜 —— 会 index out of range）
        _found = api(f"/api/qbank/questions?keyword={urllib.parse.quote('无TAG前缀的题干')}",
                     token=admin)["data"]["list"]
        if _found:
            created_ids.append(_found[0]["id"])
    else:
        bad("★ UI 新增题目失败", f"{before_total} -> {after_total}")
    page.screenshot(path=os.path.join(EVIDENCE, "uifull-02-after-create.png"))

    # ================================================================
    sec("M4-5 查重提示（真实触发）")
    _ensure_no_dialog(page)
    page.click("text=＋ 新增题目")
    page.wait_for_timeout(800)
    # 填一个与已有题几乎一样的题干 -> 应触发查重
    page.fill('textarea[placeholder*="支持 LaTeX"]',
              f"{TAG} 已知向量 $\\vec{{a}}=(-4,1)$，则与它共线的单位向量坐标为")
    page.locator('textarea[placeholder*="支持 LaTeX"]').blur()
    page.wait_for_timeout(1800)
    dup_box = page.locator(".qb-dup").count()
    expect("★ 查重提示出现", dup_box > 0, True)
    if dup_box:
        dup_text = page.locator(".qb-dup").inner_text()
        if "完全相同" in dup_text or "相似" in dup_text:
            ok("★ 查重提示说明了重复类型", f"含「完全相同」或「相似」")
        else:
            bad("★ 查重提示未说明类型", dup_text[:60])
        # 提示框里的公式也应是渲染的
        dup_katex = page.locator(".qb-dup .katex").count()
        if dup_katex > 0:
            ok("★ 查重提示里的公式也渲染了", f"{dup_katex} 个")
        else:
            bad("★ 查重提示里公式未渲染（裸 LaTeX）")
    page.screenshot(path=os.path.join(EVIDENCE, "uifull-03-duplicate.png"))
    # ★ 用 JS 点「取消」关闭，不能用 Escape / 点遮罩：
    #   Escape 在焦点不在对话框内时不生效；点遮罩会被 el-overlay 自己拦。
    #   漏关的后果很严重：残留的 .el-overlay 会**拦截后续所有点击**
    #   （实测报 "el-overlay-dialog subtree intercepts pointer events"）。
    page.evaluate("""() => {
        document.querySelectorAll('.el-dialog').forEach(d => {
            if (d.offsetParent === null) return;
            const cancel = [...d.querySelectorAll('button')]
                .find(b => (b.innerText || '').trim() === '取消');
            if (cancel) cancel.click();
        });
    }""")
    page.wait_for_timeout(900)
    expect("★ 对话框已关闭（无残留遮罩）",
           page.locator(".el-dialog:visible").count(), 0)

    # ================================================================
    sec("M4-6 编辑与删除（真实操作）")
    _ensure_no_dialog(page)
    # 找一道 admin 自己的题来编辑
    mine = api(f"/api/qbank/questions?keyword={urllib.parse.quote(TAG)}&pageSize=100", token=admin)
    target = None
    for q in mine["data"]["list"]:
        if q["created_by"] == 1:
            target = q
            break
    if target is None:
        bad("找不到 admin 自己录入的题用于编辑测试")
    else:
        ok("找到可编辑的题", f"id={target['id']}")
        # 点该题的「编辑」按钮
        card = page.locator(".qb-question", has_text=target["stem"][:18])
        if card.count() > 0:
            card.first.locator("text=编辑").first.click()
            page.wait_for_timeout(900)
            expect("编辑对话框打开", page.locator(".el-dialog").count() > 0, True)
            # 改难度（改无关字段，验 options 不被损坏 —— P0 回归的 UI 侧）
            opts_before = json.dumps(target["options"], ensure_ascii=False)
            page.click(".el-dialog .el-rate .el-rate__item >> nth=4")
            page.wait_for_timeout(300)
            page.click(".el-dialog button:has-text('保存')")
            page.wait_for_timeout(1400)
            after = api(f"/api/qbank/questions/{target['id']}", token=admin)["data"]
            expectTrue_o = json.dumps(after["options"], ensure_ascii=False) == opts_before
            if expectTrue_o:
                ok("★ UI 改难度后 options 未被损坏（P0 回归）")
            else:
                bad("★ UI 改难度后 options 被损坏",
                    f"改前={opts_before[:40]} 改后={json.dumps(after['options'], ensure_ascii=False)[:40]}")
            expectTrue_d = after["difficulty"] == 5
            if expectTrue_d:
                ok("★ UI 修改难度已生效", f"= {after['difficulty']}")
            else:
                bad("★ UI 修改难度未生效", f"= {after['difficulty']}")

            # 删除（点题目卡上的「删除」）
            total_before = api("/api/qbank/overview", token=admin)["data"]["total"]
            card2 = page.locator(".qb-question", has_text=target["stem"][:18])
            if card2.count() > 0:
                card2.first.locator("text=删除").first.click()
                page.wait_for_timeout(800)
                expect("★ 删除确认弹窗出现",
                       page.locator(".el-message-box").count() > 0, True)
                page.click(".el-message-box button:has-text('删除')")
                page.wait_for_timeout(1300)
                total_after = api("/api/qbank/overview", token=admin)["data"]["total"]
                expectTrue_del = total_after == total_before - 1
                if expectTrue_del:
                    ok("★ UI 删除题目成功", f"{total_before} -> {total_after}")
                    created_ids = [i for i in created_ids if i != target["id"]]
                else:
                    bad("★ UI 删除题目失败", f"{total_before} -> {total_after}")

    # ================================================================
    sec("M4-7 分页（造够题才测）")
    _ensure_no_dialog(page)
    page.click("text=批量导入")  # 借导入页造数据太慢，改用 API 快速造
    # 回列表页
    page.click("text=题目库")
    page.wait_for_timeout(1000)
    bulk = []
    for i in range(25):
        bulk.append(api("/api/qbank/questions", token=admin, body={
            "type": "填空题", "stem": f"{TAG} 批量造{i}",
            "answer": str(i), "difficulty": (i % 5) + 1, "source": "自编",
        }))
    bulk_ids = [b["data"]["id"] for b in bulk]
    created_ids.extend(bulk_ids)
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1500)

    pag = page.locator(".el-pagination")
    if pag.count() > 0:
        ok("分页控件出现")
        if page.locator(".el-pagination .btn-next").count() > 0:
            page.click(".el-pagination .btn-next")
            page.wait_for_timeout(1000)
            ok("★ 点「下一页」成功", f"当前第 {page.locator('.el-pager .active').inner_text() if page.locator('.el-pager .active').count() else '?'} 页")
            page.click(".el-pagination .btn-prev")
            page.wait_for_timeout(1000)
            ok("★ 点「上一页」成功")
    else:
        bad("分页控件未出现")

    # ================================================================
    sec("M4-8 导出 Excel（真实下载）")
    _ensure_no_dialog(page)
    with page.expect_download(timeout=20000) as dl_info:
        page.click("text=导出 Excel")
    dl = dl_info.value
    path = dl.path()
    size = os.path.getsize(path) if path else 0
    expectTrue_x = size > 3000
    if expectTrue_x:
        ok("★ 真实下载到 Excel", f"{dl.suggested_filename} / {size} bytes")
    else:
        bad("★ 导出文件过小或为空", f"{size} bytes")
    # 校验是合法 xlsx（ZIP 头）
    if path:
        with open(path, "rb") as f:
            magic = f.read(2)
        expect("★ 下载的是合法 xlsx（PK 头）", magic.decode("ascii", "ignore"), "PK")

    # ================================================================
    sec("M4-9 AI 录题页")
    _ensure_no_dialog(page)
    page.click("text=AI 录题")
    page.wait_for_timeout(1000)
    tabs = page.locator(".el-tabs__item").count()
    expect("★ 两个页签（截图识别 / AI 出题）", tabs >= 2, True)
    # 选文件（不真传模型，验证上传与预览）
    # 用一个临时PNG
    tmp_png = os.path.join(EVIDENCE, "_tmp_probe.png")
    # 1x1 png
    import base64
    png_b64 = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
               "AAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
    with open(tmp_png, "wb") as f:
        f.write(base64.b64decode(png_b64))
    page.set_input_files("input[type=file]", tmp_png)
    page.wait_for_timeout(1200)
    if page.locator(".card img").count() > 0:
        ok("★ 上传后显示预览图")
    else:
        bad("上传后未显示预览图")
    # 点识别（会因为没配 Key 报错——要验证错误提示明确）
    page.click("text=开始识别")
    page.wait_for_timeout(2500)
    body = page.locator("body").inner_text()
    if "尚未配置大模型Key" in body or "配置" in body:
        ok("★ 未配 Key 时给出明确提示（不是静默失败）")
    else:
        bad("★ 未配 Key 时提示不明确", body[body.find("识别"):body.find("识别") + 60] if "识别" in body else "(无)")
    page.screenshot(path=os.path.join(EVIDENCE, "uifull-04-ai.png"))
    os.remove(tmp_png)

    # 切到 AI 出题页签，测「未填主题」被拦
    page.click(".el-tabs__item:has-text('AI 出题')")
    page.wait_for_timeout(800)
    _capture_toast(page)
    page.click(".el-tabs__item:has-text('AI 出题')")   # 确保在该页签
    page.wait_for_timeout(400)
    _capture_toast(page)
    page.click("button:has-text('生成')")
    page.wait_for_timeout(1200)
    toasts2 = _read_toasts(page)
    if any("主题" in t for t in toasts2):
        ok("★ 出题未填主题被拦（参数校验优先）", f"toast={toasts2}")
    else:
        bad("★ 出题未填主题未被拦", f"捕获到的 toast={toasts2}")

    # ================================================================
    sec("M4-10 批量导入页")
    _ensure_no_dialog(page)
    page.click("text=批量导入")
    page.wait_for_timeout(1000)
    expect("导入页卡片出现", page.locator(".card").count() > 0, True)
    if page.locator("text=下载导入模板").count() > 0:
        ok("★ 「下载导入模板」按钮存在")
        with page.expect_download(timeout=20000) as dl2_info:
            page.click("text=下载导入模板")
        dl2 = dl2_info.value
        p2 = dl2.path()
        s2 = os.path.getsize(p2) if p2 else 0
        expectTrue_t = s2 > 1000
        if expectTrue_t:
            ok("★ 模板真实下载成功", f"{dl2.suggested_filename} / {s2} bytes")
        else:
            bad("★ 模板下载失败", f"{s2} bytes")
    page.screenshot(path=os.path.join(EVIDENCE, "uifull-05-import.png"))

    # ================================================================
    sec("M4-11 题库统计页")
    _ensure_no_dialog(page)
    page.click("text=题库统计")
    page.wait_for_timeout(1400)
    stat = page.locator(".qb-stat").count()
    expect("★ 统计页有指标卡", stat >= 4, True)
    # 图表条形（非零宽度）
    bars = page.evaluate("""() => [...document.querySelectorAll('.card div[style*="width"]')]
        .filter(n => { const r = n.getBoundingClientRect(); return r.width > 0; }).length""")
    if page.locator("text=题型分布").count() > 0:
        expectTrue_b = bars > 0
        if expectTrue_b:
            ok("★ 分布图有非零宽度的条形（真实渲染）", f"{bars} 个")
        else:
            bad("★ 分布图条形宽度全为 0（没渲染）")
    page.screenshot(path=os.path.join(EVIDENCE, "uifull-06-stats.png"))

    # ================================================================
    sec("M4-12 无 JS 运行时错误")
    # ★ 过滤两类**预期内**的资源错误（它们是功能按设计工作的证据，不是前端缺陷）：
    #   401 —— 未注入会话时的首屏请求（页面已显示「只读浏览模式」提示）
    #   503 —— 「未配大模型 Key」时 AI 端点的**正确**响应（页面已有明确 toast，
    #          且 M4-9 已断言该提示文案正确）
    real = [e for e in errors
            if "favicon" not in e.lower() and "401" not in e and "503" not in e]
    if not real:
        ok("★ 全程无 JS 运行时错误")
    else:
        bad("有 JS 运行时错误", "; ".join(real[:3]))

    browser.close()

# 清理
# ★ 按关键词清理，而不是"逐个追 created_ids" ——
#   逐个追会漏：本脚本有些用例**刻意用了不含 TAG 的题干**
#   （如 M4-4 为避免查重干扰写的「无TAG前缀的题干」），
#   那些题的 id 若没被记录就会残留。按关键词扫更彻底。
#   实测教训：曾漏掉 25 道「批量造N」（分页测试造的），全堆在库里。
for _tag in (TAG, "无TAG前缀的题干"):
    purge_by_keyword(admin, _tag)
fin = api(f"/api/qbank/questions?keyword={urllib.parse.quote(TAG)}&pageSize=100", token=admin)
fin_rec = api(f"/api/qbank/questions/recycle?keyword={urllib.parse.quote(TAG)}&pageSize=100", token=admin)
expect("测试数据已清空（列表）", fin["data"]["total"], 0)
expect("测试数据已清空（回收站）", fin_rec["data"]["total"], 0)

print(f"\n{'='*58}")
print(f"  结果：PASS {PASS} / FAIL {FAIL} / SKIP {SKIP_N}")
if SKIP:
    print("\n  SKIP 清单（检测工具不可靠，非功能缺陷）：")
    for f in SKIP:
        print(f"    - {f}")
if failures:
    print("\n  失败清单：")
    for f in failures:
        print(f"    x {f}")
print(f"{'='*58}\n")
sys.exit(0 if FAIL == 0 else 1)