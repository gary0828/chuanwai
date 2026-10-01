# -*- coding: utf-8 -*-
"""登录页背景改版验证

断言全部取「计算后的实际值」，不靠肉眼：
  1. 卡片水平居中（对称性）
  2. 品牌区与卡片同轴（说明整体是上下同轴而非左右分栏）
  3. 背景格栅真实生效：4 层 linear-gradient + 径向遮罩
  4. 卡片规格与全站 .page-card 一致（1px 边框 / 10px 圆角）

用法：python _verify_test/ui-login-shots.py [base_url]
"""
import sys

sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8848"

VIEWPORTS = [(1680, 1050), (1440, 900), (1280, 800), (1024, 768), (768, 1024)]

results = []


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")


with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h in VIEWPORTS:
        ctx = b.new_context(viewport={"width": w, "height": h})
        pg = ctx.new_page()
        errs = []
        pg.on(
            "console",
            lambda m: errs.append(m.text) if m.type == "error" else None,
        )
        pg.goto(f"{BASE}/#/login", wait_until="networkidle")
        pg.wait_for_timeout(900)
        pg.screenshot(path=f"evidence/login_bg_{w}x{h}.png")

        # 1. 卡片水平居中
        box = pg.locator(".login-form").bounding_box()
        center = box["x"] + box["width"] / 2
        record(
            f"卡片水平居中 @{w}px",
            abs(center - w / 2) <= 2,
            f"中心 {center:.1f} / 视口中心 {w / 2:.0f}，偏差 {abs(center - w / 2):.1f}px",
        )

        # 2. 品牌区与卡片同轴
        brand = pg.locator(".login-brand").bounding_box()
        bcenter = brand["x"] + brand["width"] / 2
        record(
            f"品牌区与卡片同轴 @{w}px",
            abs(bcenter - w / 2) <= 2,
            f"偏差 {abs(bcenter - w / 2):.1f}px",
        )

        # 3. 格栅背景
        grid = pg.evaluate(
            """() => {
                const g = document.querySelector('.login-page__grid');
                if (!g) return null;
                const cs = getComputedStyle(g);
                return {
                    image: cs.backgroundImage,
                    layers: (cs.backgroundImage.match(/linear-gradient/g) || []).length,
                    size: cs.backgroundSize,
                    mask: cs.maskImage !== 'none' || cs.webkitMaskImage !== 'none'
                };
            }"""
        )
        ok = (
            grid is not None
            and grid["layers"] == 4
            and "32px" in grid["size"]
            and "128px" in grid["size"]
            and grid["mask"]
        )
        record(
            f"格栅背景生效 @{w}px",
            ok,
            f"渐变层={grid['layers'] if grid else 'N/A'} 尺寸={grid['size'] if grid else 'N/A'} 遮罩={grid['mask'] if grid else 'N/A'}",
        )

        # 4. 卡片规格与全站一致
        card = pg.evaluate(
            """() => {
                const c = document.querySelector('.login-form');
                const cs = getComputedStyle(c);
                return {
                    border: cs.borderTopWidth,
                    radius: cs.borderTopLeftRadius,
                    bg: cs.backgroundColor
                };
            }"""
        )
        record(
            f"卡片规格与 page-card 一致 @{w}px",
            card["border"] == "1px" and card["radius"] == "10px",
            f"边框={card['border']} 圆角={card['radius']} 底色={card['bg']}",
        )

        if errs:
            record(f"控制台无错误 @{w}px", False, str(errs[:2]))

        ctx.close()
    b.close()

print("\n========================")
okn = sum(1 for _, o, _ in results if o)
print(f"通过 {okn}/{len(results)}")
sys.exit(0 if okn == len(results) else 1)
