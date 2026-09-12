# -*- coding: utf-8 -*-
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8080"

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto(f"{BASE}/#/login")
    pg.wait_for_selector("input[placeholder='账号']", timeout=15000)
    pg.fill("input[placeholder='账号']", "admin")
    pg.fill("input[type='password']", "admin123456")
    pg.click("button:has-text('登录')")
    pg.wait_for_timeout(2500)

    pg.goto(f"{BASE}/#/data/adjustments")
    pg.wait_for_timeout(1500)

    result = pg.evaluate("""
    () => {
      const ths = Array.from(document.querySelectorAll('.el-table__header-wrapper th'));
      const th = ths.find(t => t.innerText.includes('状态'));
      const cell = th ? th.querySelector('.cell') : null;
      if (!cell) return null;
      const span = document.createElement('span');
      span.textContent = '状态';
      span.style.visibility = 'hidden';
      span.style.position = 'absolute';
      span.style.font = window.getComputedStyle(cell).font;
      document.body.appendChild(span);
      const width = span.getBoundingClientRect().width;
      document.body.removeChild(span);
      return {
        textWidth: width,
        cellWidth: cell.getBoundingClientRect().width,
        paddingLeft: parseFloat(window.getComputedStyle(cell).paddingLeft),
        paddingRight: parseFloat(window.getComputedStyle(cell).paddingRight),
        font: window.getComputedStyle(cell).font
      };
    }
    """)
    print(result)
    b.close()
