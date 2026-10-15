"""《使用指南》单页 UI 实证（浏览器真实点击，不是只打接口）

覆盖：
  ① 侧栏菜单出现「使用指南」（admin 与 teacher **两个角色都要有** —— 只加一份是本次最易犯的错）
  ② 点菜单进入 `#/guide`，六大章节全部渲染
  ③ 功能章节数与「打开这个页面」按钮数按角色正确收敛（老师看不到 admin-only 页面的入口）
  ④ 页内目录、锚点跳转、页内搜索真的能用（不是摆设）
  ⑤ 彩色提示框渲染出来了
  ⑥ 全程零 console error、零 4xx/5xx 接口

★ 为什么按钮数是硬数字：它是"角色过滤真的生效"的指纹。
  36 = 菜单里全部叶子页面（admin 视角）；15 = 老师视角能打开的页面数。
  内容改了这两个数字就要跟着改 —— 这本身就是提醒"指南与菜单必须同步"。

用法（密码走环境变量，不写进文件）：
  GUIDE_ADMIN_PW=xxx GUIDE_TEACHER_PW=yyy python ui-guide.py [WEB]
  默认 WEB = http://127.0.0.1:18080
"""
import os
import sys
import json
import time
import urllib.request
from playwright.sync_api import sync_playwright

WEB = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18080"
API = WEB
ADMIN_PW = os.environ.get("GUIDE_ADMIN_PW", "")
TEACHER_PW = os.environ.get("GUIDE_TEACHER_PW", "")

EXPECT_ADMIN_BUTTONS = 36
EXPECT_TEACHER_BUTTONS = 15

pass_n = 0
fail_n = 0


def ck(name, ok, actual=""):
    global pass_n, fail_n
    if ok:
        pass_n += 1
        print(f"  ✓ {name}" + (f"  → {actual}" if actual else ""))
    else:
        fail_n += 1
        print(f"  ✗ {name}  → 实际：{actual}")


def login(username, password):
    req = urllib.request.Request(
        f"{API}/api/auth/login",
        data=json.dumps({"username": username, "password": password}).encode(),
        headers={"Content-Type": "application/json"},
    )
    return json.loads(urllib.request.urlopen(req).read())["data"]


def session_payload(d):
    expires_ms = int((time.time() + 7 * 24 * 3600) * 1000)
    cookie = json.dumps(
        {"accessToken": d["accessToken"], "refreshToken": d["refreshToken"], "expires": expires_ms},
        separators=(",", ":"),
    )
    user = json.dumps(
        {
            "refreshToken": d["refreshToken"],
            "expires": expires_ms,
            "avatar": d.get("avatar", ""),
            "username": d["username"],
            "nickname": d.get("nickname", ""),
            "roles": d["roles"],
            "permissions": d.get("permissions", []),
        },
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return cookie, user


def run_role(p, label, username, password, expect_buttons):
    print(f"\n{'=' * 72}\n【{label}】{username}\n{'=' * 72}")
    d = login(username, password)
    cookie, user = session_payload(d)

    browser = p.chromium.launch(args=["--no-proxy-server"])
    ctx = browser.new_context(viewport={"width": 1500, "height": 950})
    page = ctx.new_page()

    console_errors = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    api_bad = []

    def on_resp(resp):
        if "/api/" in resp.url and resp.status >= 400:
            api_bad.append(f"{resp.status} {resp.url.split('/api/')[1].split('?')[0]}")

    page.on("response", on_resp)

    page.goto(WEB, wait_until="domcontentloaded")
    page.evaluate(
        """([tok, ui]) => {
          const maxAge = 7*24*3600;
          document.cookie = 'authorized-token=' + encodeURIComponent(tok) + '; path=/; max-age=' + maxAge;
          document.cookie = 'multiple-tabs=true; path=/; max-age=' + maxAge;
          localStorage.setItem('user-info', ui);
        }""",
        [cookie, user],
    )
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1200)

    # ── ① 侧栏菜单（K-048 ②：读 .el-menu 的 children，别用 .el-menu > li）
    menu_texts = page.evaluate(
        """() => {
            const el = document.querySelector('.el-menu');
            if (!el) return [];
            return [...el.children].map(li => (li.innerText || '').trim().split('\\n')[0]);
        }"""
    )
    has_guide = any("使用指南" in t for t in menu_texts)
    ck(f"① 侧栏菜单出现「使用指南」", has_guide, f"一级项={menu_texts}")

    # ── ② 点击进入
    page.evaluate(
        """() => {
            const el = document.querySelector('.el-menu');
            const target = [...el.children].find(li => (li.innerText || '').includes('使用指南'));
            target.querySelector('.el-menu-item, .el-sub-menu__title, a, div').click();
        }"""
    )
    page.wait_for_timeout(2500)
    url_ok = "#/guide" in page.url
    ck("②-1 点击后地址变成 #/guide（hash 路由，K-059）", url_ok, page.url)

    h2s = page.locator("h2.guide-h2").all_inner_texts()
    want_sections = ["一、这套系统是干什么的", "二、使用前的准备", "三、全部功能与操作",
                     "四、主要业务流", "五、常见问题排查", "六、关键注意事项"]
    missing = [s for s in want_sections if not any(s in h for h in h2s)]
    ck("②-2 六大章节的标题都渲染出来了", not missing, f"缺失={missing or '无'} ｜ 实得 h2 共 {len(h2s)} 个")

    groups = page.locator("h2.guide-h2--group").all_inner_texts()
    ck("②-3 十个菜单分组的章节都在", len(groups) == 10, f"实得 {len(groups)} 个：{groups}")

    # ── ③ 角色收敛：功能卡入口按钮数
    paths = page.locator("code.guide-path").count()
    ck("③-1 功能章节渲染出路径标签", paths == EXPECT_ADMIN_BUTTONS, f"实得 {paths} 个")

    buttons = page.locator("button:has-text('打开这个页面')").count()
    ck(
        f"③-2 「打开这个页面」按钮数 = {expect_buttons}（角色过滤生效）",
        buttons == expect_buttons,
        f"实得 {buttons} 个",
    )

    # admin-only 章节必须仍然可见（用户拍板：一份通用指南，只标注角色）
    admin_only = page.locator("h3:has-text('课时对账')").count()
    ck("③-3 admin-only 章节对老师仍然可见（只标注角色，不隐藏）", admin_only >= 1, f"实得 {admin_only} 个标题")

    tags = page.locator(".guide-tag").all_inner_texts()
    ck(
        "③-4 角色标签渲染正确",
        ("校区负责人" in tags) and ("一线老师" in tags),
        f"标签种类={sorted(set(tags))}",
    )

    # ── ④ 目录 / 锚点 / 搜索
    toc_items = page.locator(".guide-toc__item").count()
    ck("④-1 右侧「本页目录」有可点的条目", toc_items >= 20, f"实得 {toc_items} 条")

    # 点最后一项目录，看页面真的滚走了
    before_y = page.evaluate("() => document.querySelector('.guide-main').getBoundingClientRect().top")
    page.locator(".guide-toc__item").last.click()
    page.wait_for_timeout(1200)
    after_y = page.evaluate("() => document.querySelector('.guide-main').getBoundingClientRect().top")
    ck("④-2 点目录项页面真的滚动了（锚点不是摆设）", abs(after_y - before_y) > 40,
       f"滚动前 top={before_y:.0f} → 滚动后 top={after_y:.0f}")
    ck("④-3 点目录后地址仍是 #/guide（页内跳转没有顶掉路由）", "#/guide" in page.url, page.url)

    # 搜索
    box = page.locator("input[placeholder*='想找什么']")
    ck("④-4 页内搜索框存在", box.count() == 1, f"实得 {box.count()} 个")
    box.fill("退费")
    page.wait_for_timeout(800)
    hit_text = page.locator(".guide-search__hint").inner_text()
    filtered = page.locator("code.guide-path").count()
    ck("④-5 搜索「退费」后结果提示出现", "找到" in hit_text, hit_text.replace("\n", " "))
    ck("④-6 搜索真的筛掉了不相关章节", 0 < filtered < paths, f"筛前 {paths} → 筛后 {filtered}")

    box.fill("")
    page.wait_for_timeout(600)
    restored = page.locator("code.guide-path").count()
    ck("④-7 清空搜索后内容恢复", restored == paths, f"实得 {restored} 个")

    # ── ⑤ 提示框
    callouts = {
        "tip": page.locator(".guide-callout--tip").count(),
        "warn": page.locator(".guide-callout--warn").count(),
        "danger": page.locator(".guide-callout--danger").count(),
    }
    ck("⑤ 三种提示框都渲染（经验 / 注意 / 危险）", all(v > 0 for v in callouts.values()), str(callouts))

    # ── ⑥ 干净度
    noise = [e for e in console_errors if "favicon" not in e.lower()]
    ck("⑥-1 全程零 console error", not noise, f"实得 {noise[:3]}")
    ck("⑥-2 全程零 4xx/5xx 接口", not api_bad, f"实得 {sorted(set(api_bad))[:5]}")

    browser.close()


def main():
    if not ADMIN_PW or not TEACHER_PW:
        print("请用环境变量传入密码：GUIDE_ADMIN_PW / GUIDE_TEACHER_PW")
        sys.exit(2)
    with sync_playwright() as p:
        run_role(p, "管理员", "admin", ADMIN_PW, EXPECT_ADMIN_BUTTONS)
        run_role(p, "一线老师", "teacher", TEACHER_PW, EXPECT_TEACHER_BUTTONS)

    print(f"\n{'=' * 72}")
    print(f"通过 {pass_n} 项 ｜ 失败 {fail_n} 项")
    print(f"{'=' * 72}")
    sys.exit(1 if fail_n else 0)


if __name__ == "__main__":
    main()
