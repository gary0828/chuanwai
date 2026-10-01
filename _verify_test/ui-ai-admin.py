#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""AI 配置中心端到端验证：地址进入 → 读取配置 → 改一个字段并保存 → 确认立即生效

用法：python _verify_test/ui-ai-admin.py [WEB] [API]
     默认 WEB=http://127.0.0.1:18080  API=http://127.0.0.1:3000
截图：evidence/ai-admin-*.png

注意：登录态必须用 add_init_script 注入。用「goto → evaluate → reload」的老写法
      在 hash 路由下会先落到 /#/login，SPA 启动时把 localStorage 覆盖掉，
      表现为「注入成功但 3 秒后被踢回登录页」。
"""
import json
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

WEB = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18080").rstrip("/")
API = (sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:3000").rstrip("/")
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "evidence"
OUT.mkdir(exist_ok=True)

results = []


def check(name, cond, extra=""):
    results.append((name, bool(cond)))
    print(("  PASS  " if cond else "  FAIL  ") + name + ("" if cond else f"  -> {extra}"))


print("\n=== AI 配置中心端到端验证 ===\n")

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))
    pg.on(
        "console",
        lambda m: errors.append(f"[console] {m.text}") if m.type == "error" else None,
    )

    # 1) 接口登录并注入登录态
    r = ctx.request.post(
        f"{API}/api/auth/login",
        data={"type": "password", "username": "admin", "password": "admin123456"},
    )
    d = r.json()["data"]
    expires_ms = int(time.time() * 1000) + 7 * 24 * 3600 * 1000
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
    # 在 SPA 启动前就把登录态写好，避免被路由守卫踢回登录页
    # 注意 add_init_script 不接受参数，值需内联进脚本字符串
    ctx.add_init_script(
        f"""document.cookie = 'authorized-token=' + encodeURIComponent({json.dumps(cookie_val)}) + '; path=/';
            document.cookie = 'multiple-tabs=true; path=/';
            localStorage.setItem('user-info', {json.dumps(info_val)});"""
    )

    # 0) 前置清理：把历史测试残留的 DB 配置清空，保证基线是「全部跟随环境变量」。
    #    否则上一次失败运行留下的行会让「source」断言失真。
    cleanup = ctx.request.put(
        f"{API}/api/ai/admin/config",
        data={k: "" for k in (
            "llmApiKey", "llmBaseUrl", "llmModel", "llmMaxTokens", "llmReasoningEffort",
            "llmTimeoutMs", "aiWorkbenchUrl", "difyEndpoint", "difyApiKey", "difyWorkflows",
        )},
        headers={"Authorization": f"Bearer {d['accessToken']}"},
    )
    check("前置清理成功", cleanup.ok, f"HTTP {cleanup.status}")

    # 2) 靠地址进入（不经过菜单）
    pg.goto(f"{WEB}/#/ai-admin", wait_until="domcontentloaded")
    pg.wait_for_timeout(2500)
    body = pg.inner_text("body")
    check("凭地址可进入配置中心", "AI 配置中心" in body, body[:120])
    check("展示账户余额卡片", "账户可用余额" in body, body[:120])
    check("展示本月用量卡片", "本月用量" in body, body[:120])
    check("展示大模型配置分组", "大模型" in body, body[:120])
    check("页面说明未出现在菜单提示", "/ai-admin" in body, body[:120])

    # 3) 敏感字段必须是掩码，不能出现真 Key
    # 注意：掩码在 input 的 value 里，不出现在 inner_text，必须读 input_value()
    check("页面未出现明文 Key", "sk-" not in body.replace("sk-****", ""), "疑似泄露 Key")
    # 类名是 .group__form（双下划线），不是 .group-form
    pw_inputs = pg.locator(".group__form input[type=password]")
    masked_values = [pw_inputs.nth(i).input_value() for i in range(pw_inputs.count())]
    check(
        "敏感字段回显为掩码",
        any("****" in v or v.startswith("__masked__") for v in masked_values),
        f"实际值：{[v[:12] for v in masked_values]}",
    )
    check(
        "Key 输入框为 password 类型",
        pg.locator(".group__form input[placeholder='未修改则保持原样']").count() >= 1,
        "未找到敏感字段输入框",
    )

    # 4) 修改一个非敏感字段并保存
    original_model = ""
    model_input = pg.locator(".el-form-item", has_text="模型名").locator("input").first
    original_model = model_input.input_value()
    try:
        model_input.fill("deepseek-flash-verify")
        pg.locator("button:has-text('保存')").first.click()
        pg.wait_for_timeout(1500)
        check("保存后提示成功", "已保存" in pg.inner_text("body"), pg.inner_text("body")[:120])
    except Exception as exc:  # noqa: BLE001
        check("保存后提示成功", False, str(exc)[:140])

    pg.screenshot(path=str(OUT / "ai-admin-01.png"), full_page=True)

    # 4b) 还原：把「模型名」从数据库里清除，让它重新跟随环境变量。
    #     不能改回原值——改回原值也会落库（因为与当前 DB 值不同），照样留痕。
    #     清空串 = 删除该键，是唯一真正无痕的还原方式。
    try:
        rr = ctx.request.put(
            f"{API}/api/ai/admin/config",
            data={"llmModel": ""},
            headers={"Authorization": f"Bearer {d['accessToken']}"},
        )
        after_restore = rr.json()["data"]["fields"]["llmModel"]
        check(
            "测试改动已还原（回退环境变量）",
            after_restore["source"] == "env" and after_restore["value"] == original_model,
            f"source={after_restore['source']} value={after_restore['value']}",
        )
    except Exception as exc:  # noqa: BLE001
        check("测试改动已还原（回退环境变量）", False, str(exc)[:140])

    # 4c) 关键回归：一次「无改动保存」不应把任何字段钉进数据库
    try:
        before = ctx.request.get(
            f"{API}/api/ai/admin/config",
            headers={"Authorization": f"Bearer {d['accessToken']}"},
        ).json()["data"]["fields"]
        payload = {k: v["value"] for k, v in before.items()}
        changed = ctx.request.put(
            f"{API}/api/ai/admin/config",
            data=payload,
            headers={"Authorization": f"Bearer {d['accessToken']}"},
        ).json()["data"]["changed"]
        after = ctx.request.get(
            f"{API}/api/ai/admin/config",
            headers={"Authorization": f"Bearer {d['accessToken']}"},
        ).json()["data"]["fields"]
        env_keys = [k for k, v in before.items() if v["source"] == "env"]
        pinned = [k for k in env_keys if after[k]["source"] == "db"]
        check(
            "原样保存不污染环境变量来源",
            not pinned,
            f"被钉进数据库：{pinned}（本次 changed={changed}）",
        )
    except Exception as exc:  # noqa: BLE001
        check("原样保存不污染环境变量来源", False, str(exc)[:140])

    # 5) 菜单里不应出现该入口
    # 注意：该页面在 1400px 下侧边栏会被折叠，aside 可能不存在；
    #      更可靠的判据是「菜单项」（.el-menu-item / .el-sub-menu__title）里不含该文案。
    pg.goto(f"{WEB}/#/welcome", wait_until="domcontentloaded")
    pg.wait_for_timeout(1500)
    menu_text = pg.evaluate(
        """() => [...document.querySelectorAll('.el-menu-item, .el-sub-menu__title')]
                   .map(el => el.innerText).join(' | ')"""
    )
    check("侧边菜单不含配置中心入口", "AI 配置中心" not in menu_text, menu_text[:160])

    # 6) 教师账号必须被拒绝（403 / 无权限）
    rt = ctx.request.post(
        f"{API}/api/auth/login",
        data={"type": "password", "username": "teacher", "password": "teacher123456"},
    )
    if rt.ok:
        t_tok = rt.json()["data"]["accessToken"]
        rt2 = ctx.request.get(
            f"{API}/api/ai/admin/config", headers={"Authorization": f"Bearer {t_tok}"}
        )
        check("教师账号读取配置被拒", rt2.status in (401, 403), f"状态码 {rt2.status}")
    else:
        check("教师账号读取配置被拒", False, f"teacher 登录失败 {rt.status}")

    real_errors = [e for e in errors if "401" not in e]
    check("无控制台错误（忽略 401）", len(real_errors) == 0, "; ".join(real_errors[:2]))
    browser.close()

fails = [r for r in results if not r[1]]
print(f"\n结果：{len(results) - len(fails)} 通过 / {len(fails)} 失败\n")
sys.exit(1 if fails else 0)
