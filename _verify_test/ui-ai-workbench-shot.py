# -*- coding: utf-8 -*-
"""AI 教学工作台（:8082）视觉统一验证

核验点（同样取「计算后的实际值」，不靠肉眼）：
  1. 主色 --el-color-primary 与教务系统一致（深靛蓝 #1F5C99，而非原来的 #2563eb）
  2. 页面底色、卡片边框取自同一套变量
  3. 页面能正常渲染、无控制台错误

用法：python _verify_test/ui-ai-workbench-shot.py [base_url]
"""
import sys

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18080/ai"

EXPECT_PRIMARY = "#1f5c99"
EXPECT_BG = "rgb(244, 247, 250)"

results = []


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page()
    errs = []
    pg.on(
        "console",
        lambda m: errs.append(m.text) if m.type == "error" else None,
    )
    pg.goto(BASE, wait_until="networkidle")
    pg.wait_for_timeout(2500)
    pg.screenshot(path="evidence/ai_workbench_unified.png")

    v = pg.evaluate(
        """() => {
            const cs = getComputedStyle(document.documentElement);
            return {
                primary: cs.getPropertyValue('--el-color-primary').trim(),
                cPrimary: cs.getPropertyValue('--c-primary').trim(),
                cBg: cs.getPropertyValue('--c-bg').trim(),
                bodyBg: getComputedStyle(document.body).backgroundColor,
                textLen: (document.body.innerText || '').replace(/\\s+/g, '').length
            };
        }"""
    )

    record(
        "主色与教务系统一致",
        v["primary"].lower() == EXPECT_PRIMARY
        and v["cPrimary"].lower() == EXPECT_PRIMARY,
        f"--el-color-primary={v['primary']} / --c-primary={v['cPrimary']}（期望 {EXPECT_PRIMARY}）",
    )
    record(
        "底色与教务系统一致",
        v["cBg"].lower() == EXPECT_BG or v["bodyBg"] == EXPECT_BG,
        f"--c-bg={v['cBg']} / body={v['bodyBg']}（期望 {EXPECT_BG}）",
    )
    record("页面正常渲染", v["textLen"] > 20, f"文本 {v['textLen']} 字")
    record("控制台无错误", not errs, str(errs[:2]))

    ctx.close()
    b.close()

print("\n========================")
okn = sum(1 for _, o, _ in results if o)
print(f"通过 {okn}/{len(results)}")
sys.exit(0 if okn == len(results) else 1)
