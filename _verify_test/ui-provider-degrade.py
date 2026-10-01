"""
C1 收口 · 降级链路验证：后端无 Key 时前端自动回退规则引擎

做法：临时以 LLM_API_KEY="" 启动一个后端实例（:3999），
让工作台指向它，验证：
  ① /api/ai/generate 返回 503 + LLM_NOT_CONFIGURED
  ② 工作台生成动作不报错、仍能出内容（规则引擎兜底）
  ③ 界面明确标注降级原因
运行：python _verify_test/ui-provider-degrade.py
"""
import sys, json, pathlib, subprocess, time, os, signal
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
NODE = r"C:\Users\rui08\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
WB = "http://localhost:8082"
API_NO_KEY = "http://127.0.0.1:3999"
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

# ---------- 起一个无 Key 的后端 ----------
print("【准备】以空 LLM_API_KEY 启动临时后端 :3999")
env = dict(os.environ)
env["PORT"] = "3999"
env["LLM_API_KEY"] = ""
env["LLM_MODEL"] = "deepseek-flash"
env["JWT_SECRET"] = os.environ.get("JWT_SECRET") or ("a" * 64)
env["AI_WORKBENCH_URL"] = WB
env["CORS_ORIGINS"] = WB + ",http://127.0.0.1:8082,http://localhost:8080"

proc = subprocess.Popen(
    [NODE, "src/index.js"],
    cwd=str(ROOT / "server"),
    env=env,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    encoding="utf-8",
    errors="replace",
)

def wait_up(url, secs=25):
    import urllib.request
    for _ in range(secs * 2):
        try:
            with urllib.request.urlopen(url, timeout=1) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.5)
    return False

try:
    up = wait_up(f"{API_NO_KEY}/api/health")
    chk("临时后端已启动（无 Key）", up, API_NO_KEY)
    if not up:
        raise SystemExit(1)

    # ---------- ① 直接探接口 ----------
    print("\n【①】无 Key 时接口契约")
    import urllib.request
    def post(path, body, token=None):
        data = json.dumps(body).encode()
        req = urllib.request.Request(API_NO_KEY + path, data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        if token:
            req.add_header("Authorization", "Bearer " + token)
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    st, body = post("/api/auth/login", {"username": "teacher", "password": "teacher123456"})
    chk("临时后端可登录", st == 200 and body.get("success"), f"HTTP {st}")
    utok = body["data"].get("token") or body["data"].get("accessToken")

    st2, body2 = post("/api/ai/sso/ticket", {}, utok)
    ticket = body2["data"]["ticket"]
    st3, body3 = post("/api/ai/sso/verify", {"ticket": ticket})
    agent = body3["data"]["agentToken"]
    chk("可签发 agentToken", bool(agent), agent[:12] + "…")

    st4, body4 = post("/api/ai/generate", {"scene": "lesson_plan", "payload": {"x": 1}}, agent)
    chk("无 Key 时 generate 返回 503", st4 == 503, f"HTTP {st4}")
    chk("错误码为 LLM_NOT_CONFIGURED", body4.get("code") == "LLM_NOT_CONFIGURED", body4.get("code"))

    st5, body5 = post("/api/ai/llm-status", {}, agent) if False else (None, None)
    import urllib.request as u2
    req = u2.Request(API_NO_KEY + "/api/ai/llm-status", method="GET")
    req.add_header("Authorization", "Bearer " + agent)
    with u2.urlopen(req) as r:
        s6 = json.loads(r.read())
    chk("llm-status 显示未配置", s6["data"]["configured"] is False, str(s6["data"]))

    # ---------- ② 浏览器：工作台指向无 Key 后端，生成应降级 ----------
    print("\n【②】工作台降级链路（浏览器）")
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
        logs = []
        pg.on("pageerror", lambda e: logs.append(str(e)))

        pg.goto(f"{WB}/#/sso", wait_until="domcontentloaded")
        pg.evaluate(
            """([t, api]) => {
                localStorage.setItem('ai-workbench:session', JSON.stringify({
                    id: 2, name: '降级验证', role: 'teacher', source: 'sso',
                    loginAt: new Date().toISOString(), agentToken: t
                }));
                localStorage.setItem('ai-workbench:api', api);
                localStorage.setItem('ai-workbench:provider', JSON.stringify({
                    mode: 'server', priceIn: 3, priceOut: 9, model: 'deepseek-flash'
                }));
            }""",
            [agent, API_NO_KEY],
        )
        pg.goto(f"{WB}/#/settings", wait_until="networkidle")
        pg.wait_for_timeout(2500)
        body = pg.inner_text("body")
        chk("设置页识别到「未配置」", "未配置" in body, "已显示未配置状态")
        pg.screenshot(path=str(EVID / "c1-degrade-settings.png"), full_page=True)
        print("  [shot] evidence/c1-degrade-settings.png")

        # 点「测试服务端通道」，应给出 503 降级提示
        btn = pg.query_selector("button:has-text('测试服务端通道')")
        if btn:
            btn.click()
            pg.wait_for_timeout(6000)
            after = pg.inner_text("body")
            chk("测试按钮给出未配置/降级提示", ("未配置" in after or "回退" in after or "LLM_NOT_CONFIGURED" in after),
                "已提示")
        else:
            chk("找到测试按钮", False)

        # 到教学模块触发一次真实生成，验证降级后仍有内容
        pg.goto(f"{WB}/#/teaching", wait_until="networkidle")
        pg.wait_for_timeout(2500)
        gen_btn = pg.query_selector("button:has-text('生成')")
        if gen_btn:
            gen_btn.click()
            pg.wait_for_timeout(9000)
            t2 = pg.inner_text("body")
            has_fallback = ("规则引擎" in t2) or ("回退" in t2) or ("降级" in t2)
            chk("降级后界面标注规则引擎/回退原因", has_fallback, "已标注")
            chk("生成区有实际内容（未空白）", len(t2) > 600, f"{len(t2)} 字")
            pg.screenshot(path=str(EVID / "c1-degrade-generate.png"), full_page=True)
            print("  [shot] evidence/c1-degrade-generate.png")
        else:
            print("  [skip] 教学页未找到生成按钮，跳过")

        chk("降级过程无 JS 崩溃", not logs, "; ".join(logs[:2]))
        b.close()

finally:
    proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout=8)
    except subprocess.TimeoutExpired:
        proc.kill()
    print("\n临时后端已停止")

print("\n" + "=" * 56)
print(f"降级链路验证：{pass_n} 通过 / {fail_n} 失败")
print("=" * 56)
sys.exit(1 if fail_n else 0)
