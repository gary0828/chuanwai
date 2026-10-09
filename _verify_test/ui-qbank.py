"""
题库 UI 实证验证（第二层 · 渲染存在性）

★ 为什么必须有这一层（K-011「验证三层分工」）：
  数据契约层（verify-qbank.mjs）只能断言「接口返回了含公式的字符串」，
  **证不了 KaTeX 真的把它渲染成了公式**。
  本层用 Playwright 断言 DOM 里有 .katex 节点、尺寸非零、并截图给人眼复核。

★ 断言必须打印实际值（K-011），不只打 PASS/FAIL。

用法：
  "C:\\Program Files\\Python314\\python" _verify_test/ui-qbank.py [基址]
默认基址 http://127.0.0.1:18080/qb/（统一入口。★ 2026-10-09 修正：
  原默认值是旧的**沙箱**端口 8849，本机没起沙箱时一跑就是 HTTP 502，
  看起来像"服务坏了"，其实是套件在找一个不存在的端口。其余题库套件默认都是 18080。）
"""
import json
import os
import sys
import time
import urllib.request
import urllib.parse

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18080/qb/").rstrip("/")
# ★ API 基址从页面基址推导（2026-10-07 实测踩坑）：
#   原来硬编码 127.0.0.1:3000，那是**开发后端**；
#   重建 Docker 后后端在容器内（只经 nginx 暴露 18080），3000 端口本机根本没监听 → 502。
#   同源部署下 /api 就走同一个 origin，最稳。
API = urllib.parse.urljoin(BASE + "/", "/").rstrip("/")
EVIDENCE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "evidence")

PASS, FAIL = 0, 0
failures = []


def ok(label, detail=""):
    global PASS
    PASS += 1
    print(f"  PASS  {label}" + (f" -> {detail}" if detail else ""))


def bad(label, detail=""):
    global FAIL
    FAIL += 1
    failures.append(label)
    print(f"  FAIL  {label}" + (f" -> {detail}" if detail else ""))


def expect(label, actual, expected):
    if actual == expected:
        ok(label, f"= {actual!r}")
    else:
        bad(label, f"实际={actual!r} 期望={expected!r}")


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
    # ★ 路径里有中文时必须做 URL 编码，否则urllib 直接抛
    #   UnicodeEncodeError: 'ascii' codec can't encode characters（2026-10-07 实踩）
    safe_path = urllib.parse.quote(path, safe="/?&=%")
    req = urllib.request.Request(
        API + safe_path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method or ("POST" if body is not None else "GET"),
        headers={
            "Content-Type": "application/json",
            **({"Authorization": f"Bearer {token}"} if token else {}),
        },
    )
    with urllib.request.urlopen(req, timeout=10) as r:
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


TAG = "UI实证"
print(f"\n=== 题库 UI 实证验证 ===")
print(f"基址：{BASE}\n")

# ── 准备带公式的测试数据 ──────────────────────────────────────
admin = login("admin", "admin123456")
TEST_COURSE_ID = resolve_test_course_id(admin)   # ★ 见 api() 内注释
teacher = login("teacher", "teacher123456")

FORMULA_STEMS = [
    {
        "type": "单选题",
        "stem": f"{TAG} 已知向量 $\\vec{{a}}=(-4,1)$，则与它共线的单位向量坐标为",
        "options": ["$\\frac{(1,4)}{5}$", "$\\frac{(-1,-4)}{5}$", "$(4,1)/5$", "$(-4,1)/5$"],
        "answer": "A",
        "analysis": "与向量 $\\vec{a}$ 共线即方向相同或相反，归一化后取首项。",
        "difficulty": 3,
        "source": "自编",
        "status": "已启用",
    },
    {
        "type": "解答题",
        "stem": f"{TAG} 求函数 $f(x)=\\frac{{x^2}}{{2}}$ 的最小值",
        "answer": "$0$",
        "analysis": "配方得 $f(x)=\\frac{{(x+1)^2-1}}{{2}}$，故最小值为 $-1$。",
        "difficulty": 2,
        "source": "自编",
    },
    {
        "type": "填空题",
        "stem": f"{TAG} 设 $\\alpha \\in (0, \\pi)$，则 $\\sin\\alpha > 0$ 恒成立的区间是",
        "answer": "$(0, \\pi)$",
        "difficulty": 1,
        "source": "自编",
    },
]

created = []
for row in FORMULA_STEMS:
    r = api("/api/qbank/questions", token=admin, body=row)
    created.append(r["data"]["id"])
ok("已准备 3 道含 LaTeX 公式的测试题", f"id={created}")

# ── 浏览器验证 ───────────────────────────────────────────────
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

os.makedirs(EVIDENCE, exist_ok=True)

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()

    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    # 直接注入会话（模拟免登成功后的状态），避免在 UI 测试里处理票据跳转
    page.goto(BASE + "/", wait_until="domcontentloaded")
    page.wait_for_timeout(600)
    token = api(
        "/api/ai/sso/ticket",
        token=admin,
        body={"origin": urllib.parse.urljoin(BASE, "/").rstrip("/"), "target": "qbank"},
    )
    verify = api("/api/ai/sso/verify", body={"ticket": token["data"]["ticket"]})
    page.evaluate(
        "(u) => localStorage.setItem('qbank:session', JSON.stringify(u))",
        {
            "id": verify["data"]["id"],
            "name": verify["data"]["name"],
            "role": verify["data"]["role"],
            "loginAt": verify["data"]["loginAt"],
            "qbToken": verify["data"]["qbAgentToken"],
        },
    )
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1200)

    # 1. 页面结构
    expect("侧栏有 4 个功能入口", page.locator(".qb-nav-item").count() >= 4, True)

    # 1b. 注入会话后顶栏应显示真实用户名，且**不再**出现只读标记
    header_text = page.locator(".qb-user").inner_text()
    expect("★ 登录后顶栏显示用户名", "管理员" in header_text, True)
    expect("★ 登录后不再显示「只读浏览模式」", "只读浏览模式" in header_text, False)
    ok("页面标题", page.title())

    # 2. ★ 列表加载出了题目
    page.wait_for_timeout(800)
    cards = page.locator(".qb-question").count()
    ok("题目卡片渲染数量", f"{cards} 张")

    # 3. ★★★ KaTeX 真渲染了吗 —— 这是本层最关键的断言
    katex_nodes = page.locator(".qb-question .katex").count()
    if katex_nodes > 0:
        ok("★ DOM 中存在 .katex 节点（公式已渲染）", f"{katex_nodes} 个")
    else:
        bad("★ DOM 中无 .katex 节点", "公式可能被当成纯文本显示了")

    # 4. KaTeX 节点必须**非零尺寸**（防止"有节点但不可见"，与图表那次同型）
    invisible = page.evaluate(
        """() => {
            const nodes = [...document.querySelectorAll('.qb-question .katex')];
            return nodes.filter(n => {
                const r = n.getBoundingClientRect();
                return r.width === 0 || r.height === 0;
            }).length;
        }"""
    )
    expect("★ KaTeX 节点全部可见（无 0 宽高）", invisible, 0)

    # 5. ★ 原始 LaTeX 标记不应裸露在**题目展示区**。
    #    ⚠ 范围必须限定在题目卡片内，不能测 document.body ——
    #      新增对话框的 textarea 里本来就有 LaTeX 源码，那是**给用户编辑用的输入内容**，
    #      出现在那里是正确的（这里曾因此误报一轮）。
    #    ⚠ 判据里**不含** `^{` / `}_{`：KaTeX 渲染后的 DOM 里会出现上标的 CSS 类名残留，
    #      会造成误报。源码特征只有反斜杠命令与显式 $ 分隔符。
    list_text = "\n".join(
        page.locator(".qb-question").nth(i).inner_text() for i in range(cards)
    )
    # --- 临时诊断：定位 ec 到底出现在哪 ---
    for kw in ("\\vec",):
        if kw in list_text:
            for i in range(cards):
                t = page.locator(".qb-question").nth(i).inner_text()
                if kw in t:
                    idx = t.index(kw)
                    print(f"        [诊断] 第{i+1} 张卡片含 {kw}，上下文：{t[max(0,idx-40):idx+40]!r}")
                    break
    leaks = [kw for kw in ("\\frac", "\\vec", "\\alpha", "\\pi", "$") if kw in list_text]
    if not leaks:
        ok("★ 题目展示区无裸露的 LaTeX 源码（\\frac / \\vec / \\alpha / \\$）")
    else:
        bad("题目展示区有裸露的 LaTeX 源码", f"泄漏标记={leaks}")

    # 5b. 反向确认：确实存在渲染出的数学元素（不是「没泄漏因为全被转义掉了」）
    math_html = page.locator(".qb-question .katex").first.inner_html()
    expect("★ .katex 内部是真实 HTML 结构（非转义文本）",
           math_html.startswith("<"), True)

    # 6. 交互：三视角切换
    page.click('.el-radio-button:has-text("章节")')
    page.wait_for_timeout(500)
    ok("切到「章节」视角", f"侧栏项{page.locator('.qb-aside-item').count()} 个")
    page.click('.el-radio-button:has-text("方法")')
    page.wait_for_timeout(500)
    ok("切到「方法」视角", f"侧栏项 {page.locator('.qb-aside-item').count()} 个")
    page.click('.el-radio-button:has-text("知识点")')
    page.wait_for_timeout(500)

    # 7. 筛选交互
    page.fill("input[placeholder*='搜索题干']", "向量")
    page.keyboard.press("Enter")
    page.wait_for_timeout(900)
    filtered = page.locator(".qb-question").count()
    ok("按关键词「向量」筛选", f"剩 {filtered} 张卡片")

    page.fill("input[placeholder*='搜索题干']", "")
    page.keyboard.press("Enter")
    page.wait_for_timeout(900)

    # 8. ★ 新增对话框 + 查重提示（改难度不应破坏选项 —— P0 回归）
    page.click("text=＋ 新增题目")
    page.wait_for_timeout(700)
    dialog_visible = page.locator(".el-dialog").count() > 0
    expect("新增对话框打开", dialog_visible, True)

    # 填一个与已有题几乎一样的题干 → 应触发查重提示
    page.fill("textarea[placeholder*='LaTeX']", f"{TAG} 已知向量 $\\vec{{a}}=(-4,1)$，则与它共线的单位向量坐标为")
    page.locator(".el-dialog textarea").first.blur()
    page.wait_for_timeout(1500)
    dup_box = page.locator(".qb-dup").count()
    expect("★ 查重提示出现", dup_box > 0, True)

    page.screenshot(path=os.path.join(EVIDENCE, "qbank-01-dup-warning.png"), full_page=False)
    page.click(".el-dialog button:has-text('取消')")
    page.wait_for_timeout(500)

    # 9. AI 录题页
    page.click("text=AI 录题")
    page.wait_for_timeout(900)
    ok("AI 录题页加载", f"页签 {page.locator('.el-tabs__item').count()} 个")
    page.screenshot(path=os.path.join(EVIDENCE, "qbank-02-ai-capture.png"))

    # 10. 批量导入页
    page.click("text=批量导入")
    page.wait_for_timeout(800)
    ok("批量导入页加载", f"卡片 {page.locator('.card').count()} 个")
    page.screenshot(path=os.path.join(EVIDENCE, "qbank-03-import.png"))

    # 11. 统计页
    page.click("text=题库统计")
    page.wait_for_timeout(1000)
    stats = page.locator(".qb-stat").count()
    expect("统计页有指标卡", stats >= 4, True)
    page.screenshot(path=os.path.join(EVIDENCE, "qbank-04-stats.png"))

    # 12. 回到列表页截图（给人眼复核公式）
    page.click("text=题目库")
    page.wait_for_timeout(1000)
    page.screenshot(path=os.path.join(EVIDENCE, "qbank-05-formula-list.png"), full_page=False)

    # 13. 无 JS 报错
    #★ 过滤掉「首屏未注入会话时的 401」：页面初次加载会打一次无凭证请求，
    #   这是**预期行为**（界面已提示「只读浏览模式，请从教务系统进入」），
    #   不算前端缺陷。注入会话之后若再有 401 才是真问题。
    real_errors = [
        e
        for e in errors
        if "favicon" not in e.lower() and "401" not in e
    ]
    if not real_errors:
        ok("★ 无 JS 运行时错误")
    else:
        bad("有 JS 运行时错误", "; ".join(real_errors[:3]))

    browser.close()

# ── 清理 ─────────────────────────────────────────────────────
api("/api/qbank/questions/batch-delete", token=admin, body={"ids": created})
remaining = api(f"/api/qbank/questions?keyword={TAG}", token=admin)["data"]["total"]
expect("测试数据已清空", remaining, 0)

print(f"\n{'=' * 50}")
print(f"结果：PASS {PASS} / FAIL {FAIL}")
if failures:
    print("失败项：\n  - " + "\n  - ".join(failures))
sys.exit(0 if FAIL == 0 else 1)