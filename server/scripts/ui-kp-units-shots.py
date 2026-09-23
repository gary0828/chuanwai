"""知识点采集区单元分组的精准截图。

为什么单独写：通用截图脚本按固定比例滚动，抓不到采集面板的知识点区域
（它在「课后记录」折叠面板内部，位置随内容浮动）。
这里直接用 locator 定位元素截图，稳定且不依赖滚动比例。
"""
import sys
import os
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18080/ai"
TOKEN = sys.argv[2] if len(sys.argv) > 2 else ""
EVID = "evidence/ai-workbench-growth"
os.makedirs(EVID, exist_ok=True)


def url_for(hash_path):
    sep = "&" if "?" in BASE else "?"
    t = f"{sep}token={TOKEN}" if TOKEN else ""
    return f"{BASE}/{t}#{hash_path}"


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 1100})
    page = ctx.new_page()

    page.goto(url_for("/teaching"), wait_until="networkidle")
    page.wait_for_timeout(2500)

    # 展开采集面板（若已收起）
    try:
        btn = page.locator("text=展开").first
        if btn.count():
            btn.click()
            page.wait_for_timeout(600)
    except Exception:
        pass

    # 切到「知识点打勾」页签
    try:
        page.locator(".tab", has_text="知识点打勾").first.click()
        page.wait_for_timeout(900)
    except Exception as e:
        print("切页签异常:", e)

    # 定位知识点列表容器并截图
    for sel, name in [
        (".kp-list", "kp-list-units"),
        (".card:has-text('课后记录')", "collect-panel"),
    ]:
        loc = page.locator(sel).first
        try:
            if loc.count():
                loc.scroll_into_view_if_needed()
                page.wait_for_timeout(400)
                loc.screenshot(path=f"{EVID}/08-{name}.png")
                print("OK", sel, "->", f"08-{name}.png")
            else:
                print("MISS", sel)
        except Exception as e:
            print("ERR", sel, e)

    # 打印单元标题文本，确认分组渲染
    try:
        units = page.locator(".kp-unit")
        print(f"\n单元分组数: {units.count()}")
        for i in range(units.count()):
            print("  -", units.nth(i).inner_text().replace("\n", " "))
        print(f"知识点行数: {page.locator('.kp-row').count()}")
    except Exception as e:
        print("读取失败:", e)

    browser.close()
print("done")
