#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""工作台「服务端模型」模式端到端验证：免登 → 切模式 → 生成 → 校验标注与脱敏

用法：python _verify_test/ui-llm-mode.py
截图输出 evidence/llm-*.png
"""
import pathlib
import sys

from playwright.sync_api import sync_playwright

WEB = "http://127.0.0.1:18080"
# 必须与后端 AI_WORKBENCH_URL 的 host 完全一致：
# 免登会把会话写进该 origin 的 localStorage，混用 localhost / 127.0.0.1 会导致会话丢失
WB = "http://localhost:18080/ai"
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "evidence"
OUT.mkdir(exist_ok=True)

results = []


def check(name, cond, extra=""):
    results.append((name, bool(cond)))
    print(("  PASS  " if cond else "  FAIL  ") + name + ("" if cond else f"  -> {extra}"))


print("\n=== 工作台「服务端模型」端到端验证 ===\n")

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1500, "height": 940})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))
    page.on(
        "console",
        lambda m: errors.append(f"[console] {m.text}") if m.type == "error" else None,
    )

    # 1) 通过免登票据进入工作台
    r = ctx.request.post(
        f"{WEB}/api/auth/login",
        data={"type": "password", "username": "admin", "password": "admin123456"},
    )
    token = r.json()["data"]["accessToken"]
    r2 = ctx.request.post(
        f"{WEB}/api/ai/sso/ticket", headers={"Authorization": f"Bearer {token}"}
    )
    url = r2.json()["data"]["url"]
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_timeout(2200)
    check("免登进入工作台", "已免登接入" in page.inner_text("body"))

    # 2) 设置页打开且底座选项齐全（内容异步渲染，用条件等待而非固定 sleep）
    page.goto(f"{WB}/#/settings", wait_until="domcontentloaded")
    ok_page = True
    try:
        page.wait_for_selector("text=规则引擎（零配置）", timeout=15000)
    except Exception:  # noqa: BLE001
        ok_page = False
    check("设置页打开且底座选项齐全", ok_page, page.inner_text("body")[:140])

    # 3) 切到「服务端模型」并保存 —— 模型名在选中 server 模式后才渲染（v-if）
    ok_switch = True
    try:
        page.locator("label:has-text('服务端模型')").first.click()
        page.wait_for_timeout(500)
        page.locator("button:has-text('保存配置')").first.click()
        page.wait_for_selector("text=deepseek-flash", timeout=15000)
    except Exception as exc:  # noqa: BLE001
        ok_switch = False
        print(f"  切换异常: {str(exc)[:120]}")
    check(
        "已切换到服务端模型并识别到 deepseek-flash",
        ok_switch,
        page.inner_text("body")[:140],
    )
    page.screenshot(path=str(OUT / "llm-01-settings.png"))

    # 4) 回首页生成（走真实模型，最长等 90 秒）
    page.goto(f"{WB}/#/", wait_until="domcontentloaded")
    page.wait_for_timeout(1200)
    page.locator("button:has-text('生成下一步建议')").first.click()
    print("  等待真实模型生成（最长 90 秒）…")
    ok_gen = False
    try:
        # 生成记录卡先出现；模式标签在「生成说明」面板里，默认折叠，需先展开
        page.wait_for_selector("text=查看生成说明", timeout=90000)
        page.locator("text=查看生成说明").first.click()
        page.wait_for_timeout(800)
        ok_gen = True
    except Exception:  # noqa: BLE001
        pass

    txt = page.inner_text("body")
    check("生成完成且标注为服务端模型", ok_gen and "服务端模型生成" in txt, txt[:150])
    check("产出引用本地指标", "出勤率" in txt or "掌握度" in txt, txt[:150])

    # 5) 生成说明已展开，确认脱敏与模型信息可见
    check("生成说明可见数据依据", "数据依据" in txt)
    check("生成说明可见脱敏项", "出网脱敏" in txt)

    page.screenshot(path=str(OUT / "llm-02-generated.png"), full_page=True)

    real_errors = [e for e in errors if "401" not in e]
    check("无控制台错误（忽略未登录 401）", len(real_errors) == 0, "; ".join(real_errors[:2]))
    browser.close()

fails = [r for r in results if not r[1]]
print(f"\n结果：{len(results) - len(fails)} 通过 / {len(fails)} 失败\n")
sys.exit(1 if fails else 0)
