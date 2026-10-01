# 工作台待办页改版后验收：确认用上 el-* 组件、无原生控件、无 JS 错误
import sys
from playwright.sync_api import sync_playwright

WB = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18080/ai"
EV = r"C:\Users\rui08\Desktop\教学管理系统\evidence"

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 1440, "height": 950}).new_page()
    errs, failed = [], []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("requestfailed", lambda r: failed.append(f"{r.url} :: {r.failure}"))

    pg.goto(f"{WB}/#/todos", wait_until="networkidle")
    pg.wait_for_timeout(2500)

    body = pg.inner_text("body")
    print("[info] URL:", pg.url)
    print("[info] 页面含「我的待办」:", "我的待办" in body)

    # 资源是否都加载成功（白屏排查的关键指标）
    print("[info] 加载失败的请求:", failed or "无")

    # 打开新建表单
    btn = pg.locator("button", has_text="新建待办")
    if btn.count():
        btn.first.click()
        pg.wait_for_timeout(1200)

    # 断言：用上了 Element Plus 组件
    for sel, label in [
        (".el-input", "el-input"),
        (".el-radio-group", "el-radio-group"),
        (".el-radio-button", "el-radio-button"),
        (".el-button", "el-button"),
        (".el-date-editor", "el-date-picker"),
    ]:
        n = pg.locator(sel).count()
        print(f"[{'OK' if n else 'FAIL'}] {label} 数量: {n}")

    # 断言：没有裸露的原生表单控件
    native = pg.evaluate(
        """() => {
            const bad = [];
            document.querySelectorAll('input, select, textarea').forEach(el => {
                // Element Plus 内部也渲染 input，需排除其内部类
                const inEl = el.closest('.el-input, .el-textarea, .el-select, .el-date-editor, .el-radio, .el-radio-button, .el-checkbox, .el-checkbox-button, .el-switch');
                if (!inEl) bad.push(el.tagName + (el.type ? '[' + el.type + ']' : '') + (el.className ? ' .' + el.className : ''));
            });
            return bad;
        }"""
    )
    print(f"[{'OK' if not native else 'FAIL'}] 无裸露原生控件: {native or '无'}")

    print("[info] JS 错误:", errs or "无")
    pg.screenshot(path=rf"{EV}\L2-todos-workbench-fixed.png")
    print("[info] 截图:", rf"{EV}\L2-todos-workbench-fixed.png")
    b.close()
