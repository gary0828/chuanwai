"""站点 Logo 上传端到端实证（真实点击上传按钮）。

覆盖：
  1. 上传 PNG → 预览更新 → 侧边栏同步 → 刷新后仍生效
  2. 上传非图片文件 → 被拦截（前端类型校验）
  3. 上传后 DB 中 site.logo 已更新
  4. 「恢复默认」按钮清空配置
  5. 结束时还原为初始状态

用法：
  python _verify_test/ui-site-upload.py http://127.0.0.1:8848 http://127.0.0.1:3199
"""
import json
import struct
import sys
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8848"
API = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:3199"
OUT = Path("evidence")
TMP = Path("_verify_test/_tmp")
TMP.mkdir(parents=True, exist_ok=True)

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'[OK]' if ok else '[FAIL]'} {name}" + (f"  -- {detail}" if detail else ""))


def make_png(path: Path, w=200, h=56, rgb=(31, 92, 153)):
    """生成一张纯色 PNG，不依赖 Pillow。"""
    raw = b""
    for _ in range(h):
        raw += b"\x00" + bytes(rgb) * w

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)
    return path


def token_of(username="admin", password="admin123456"):
    r = requests.post(
        f"{API}/api/auth/login",
        json={"username": username, "password": password, "type": "password"},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()["data"]


def inject_login(page, d):
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
        """([c, i]) => {
            document.cookie = 'authorized-token=' + encodeURIComponent(c) + '; path=/';
            document.cookie = 'multiple-tabs=true; path=/';
            localStorage.setItem('user-info', i);
        }""",
        [cookie_val, info_val],
    )
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1800)


def get_site_logo(token):
    r = requests.get(
        f"{API}/api/site-info/admin",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    return r.json()["data"]["site.logo"]


def main():
    png = make_png(TMP / "verify-logo.png")
    txt = TMP / "not-image.txt"
    txt.write_text("this is not an image", encoding="utf-8")

    token = token_of()["accessToken"]
    original_logo = get_site_logo(token)
    print(f"[info] 初始 site.logo = {original_logo!r}")

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_context(viewport={"width": 1440, "height": 900}).new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            inject_login(page, token_of())
            page.goto(f"{BASE}/#/system/settings", wait_until="networkidle")
            page.wait_for_timeout(2200)

            # 先确认真的进了内页（否则后面所有布局级断言都会「找不到元素」）
            check("已进入设置页（未被弹回登录）",
                  "/login" not in page.url,
                  page.url)

            # ══ 1. 上传合法 PNG ════════════════════════════════════
            file_input = page.locator("input[type='file']").first
            check("页面上存在 file input", file_input.count() > 0)

            file_input.set_input_files(str(png.resolve()))
            page.wait_for_timeout(3000)

            new_logo = get_site_logo(token)
            check("上传后 DB 中 site.logo 已更新", new_logo != original_logo and new_logo != "",
                  f"{original_logo} -> {new_logo}")
            check("上传后的路径为 /assets/site/ 前缀", new_logo.startswith("/assets/site/"), new_logo)

            # 后端能真实访问该文件
            r = requests.get(f"{API}{new_logo}", timeout=10)
            check("上传的文件可被后端访问", r.status_code == 200 and len(r.content) > 0,
                  f"HTTP {r.status_code}, {len(r.content)} bytes")

            # 预览图更新（不再是旧图）
            preview_src = page.locator(".upload-preview img").first.get_attribute("src")
            check("预览图已切到新文件", preview_src and new_logo in preview_src, str(preview_src)[:60])

            # 侧边栏 Logo 同步
            # ★ 注意（2026-09-21 修正）：原断言 `side_ok is True or side_ok is None` 是**空断言** ——
            #   None 表示「根本没找到元素」，却被当成通过，等于永远测不出侧边栏没同步。
            #   现在改为三态：元素不存在 → 明确提示跳过原因；存在但图不对 → 判失败。
            page.wait_for_timeout(800)
            side_state = page.evaluate(
                """() => { const i = document.querySelector('.sidebar-logo-container img');
                            if (!i) return { found: false };
                            return { found: true, src: i.src, loaded: i.complete && i.naturalWidth > 0 }; }"""
            )
            if not side_state.get("found"):
                check("侧边栏 Logo 同步为新图", False,
                      "未找到 .sidebar-logo-container img —— "
                      "检查是否停在 /#/login（登录态注入失败）或该形态为顶栏布局")
            else:
                check("侧边栏 Logo 同步为新图",
                      bool(side_state.get("loaded")) and new_logo in (side_state.get("src") or ""),
                      f"src={str(side_state.get('src'))[:70]} loaded={side_state.get('loaded')}")

            # 刷新后仍生效（持久化）
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(2000)
            after_reload = page.locator(".upload-preview img").first.get_attribute("src")
            check("刷新后仍为新图（持久化）", after_reload and new_logo in after_reload,
                  str(after_reload)[:60])

            page.screenshot(path=str(OUT / "ui-site-logo-uploaded.png"), full_page=True)

            # ══ 2. 上传非图片 → 前端拦截 ══════════════════════════
            before_bad = get_site_logo(token)
            page.locator("input[type='file']").first.set_input_files(str(txt.resolve()))
            page.wait_for_timeout(2000)
            after_bad = get_site_logo(token)
            check("上传非图片被拦截（配置未变）", before_bad == after_bad,
                  f"{before_bad} == {after_bad}")

            # ══ 3. 恢复默认按钮 ═══════════════════════════════════
            reset_btn = page.locator("button:has-text('恢复默认')")
            if reset_btn.count() > 0:
                reset_btn.first.click()
                page.wait_for_timeout(1500)
                save = page.locator("button:has-text('保存站点信息')")
                save.first.click()
                page.wait_for_timeout(2000)
                cleared = get_site_logo(token)
                check("「恢复默认」+ 保存后 site.logo 被清空", cleared == "", repr(cleared))

            # ══ 4. 无未捕获 JS 错误 ═══════════════════════════════
            real = [e for e in errors if "favicon" not in e.lower()]
            check("无未捕获 JS 错误", len(real) == 0, "; ".join(real[:2]))

            browser.close()
    finally:
        # 还原初始状态
        requests.put(
            f"{API}/api/site-info",
            headers={"Authorization": f"Bearer {token}"},
            json={"site.logo": original_logo},
            timeout=10,
        )
        print(f"[info] 已还原 site.logo = {original_logo!r}")
        for f in TMP.glob("*"):
            f.unlink()

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"\n{'=' * 54}")
    print(f"  Logo 上传实证结果：{passed}/{total}")
    print(f"{'=' * 54}")
    if passed != total:
        for n, ok, dd in results:
            if not ok:
                print(f"  [FAIL] {n} {dd}")
        sys.exit(1)


if __name__ == "__main__":
    main()
