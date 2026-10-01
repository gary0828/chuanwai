#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""AI 教学工作台浏览器走查（Playwright）

用法：python _verify_test/ui-ai-workbench.py [base]
默认 base = http://127.0.0.1:5300；Docker 部署为 http://localhost:18080/ai
截图输出到 evidence/ai-workbench-*.png

注意：本脚本**不注入 agentToken**，因此以「演示身份」运行 ——
涉及真实教务数据的接口会返回 401，这是预期行为而非缺陷。
（需要验证真实数据链路的场景请用 ui-provider-c1.py / ui-growth-verify.py）
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5300"
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "evidence"
OUT.mkdir(exist_ok=True)

results = []


def check(name, cond, extra=""):
    results.append((name, bool(cond)))
    mark = "PASS" if cond else "FAIL"
    tail = "" if cond else f"  -> {extra}"
    print(f"  {mark}  {name}{tail}")


PAGES = [
    ("#/", "ai-workbench-01-dashboard.png", "当前单元行动台", "现在教到哪"),
    ("#/course", "ai-workbench-02-course.png", "课程设计", "单元结构"),
    ("#/lesson", "ai-workbench-03-lesson.png", "备课方案", "备课一致性检查"),
    ("#/teaching", "ai-workbench-04-teaching.png", "授课流程", "课堂环节卡"),
    ("#/homework", "ai-workbench-05-homework.png", "作业设计", "题库选题"),
    ("#/evaluation", "ai-workbench-06-evaluation.png", "作业检查与评价", "错因归集"),
    ("#/growth", "ai-workbench-11-growth.png", "学生成长路径", "每步过程与多维证据"),
    ("#/report", "ai-workbench-07-report.png", "学习分析与报告", "日常表现"),
    ("#/parent", "ai-workbench-08-parent.png", "家长反馈", "本模块只生成文案"),
    ("#/knowledge", "ai-workbench-09-knowledge.png", "AI 知识库", "知识点树与班级掌握度"),
    ("#/settings", "ai-workbench-10-settings.png", "底座与设置", "出网脱敏规则"),
]

# 侧边栏导航项数量 = 上表条数（含成长路径），改菜单时同步改这里
EXPECTED_NAV = len(PAGES)

errors = []

print(f"\n=== AI 教学工作台浏览器走查 @ {BASE} ===\n")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1500, "height": 940})
    page.on(
        "console",
        lambda m: errors.append(f"[console] {m.text}") if m.type == "error" else None,
    )
    page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))

    # 侧边栏导航项
    page.goto(f"{BASE}/#/", wait_until="domcontentloaded")
    page.wait_for_timeout(1000)
    nav_count = page.locator(".nav-item").count()
    check(f"侧边栏 {EXPECTED_NAV} 个导航项", nav_count == EXPECTED_NAV, f"实际 {nav_count}")

    for path, shot, title, anchor in PAGES:
        page.goto(f"{BASE}/{path}", wait_until="domcontentloaded")
        page.wait_for_timeout(700)
        body = page.inner_text("body")
        check(f"{title} 渲染正常", len(body) > 300 and anchor in body, body[:70].replace("\n", " "))
        page.screenshot(path=str(OUT / shot))

    # 生成一次产出（首页）
    page.goto(f"{BASE}/#/", wait_until="domcontentloaded")
    page.wait_for_timeout(800)
    btn = page.locator("button:has-text('生成下一步建议')")
    check("首页存在「生成下一步建议」按钮", btn.count() > 0)
    if btn.count() > 0:
        btn.first.click()
        page.wait_for_timeout(1500)
        txt = page.inner_text("body")
        check("生成后出现 AI 产出标识", "AI 生成，请核对后使用" in txt)
        check("产出引用本地指标", "出勤率" in txt and "掌握度" in txt)
        page.screenshot(path=str(OUT / "ai-workbench-11-generate.png"), full_page=True)

        # 展开生成说明，验证脱敏审计可见
        toggle = page.locator("text=查看生成说明")
        if toggle.count() > 0:
            toggle.first.click()
            page.wait_for_timeout(500)
            meta = page.inner_text("body")
            check("生成说明展示数据依据与脱敏", "数据依据" in meta and "出网脱敏" in meta)
            page.screenshot(path=str(OUT / "ai-workbench-12-meta.png"), full_page=True)

    # 学情报告页生成一次
    page.goto(f"{BASE}/#/report", wait_until="domcontentloaded")
    page.wait_for_timeout(800)
    rbtn = page.locator("button:has-text('生成报告叙述')")
    if rbtn.count() > 0:
        rbtn.first.click()
        page.wait_for_timeout(1500)
        rtxt = page.inner_text("body")
        check("报告页可生成叙述且含日常表现", "日常表现" in rtxt)
        page.screenshot(path=str(OUT / "ai-workbench-13-report-gen.png"), full_page=True)

    # 演示身份下真实数据接口会返回 401，属预期噪音，不计入失败；
    # 只保留真正的脚本错误（pageerror / 非 401 的资源错误）。
    real_errors = [
        e for e in errors
        if "401" not in e and "Unauthorized" not in e
    ]
    check("无控制台错误（已忽略演示身份的 401）", len(real_errors) == 0,
          "; ".join(real_errors[:3]) or f"忽略 {len(errors) - len(real_errors)} 条 401")
    browser.close()

fails = [r for r in results if not r[1]]
print(f"\n结果：{len(results) - len(fails)} 通过 / {len(fails)} 失败\n")
sys.exit(1 if fails else 0)
