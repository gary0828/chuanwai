"""补充截图：滚动查看成长路径页与采集页的下半部分"""
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1]
TOKEN = sys.argv[2]
EVID = "evidence/ai-workbench-growth"


def url_for(h):
    sep = "&" if "?" in BASE else "?"
    return f"{BASE}/{sep}token={TOKEN}#{h}"


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 1440, "height": 1000}).new_page()

    # 单学员页：滚到知识点成长 + 里程碑
    pg.goto(url_for("/growth"), wait_until="networkidle")
    pg.wait_for_timeout(1800)
    pg.locator(".el-radio-button", has_text="单个学员").first.click()
    pg.wait_for_timeout(2200)
    pg.mouse.wheel(0, 1100)
    pg.wait_for_timeout(700)
    pg.screenshot(path=f"{EVID}/03b-student-kp-milestone.png")
    pg.mouse.wheel(0, 1300)
    pg.wait_for_timeout(700)
    pg.screenshot(path=f"{EVID}/03c-student-timeline.png")

    # 整班页：滚到知识点全景
    pg.goto(url_for("/growth"), wait_until="networkidle")
    pg.wait_for_timeout(1800)
    pg.mouse.wheel(0, 1500)
    pg.wait_for_timeout(700)
    pg.screenshot(path=f"{EVID}/02b-class-kp-table.png")

    b.close()
print("done")
