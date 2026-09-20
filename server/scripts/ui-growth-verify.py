"""AI 工作台成长路径 + 课后采集 浏览器验证

验证目标（对齐项目门禁「每个功能改动都要浏览器验证」）：
1. 侧边栏出现「学生成长路径」菜单
2. 成长路径页 - 整班视角：班级成长曲线、知识点掌握全景渲染
3. 成长路径页 - 单学员视角：成长曲线、里程碑、过程记录明细
4. 授课流程页：课后采集面板展开、三维评分、知识点打勾可见
5. 控制台无报错
"""
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8082"
TOKEN = sys.argv[2] if len(sys.argv) > 2 else ""
EVID = "evidence/ai-workbench-growth"
import os
os.makedirs(EVID, exist_ok=True)

results = []


def check(name, ok, extra=""):
    results.append((name, ok, extra))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  | {extra}" if extra else ""))


def url_for(hash_path):
    sep = "&" if "?" in BASE else "?"
    t = f"{sep}token={TOKEN}" if TOKEN else ""
    return f"{BASE}/{t}#{hash_path}"


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()

    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

    # ---------- 0. 切到真实数据源 ----------
    page.goto(url_for("/"), wait_until="networkidle")
    page.wait_for_timeout(1200)

    # 尝试把数据源选择器切到「真实教务数据」
    switched = False
    try:
        sels = page.locator(".top-right .el-select").first
        sels.click()
        page.wait_for_timeout(400)
        opt = page.locator(".el-select-dropdown__item", has_text="真实教务数据").first
        if opt.count():
            opt.click()
            page.wait_for_timeout(1800)
            switched = True
    except Exception as e:
        print("切换数据源异常:", e)
    check("数据源可切到「真实教务数据」", switched)

    banner = ""
    try:
        banner = page.locator(".demo-banner").inner_text()
    except Exception:
        pass
    check("顶部横幅提示真实数据", "真实教务数据" in banner, banner[:70])

    # ---------- 1. 侧边栏菜单 ----------
    nav_text = page.locator(".nav").inner_text()
    check("侧边栏含「学生成长路径」", "学生成长路径" in nav_text)
    page.screenshot(path=f"{EVID}/01-sidebar.png", full_page=False)

    # ---------- 2. 成长路径 - 整班 ----------
    page.goto(url_for("/growth"), wait_until="networkidle")
    page.wait_for_timeout(2000)
    body = page.locator(".page").inner_text()

    check("整班视角标题", "成长路径" in body and "整班" in body)
    check("班级课堂表现趋势卡片", "班级课堂表现趋势" in body)
    check("知识点掌握全景表格", "知识点掌握全景" in body)
    check("掌握度待加强卡片", "掌握度待加强" in body or "已较好掌握" in body)
    check("各次课明细表（参评人数口径）", "各次课明细" in body)

    svg_count = page.locator("svg.svg").count()
    check("整班渲染出折线图", svg_count >= 1, f"svg={svg_count}")

    rows = page.locator(".kp-table tbody tr").count()
    check("知识点表格有数据行", rows > 0, f"rows={rows}")

    page.screenshot(path=f"{EVID}/02-growth-class.png", full_page=True)

    # ---------- 3. 成长路径 - 单学员 ----------
    try:
        page.locator(".el-radio-button", has_text="单个学员").first.click()
        page.wait_for_timeout(2200)
    except Exception as e:
        print("切单学员异常:", e)

    sbody = page.locator(".page").inner_text()
    check("单学员视角切换成功", "的成长路径" in sbody or "课堂表现曲线" in sbody)
    check("成长里程碑区块", "成长里程碑" in sbody)
    check("过程记录明细表格", "过程记录明细" in sbody)
    check("知识点成长区块", "知识点成长" in sbody)
    # 时间范围不能漏出后端的哨兵值
    check("时间范围未漏哨兵值", "9999-12-31" not in sbody and "0000-01-01" not in sbody)

    tl_rows = page.locator(".tl-table tbody tr").count()
    check("过程记录明细有数据", tl_rows > 0, f"rows={tl_rows}")

    ms_items = page.locator(".ms-item").count()
    check("里程碑有记录", ms_items > 0, f"items={ms_items}")

    kpp = page.locator(".kp-prog").count()
    check("知识点成长有记录", kpp > 0, f"items={kpp}")

    page.screenshot(path=f"{EVID}/03-growth-student.png", full_page=True)

    # AI 面板存在
    check("AI 成长叙述面板存在", page.locator("text=AI 成长叙述").count() > 0)

    # ---------- 4. 授课流程 - 课后采集 ----------
    page.goto(url_for("/teaching"), wait_until="networkidle")
    page.wait_for_timeout(2200)
    tbody = page.locator(".page").inner_text()

    check("课后记录面板存在", "课后记录" in tbody)
    check("含①课堂评价页签", "课堂评价" in tbody)
    check("含②知识点打勾页签", "知识点打勾" in tbody)
    check("一键填全班存在", "一键填全班" in tbody)

    eval_rows = page.locator(".eval-row").count()
    check("学员评价行已渲染", eval_rows > 0, f"rows={eval_rows}")

    dots = page.locator(".eval-row .dot").count()
    check("三维评分按钮已渲染", dots > 0, f"dots={dots}")

    page.screenshot(path=f"{EVID}/04-teaching-collect.png", full_page=True)

    # 切到知识点页签
    try:
        page.locator(".tab", has_text="知识点打勾").first.click()
        page.wait_for_timeout(900)
    except Exception as e:
        print("切页签异常:", e)

    kp_rows = page.locator(".kp-row").count()
    check("知识点打勾行已渲染", kp_rows > 0, f"rows={kp_rows}")

    # ★ 单元分组：知识点属于哪一章（单元节点被后端过滤，只把单元名带下来做标题）
    kp_units = page.locator(".kp-unit").count()
    check("知识点按单元分组显示", kp_units > 0, f"units={kp_units}")

    unit_text = ""
    try:
        unit_text = page.locator(".kp-unit").first.inner_text()
    except Exception:
        pass
    # 单元标题应同时有"单元名"和"打勾进度 x/y"
    check(
        "单元标题含进度",
        ("/" in unit_text) and ("单元" in unit_text),
        unit_text.replace("\n", " ")[:40],
    )
    page.screenshot(path=f"{EVID}/05-teaching-kp.png", full_page=True)

    # ---------- 5. 控制台 ----------
    real_errors = [e for e in errors if "favicon" not in e.lower()]
    check("浏览器控制台无报错", len(real_errors) == 0, "; ".join(real_errors[:3]))

    browser.close()

total = len(results)
passed = sum(1 for _, ok, _ in results if ok)
print(f"\n=== 浏览器验证 {passed}/{total} 通过 ===")
sys.exit(0 if passed == total else 1)
