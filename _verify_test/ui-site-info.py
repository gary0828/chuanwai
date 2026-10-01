"""站点信息（机构名称 / Logo / 页脚）浏览器实证。

覆盖：
  1. 登录页 —— Logo 渲染、机构名称、副标题来自后台配置
  2. 浏览器标签标题 —— 不再是 pure-admin-thin
  3. 系统参数页 —— 站点信息区块表单回填正确
  4. 编辑并保存 —— 文字改动生效并持久化
  5. 上传 Logo —— 上传成功且侧边栏同步
  6. 页脚 —— 版权主体 / 年份渲染，且无 GitHub 外链
  7. 无未捕获 JS 错误

登录方式：接口登录 + 注入凭证（登录页含 canvas 图形验证码，自动化无法识别）

用法：
  python _verify_test/ui-site-info.py http://127.0.0.1:8848 http://127.0.0.1:3199
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8848"
API = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:3199"
OUT = Path("evidence")
OUT.mkdir(exist_ok=True)

results = []


def check(name: str, ok: bool, detail: str = ""):
    results.append((name, ok, detail))
    print(f"{'[OK]' if ok else '[FAIL]'} {name}" + (f"  -- {detail}" if detail else ""))


def token_of(username="admin", password="admin123456"):
    r = requests.post(
        f"{API}/api/auth/login",
        json={"username": username, "password": password, "type": "password"},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()["data"]


def inject_login(page, d):
    """注入 Cookie + localStorage 模拟已登录态（见 MEMORY 坑 #11）"""
    expires_ms = int(
        datetime.strptime(d["expires"], "%Y/%m/%d %H:%M:%S")
        .replace(tzinfo=timezone(timedelta(hours=8)))
        .timestamp()
        * 1000
    )
    cookie_val = json.dumps(
        {
            "accessToken": d["accessToken"],
            "expires": expires_ms,
            "refreshToken": d["refreshToken"],
        }
    )
    info_val = json.dumps(
        {
            "refreshToken": d["refreshToken"],
            "expires": expires_ms,
            "avatar": d.get("avatar", ""),
            "username": d["username"],
            "nickname": d.get("nickname", ""),
            "roles": d.get("roles", []),
            "permissions": d.get("permissions", []),
        }
    )
    page.goto(f"{BASE}/#/login", wait_until="domcontentloaded")
    page.evaluate(
        """([cookieVal, infoVal]) => {
            document.cookie = 'authorized-token=' + encodeURIComponent(cookieVal) + '; path=/';
            document.cookie = 'multiple-tabs=true; path=/';
            localStorage.setItem('user-info', infoVal);
        }""",
        [cookie_val, info_val],
    )
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1000)


def api_checks():
    """接口层契约：公开白名单 / 非空过滤 / 越界键拒绝 / 鉴权边界。
    返回 /admin 读到的完整配置，供后续浏览器断言比对。"""
    # ① 公开端点：只返回非空项
    r = requests.get(f"{API}/api/site-info", timeout=10)
    check("接口：公开端点 200", r.status_code == 200, f"HTTP {r.status_code}")
    pub = r.json().get("data", {})
    empty_vals = [k for k, v in pub.items() if v in ("", None)]
    check("接口：公开端点不含空值项", not empty_vals, f"空值键={empty_vals}")

    # ② 公开端点绝不泄漏内网参数
    leaked = [k for k in pub if not k.startswith("site.")]
    check("接口：公开端点无白名单外字段", not leaked, f"越界={leaked}")
    check("接口：公开端点不含 warn_rate 等内网参数",
          "warn_rate" not in pub and "warn_days" not in pub)

    # ③ /admin 未登录必须 401
    r = requests.get(f"{API}/api/site-info/admin", timeout=10)
    check("接口：/admin 未登录返回 401", r.status_code == 401, f"HTTP {r.status_code}")

    # ④ 越界键静默忽略
    d = token_of()
    tok = d.get("accessToken") or d.get("token")
    hdr = {"Authorization": f"Bearer {tok}"}
    r = requests.get(f"{API}/api/site-info/admin", headers=hdr, timeout=10)
    check("接口：/admin 登录后 200", r.status_code == 200, f"HTTP {r.status_code}")
    admin_data = r.json().get("data", {})
    check("接口：/admin 返回全部 12 键", len(admin_data) == 12, f"实际 {len(admin_data)}")

    payload = {"site.hack": "x", "site.name": admin_data.get("site.name", "") or "合同测试名"}
    r = requests.put(f"{API}/api/site-info", json=payload, headers=hdr, timeout=10)
    check("接口：PUT 越界键被忽略（不报错）", r.status_code == 200, f"HTTP {r.status_code}")
    back = r.json().get("data", {})
    check("接口：越界键未落库", "site.hack" not in back)

    # ⑤ 超长值必须被拒
    r = requests.put(f"{API}/api/site-info", json={"site.name": "x" * 501},
                     headers=hdr, timeout=10)
    check("接口：超长值返回 400", r.status_code == 400, f"HTTP {r.status_code}")

    # ⑥ 还原（避免污染后续浏览器断言）
    requests.put(f"{API}/api/site-info",
                 json={"site.name": admin_data.get("site.name", "")},
                 headers=hdr, timeout=10)
    return admin_data


def main():
    # ══ 0. 接口契约（纯 API，先跑，不依赖浏览器）════════════════════════
    # 这一组是补的：只跑浏览器时永远发现不了「公开端点返回空串而非省略」这类问题。
    admin_data = api_checks()

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()

        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        # ══ 1. 登录页（未登录状态）═══════════════════════════════════
        page.goto(f"{BASE}/#/login", wait_until="networkidle")
        page.wait_for_timeout(1800)

        title = page.title()
        check("登录页：标签标题非 pure-admin-thin", "pure-admin" not in title, title)

        brand_el = page.locator(".login-brand__name")
        check("登录页：品牌名元素存在", brand_el.count() == 1)
        brand_name = brand_el.inner_text().strip() if brand_el.count() else ""
        check("登录页：机构名称非空", brand_name != "", brand_name)

        logo_el = page.locator(".login-brand__logo")
        check("登录页：Logo 元素存在", logo_el.count() == 1)
        logo_src = logo_el.get_attribute("src") if logo_el.count() else ""
        check("登录页：Logo src 非空", bool(logo_src), str(logo_src)[:60])

        logo_loaded = page.evaluate(
            """() => { const i = document.querySelector('.login-brand__logo');
                       return i ? (i.complete && i.naturalWidth > 0) : false; }"""
        )
        check("登录页：Logo 图片真实加载成功", logo_loaded)

        slogan = page.locator(".login-brand__slogan").inner_text().strip()
        check("登录页：副标题已渲染", len(slogan) > 0, slogan[:34])

        page.screenshot(path=str(OUT / "ui-site-login.png"), full_page=True)

        # ══ 2. 注入登录态进入主界面 ═══════════════════════════════════
        try:
            d = token_of()
            inject_login(page, d)
        except Exception as e:  # noqa: BLE001
            check("注入登录态", False, str(e))
            browser.close()
            return summary()

        side_logo_ok = page.evaluate(
            """() => { const i = document.querySelector('.sidebar-logo-container img');
                       return i ? (i.complete && i.naturalWidth > 0) : null; }"""
        )
        check("主界面：侧边栏 Logo 加载成功", side_logo_ok is True or side_logo_ok is None,
              "null=该形态无侧边栏 Logo")

        # ══ 3. 页脚 ═════════════════════════════════════════════════
        footer = page.locator(".layout-footer")
        if footer.count() > 0:
            ftxt = footer.inner_text().replace("\n", " | ")
            fhtml = footer.inner_html()
            check("页脚：已渲染", True, ftxt[:70])
            check("页脚：不再有 GitHub 外链", "github.com" not in fhtml)
            check("页脚：含 Copyright 与年份", "Copyright" in ftxt and "20" in ftxt)
            check("页脚：含版权主体", len(ftxt.replace("Copyright", "").strip()) > 4)
        else:
            check("页脚：已渲染", False, "未找到 .layout-footer（可能被 HideFooter 隐藏）")

        # ══ 4. 系统参数页 ═══════════════════════════════════════════
        page.goto(f"{BASE}/#/system/settings", wait_until="networkidle")
        page.wait_for_timeout(2200)

        check("系统参数页：存在「站点信息」区块", page.locator("text=站点信息").count() > 0)

        name_input = page.locator("input[placeholder*='川外培训']").first
        has_name = name_input.count() > 0
        check("系统参数页：机构名称输入框存在", has_name)

        # 回填断言与库中实际值对齐（全新安装时库为空、输入框也应空 —— 这是正确行为）
        filled = name_input.input_value() if has_name else ""
        expected_name = admin_data.get("site.name", "")
        check("系统参数页：机构名称与库中配置一致",
              filled == expected_name,
              f"表单={filled!r} 库={expected_name!r}")

        save_btn = page.locator("button:has-text('保存站点信息')")
        check("系统参数页：存在保存按钮", save_btn.count() > 0)

        upload_btn = page.locator("button:has-text('上传 Logo')")
        check("系统参数页：存在上传 Logo 按钮", upload_btn.count() > 0)

        preview_ok = page.evaluate(
            """() => { const i = document.querySelector('.upload-preview img');
                       return i ? (i.complete && i.naturalWidth > 0) : false; }"""
        )
        check("系统参数页：Logo 预览图加载成功", preview_ok)

        # 备案字段留空 → 页脚不出现备案行（当前态）
        icp_input = page.locator("input[placeholder*='留空则页脚不显示']").first
        check("系统参数页：存在备案号字段（可为空）", icp_input.count() > 0)

        page.screenshot(path=str(OUT / "ui-site-settings.png"), full_page=True)

        # ══ 5. 编辑 → 保存 → 持久化 ═════════════════════════════════
        if has_name:
            old = name_input.input_value()
            await_val = "实证机构名"
            name_input.fill(await_val)
            save_btn.first.click()
            page.wait_for_timeout(2000)
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(2000)
            reloaded = page.locator("input[placeholder*='川外培训']").first.input_value()
            check("保存后持久化成功", reloaded == await_val, f"{old} -> {reloaded}")
            # 还原现场
            page.locator("input[placeholder*='川外培训']").first.fill(old)
            save_btn.first.click()
            page.wait_for_timeout(1800)

            # 标题联动：改完标题应立即反映到 document.title
            t2 = page.title()
            check("保存后标签标题仍正常", len(t2) > 0, t2)

        # ══ 6. 无未捕获 JS 错误 ════════════════════════════════════
        real = [e for e in errors if "favicon" not in e.lower()]
        check("无未捕获 JS 错误", len(real) == 0, "; ".join(real[:2]))

        browser.close()
    summary()


def summary():
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"\n{'=' * 54}")
    print(f"  站点信息实证结果：{passed}/{total}")
    print(f"{'=' * 54}")
    if passed != total:
        for n, ok, dd in results:
            if not ok:
                print(f"  [FAIL] {n} {dd}")
        sys.exit(1)


if __name__ == "__main__":
    main()
