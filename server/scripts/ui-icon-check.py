# -*- coding: utf-8 -*-
"""校验修复后的图标在「生产构建」中确实渲染为 <svg>（针对统一入口，默认 :18080）"""
import sys

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:18080"

# (路由, 用于定位的可见文字)
CASES = [
    ("/data/makeups", "登记补课"),
    ("/data/schedules", "冲突检测"),
    ("/data/adjustments", "调课审批"),
    ("/teaching/exams", "打印"),
    ("/teaching/reports", "打印"),
    ("/attendance/statistics", "打印"),
    ("/finance/consumption", "打印"),
]

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1680, "height": 1000})
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)

    pg.goto(f"{BASE}/#/login", wait_until="networkidle")
    pg.wait_for_timeout(900)
    pg.fill('input[placeholder="账号"]', "admin")
    pg.fill('input[placeholder="密码"]', "admin123456")
    pg.click("button:has-text('登录')")
    pg.wait_for_timeout(3000)

    total = ok = 0
    for route, label in CASES:
        pg.goto(f"{BASE}/#{route}", wait_until="networkidle")
        pg.wait_for_timeout(2000)
        info = pg.evaluate(
            """(label) => {
              const nodes=[...document.querySelectorAll('.el-icon')];
              const hit=nodes.find(n=>n.children.length && n.children[0].tagName!=='svg');
              const svgCount=nodes.filter(n=>n.querySelector('svg')).length;
              return {elIcon:nodes.length, withSvg:svgCount, broken:hit?hit.outerHTML.slice(0,120):null};
            }""",
            label,
        )
        total += 1
        if info["broken"] is None and info["withSvg"] > 0:
            ok += 1
            print(f"[PASS] {route:26s} el-icon={info['elIcon']:2d} 其中含svg={info['withSvg']:2d}")
        else:
            print(f"[FAIL] {route:26s} 有图标未渲染: {info['broken']}")

    print(f"\n==== 图标渲染检查（生产构建）: {ok}/{total} ====")
    print(f"控制台错误数: {len(errs)}")
    b.close()
sys.exit(0 if ok == total else 1)
