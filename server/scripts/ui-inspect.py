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

    info = pg.evaluate("""
    () => {
      const table = document.querySelector('.el-table');
      const bodyWrapper = document.querySelector('.el-table__body-wrapper');
      const headerCells = Array.from(document.querySelectorAll('.el-table__header-wrapper th'));
      const statusTh = headerCells.find(th => th.innerText.includes('状态'));
      const statusCell = statusTh ? statusTh.querySelector('.cell') : null;
      return {
        tableWidth: table ? table.getBoundingClientRect().width : null,
        bodyWrapperWidth: bodyWrapper ? bodyWrapper.getBoundingClientRect().width : null,
        bodyWrapperScrollWidth: bodyWrapper ? bodyWrapper.scrollWidth : null,
        status: statusCell ? {
          rect: statusCell.getBoundingClientRect(),
          computed: window.getComputedStyle(statusCell),
          html: statusCell.innerHTML,
          text: statusCell.innerText
        } : null,
        headers: headerCells.map(th => {
          const cell = th.querySelector('.cell');
          return {
            label: th.innerText,
            width: th.getBoundingClientRect().width,
            cellWidth: cell ? cell.getBoundingClientRect().width : null
          };
        })
      };
    }
    """)
    import json
    print(json.dumps(info, ensure_ascii=False, indent=2))
    b.close()
