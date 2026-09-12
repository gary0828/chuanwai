# -*- coding: utf-8 -*-
"""探测菜单分组标题 DOM（JS 枚举）"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page()
    pg.goto("http://localhost:8080/#/login")
    pg.wait_for_load_state("networkidle")
    pg.locator("input[placeholder='账号']").fill("admin")
    pg.locator("input[placeholder='密码']").fill("admin123456")
    pg.locator("button:has-text('登录')").click()
    pg.wait_for_timeout(1500)

    info = pg.evaluate("""() => {
      const out = [];
      document.querySelectorAll('a, li, .el-sub-menu__title, div').forEach(el => {
        const t = (el.innerText||'').trim();
        if (t && t.length <= 8 && /管理|首页|统计|记录|档案|报表|学期|课程表/.test(t)) {
          out.push({tag: el.tagName, cls: (el.className||'').toString().slice(0,45), text: t, href: el.getAttribute('href')||''});
        }
      });
      return out.slice(0, 50);
    }""")
    for i in info:
        print(f"  tag={i['tag']:5s} cls={i['cls']!r:50s} text={i['text']!r:12s} href={i['href']}")
    b.close()
