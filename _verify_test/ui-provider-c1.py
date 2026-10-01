"""
C1 收口 · 浏览器端验证（Playwright）

验证四件事：
  ① 设置页只剩两个底座模式（服务端模型 / 规则引擎），无任何密钥输入框
  ② 服务端模型模式下展示真实模型状态（读 /api/ai/llm-status）
  ③ localStorage 里没有 apiKey 残留（含旧 dify 配置迁移）
  ④ 旧 dify 配置注入后，页面加载会把它清掉（迁移生效）

运行：python _verify_test/ui-provider-c1.py
截图入 evidence/
"""
import sys, json, pathlib
from playwright.sync_api import sync_playwright

# 凭证由 _verify_test/get-workbench-token.mjs 预先生成，或在此处现场签发
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
WB = "http://localhost:18080/ai"
API = "http://127.0.0.1:3000"
NODE = r"C:\Users\rui08\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
EVID = ROOT / "evidence"
EVID.mkdir(exist_ok=True)

pass_n = fail_n = 0
def chk(name, ok, detail=""):
    global pass_n, fail_n
    if ok:
        pass_n += 1
        print(f"  [PASS] {name}" + (f" — {detail}" if detail else ""))
    else:
        fail_n += 1
        print(f"  [FAIL] {name}" + (f" — {detail}" if detail else ""))

def get_token():
    out = subprocess.run(
        [NODE, str(ROOT / "_verify_test" / "get-workbench-token.mjs")],
        capture_output=True, text=True, encoding="utf-8"
    )
    return out.stdout.strip().splitlines()[-1].strip()

print("【准备】签发工作台会话")
token = get_token()
chk("取得 agentToken", len(token) > 40, token[:14] + "…")
if len(token) <= 40:
    sys.exit(1)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page()

    logs = []
    pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}"))
    pg.on("pageerror", lambda e: logs.append(f"pageerror: {e}"))

    # ---- 用票据进入工作台（与老师真实路径一致） ----
    print("\n【①】进入工作台并打开设置页")
    # 先注入 token 到 localStorage（SSO 页会写，这里直接模拟已登录态）
    pg.goto(f"{WB}/#/sso", wait_until="domcontentloaded")
    pg.evaluate(
        """(t) => {
            localStorage.setItem('ai-workbench:session', JSON.stringify({
                id: 2, name: '验证账号', role: 'teacher', source: 'sso',
                loginAt: new Date().toISOString(), agentToken: t
            }));
        }""",
        token,
    )
    pg.goto(f"{WB}/#/settings", wait_until="networkidle")
    pg.wait_for_timeout(2500)

    body = pg.inner_text("body")
    chk("设置页渲染成功", "AI 底座" in body, body[:40].replace("\n", " "))

    # ---- ② 只剩两个模式 ----
    print("\n【②】底座模式只剩两项")
    radios = pg.query_selector_all(".el-radio-button__inner")
    labels = [r.inner_text().strip() for r in radios]
    chk("radio 数量为 2", len(labels) == 2, f"实际 {len(labels)}：{labels}")
    chk("包含『服务端模型』", any("服务端模型" in x for x in labels), str(labels))
    chk("包含『规则引擎』", any("规则引擎" in x for x in labels), str(labels))
    chk("不再出现『Dify』选项", not any("Dify" in x for x in labels), str(labels))

    # ---- ③ 无密钥输入框 ----
    print("\n【③】页面无任何密钥输入入口")
    # Element Plus 会把 radio 和 select 都渲染成 <input>，必须精确到真正的文本录入框
    # （.el-input__inner），否则会把模式按钮、下拉框内部的只读 combobox 误判成输入框。
    pwd_boxes = pg.query_selector_all("input[type='password']")
    chk("页面无密码类型输入框", len(pwd_boxes) == 0, f"实际 {len(pwd_boxes)} 个")

    fields = pg.query_selector_all("input.el-input__inner")
    phs = [i.get_attribute("placeholder") or "(无占位符)" for i in fields]
    chk("文本录入框仅 1 个", len(fields) == 1, f"实际 {len(fields)} 个：{phs}")
    chk("唯一录入框是『教务系统地址』", any("同源" in x for x in phs), str(phs))
    chk("录入框无『Key』『密钥』占位符", not any(("Key" in x or "密钥" in x or "apiKey" in x) for x in phs), str(phs))
    chk("无 readonly 之外的密钥控件", not pg.query_selector("input[name*='key'], input[id*='key']"))

    chk("页面含『不提供任何密钥输入入口』声明", "不提供任何密钥输入入口" in body)
    chk("页面含『Key 只存在于服务端』说明", "Key 只存在于服务端" in body or "不下发前端" in body)

    # ---- ④ 服务端模型状态展示 ----
    print("\n【④】服务端模型状态真实展示")
    txt = pg.inner_text("body")
    chk("显示服务端模型名（deepseek-flash）", "deepseek-flash" in txt, "已展示当前模型")
    chk("展示用量归属说明（ai_usage）", "ai_usage" in txt)
    chk("展示『测试服务端通道』按钮", "测试服务端通道" in txt)

    # ---- ⑤ localStorage 无密钥残留 ----
    print("\n【⑤】localStorage 无密钥残留")
    store = pg.evaluate("() => JSON.stringify(Object.entries(localStorage))")
    chk("localStorage 中无 apiKey", "apiKey" not in store, store[:120])
    chk("localStorage 中无 sk- 密钥", "sk-" not in store)
    cfg_raw = pg.evaluate("() => localStorage.getItem('ai-workbench:provider')")
    # 首次访问没有本地配置时，loadConfig 返回默认值即可，不强制写盘（写盘发生在「保存配置」）
    if cfg_raw:
        cfg = json.loads(cfg_raw)
        keys = sorted(cfg.keys())
        chk("只持久化白名单四字段", keys == ["mode", "model", "priceIn", "priceOut"], str(keys))
        chk("模式合法（server/rule）", cfg.get("mode") in ("server", "rule"), str(cfg.get("mode")))
        chk("配置中无 dify 字段", "dify" not in cfg, str(keys))
    else:
        chk("首次访问无本地配置", True, "尚未写盘，符合预期（保存时才落盘）")

    pg.screenshot(path=str(EVID / "c1-settings-server-mode.png"), full_page=True)
    print("  [shot] evidence/c1-settings-server-mode.png")

    # ---- ⑥ 旧 dify 配置迁移（注入历史残留，看是否被清掉） ----
    print("\n【⑥】旧 dify 配置自动迁移清理")
    pg.evaluate(
        """() => {
            localStorage.setItem('ai-workbench:provider', JSON.stringify({
                mode: 'dify',
                priceIn: 3, priceOut: 9, model: 'x',
                dify: { endpoint: 'http://x', apiKey: 'app-LEAKED_KEY_123456' }
            }));
        }"""
    )
    pg.reload(wait_until="networkidle")
    pg.wait_for_timeout(2000)
    after = pg.evaluate("() => localStorage.getItem('ai-workbench:provider')")
    chk("旧配置的 dify 字段被清除", after and "dify" not in after, after or "空")
    chk("旧配置的 apiKey 被清除", after and "LEAKED_KEY" not in after, "已抹除历史密钥")
    if after:
        cfg2 = json.loads(after)
        chk("迁移后回落到 server 模式", cfg2.get("mode") == "server", str(cfg2.get("mode")))
        chk("迁移后字段仅白名单四项", sorted(cfg2.keys()) == ["mode", "model", "priceIn", "priceOut"], str(sorted(cfg2.keys())))

    # ---- ⑦ 切规则引擎模式可保存 ----
    print("\n【⑦】切到规则引擎并保存")
    btns = pg.query_selector_all(".el-radio-button__inner")
    rule_btn = next((x for x in btns if "规则引擎" in x.inner_text()), None)
    if rule_btn:
        rule_btn.click()
        pg.wait_for_timeout(400)
        save = pg.query_selector("button:has-text('保存配置')") or pg.query_selector("button:has-text('已保存')")
        if save:
            save.click()
            pg.wait_for_timeout(700)
        pg.reload(wait_until="networkidle")
        pg.wait_for_timeout(1500)
        cfg3 = pg.evaluate("() => localStorage.getItem('ai-workbench:provider')")
        chk("规则引擎模式可持久化", cfg3 and json.loads(cfg3).get("mode") == "rule", cfg3 or "空")
        pg.screenshot(path=str(EVID / "c1-settings-rule-mode.png"), full_page=True)
        print("  [shot] evidence/c1-settings-rule-mode.png")
        # 切回服务端
        btns2 = pg.query_selector_all(".el-radio-button__inner")
        srv = next((x for x in btns2 if "服务端模型" in x.inner_text()), None)
        if srv:
            srv.click()
            pg.wait_for_timeout(300)
            sv = pg.query_selector("button:has-text('保存配置')") or pg.query_selector("button:has-text('已保存')")
            if sv: sv.click()
            pg.wait_for_timeout(500)
    else:
        chk("找到规则引擎选项", False)

    # ---- ⑧ 侧边栏底座标签 ----
    print("\n【⑧】侧边栏底座标签正确")
    side = pg.inner_text("body")
    chk("标签显示『服务端模型』（非 Dify）", ("服务端模型" in side) and ("Dify 工作流" not in side))

    # ---- 控制台错误 ----
    print("\n【⑨】控制台无 JS 错误")
    errs = [x for x in logs if x.startswith("pageerror") or x.startswith("error:")]
    chk("无 pageerror", not [x for x in errs if x.startswith("pageerror")], "; ".join(errs[:3]))

    b.close()

print("\n" + "=" * 56)
print(f"C1 浏览器验证：{pass_n} 通过 / {fail_n} 失败")
print("=" * 56)
sys.exit(1 if fail_n else 0)
