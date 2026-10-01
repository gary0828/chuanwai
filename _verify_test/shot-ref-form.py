# 截取工作台「底座与设置」页作为表单参照，给用户对齐"好的表单长什么样"
import sys
from playwright.sync_api import sync_playwright

WB = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18080/ai"
OUT = r"C:\Users\rui08\Desktop\教学管理系统\evidence\ref-workbench-form.png"

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 1440, "height": 950}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"{WB}/#/settings", wait_until="networkidle")
    pg.wait_for_timeout(2500)
    print("[info] URL:", pg.url)
    # 统计该页用到的 Element Plus 组件
    for sel, label in [
        (".el-radio-group", "el-radio-group"),
        (".el-input", "el-input"),
        (".el-button", "el-button"),
        (".el-select", "el-select"),
    ]:
        print(f"[info] {label} 数量: {pg.locator(sel).count()}")
    print("[info] JS 错误:", errs or "无")
    pg.screenshot(path=OUT)
    print("[info] 截图:", OUT)
    b.close()
