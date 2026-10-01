# C3 + C2 界面走查（★ 双角色对照：admin 与 teacher 各走一遍）
#
# 用法：python _verify_test/ui-profile.py [WEB] [API]
#   缺省 WEB=API=http://127.0.0.1:18080（统一入口单端口）
#
# 覆盖：顶栏下拉入口 → 个人中心页 → 改资料顶栏联动 → 上传头像顶栏联动
#       → 改密码原密码错误被拒（成功路径与凭证吊销已在 verify-profile.mjs 覆盖，
#         此处不重复"改成功后强制登出"以免反复登录污染现场）
#       → 员工管理页头像列
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import requests
from playwright.sync_api import sync_playwright

WEB = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18080"
API = sys.argv[2] if len(sys.argv) > 2 else WEB
TZ = timezone(timedelta(hours=8))
EV = r"C:\Users\rui08\Desktop\教学管理系统\evidence"
TMP = r"C:\Users\rui08\Desktop\教学管理系统\_verify_test\_tmp"
NEW_PWD = "teacher123456__uicheck"

PASS, FAIL = [], []


def ok(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(("[OK]  " if cond else "[FAIL]") + " " + name + (f"  -- {extra}" if extra else ""))
    return cond


def inject_login(page, d):
    ms = int(datetime.strptime(d["expires"], "%Y/%m/%d %H:%M:%S").replace(tzinfo=TZ).timestamp() * 1000)
    cv = json.dumps({"accessToken": d["accessToken"], "expires": ms, "refreshToken": d["refreshToken"]})
    iv = json.dumps({
        "refreshToken": d["refreshToken"], "expires": ms, "avatar": d.get("avatar", ""),
        "username": d["username"], "nickname": d.get("nickname", ""),
        "roles": d.get("roles", []), "permissions": d.get("permissions", []),
    })
    page.goto(f"{WEB}/#/login", wait_until="domcontentloaded")
    page.evaluate(
        """([c,i])=>{document.cookie='authorized-token='+encodeURIComponent(c)+'; path=/';
            document.cookie='multiple-tabs=true; path=/';localStorage.setItem('user-info',i);}""",
        [cv, iv],
    )
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1200)


def login_api(u, p):
    r = requests.post(f"{API}/api/auth/login", json={"username": u, "password": p}, timeout=15)
    return r.json()["data"]


os.makedirs(TMP, exist_ok=True)
PNG_PATH = os.path.join(TMP, "avatar-test.png")
with open(PNG_PATH, "wb") as f:
    f.write(bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000d49444154789c6360000002000100057f3c3d4c0000000049454e44ae426082"
    ))

admin = login_api("admin", "admin123456")
teacher = login_api("teacher", "teacher123456")
AH = {"Authorization": f"Bearer {admin['accessToken']}", "Content-Type": "application/json"}
teacher_orig = requests.get(f"{API}/api/auth/info", headers={"Authorization": f"Bearer {teacher['accessToken']}"}, timeout=15).json()["data"]
print(f"[info] WEB={WEB} API={API}  teacher 原名={teacher_orig['name']}")


def walk(page, who, token):
    """一个角色的完整走查；返回该角色的失败数增量由外层 ok() 统计"""
    inject_login(page, token if isinstance(token, dict) else token)

    # ① 顶栏下拉里必须有「个人中心」（在 pure-admin 现有下拉上加项，不另造入口）
    page.click(".el-dropdown-link")
    page.wait_for_timeout(600)
    items = page.query_selector_all(".el-dropdown-menu__item")
    texts = [i.inner_text().strip() for i in items]
    ok(f"{who}：顶栏下拉含「个人中心」", any("个人中心" in t for t in texts), f"下拉项={texts}")

    # ② 点进去 → 个人中心页
    for i in items:
        if "个人中心" in i.inner_text():
            i.click()
            break
    page.wait_for_timeout(1800)
    body = page.inner_text("body")
    ok(f"{who}：个人中心页可打开", "/profile" in page.url, page.url)
    ok(f"{who}：页面含头像上传与密码表单", "上传头像" in body and "修改密码" in body, "")

    # ③ 用户名只读（不可自助改）
    uname_input = page.query_selector("input[disabled]")
    ok(f"{who}：用户名输入框为只读", uname_input is not None)

    # ④ 改姓名 → 顶栏昵称应立刻变化（顶栏读的是 store.nickname）
    # ★ 用 placeholder 精确定位：`input:not([disabled])` 会命中 el-upload 的隐藏 file input
    before_name = page.inner_text(".el-dropdown-link p")
    new_name = f"{teacher_orig['name'] if who == '教师' else '管理员'}·走查"
    page.fill("input[placeholder='请输入姓名']", new_name)
    page.click("button:has-text('保存资料')")
    page.wait_for_timeout(1800)
    after_name = page.inner_text(".el-dropdown-link p")
    ok(
        f"{who}：改姓名后顶栏昵称同步更新",
        after_name.strip() == new_name.strip() and before_name.strip() != after_name.strip(),
        f"改前={before_name.strip()} 改后={after_name.strip()}",
    )

    # ⑤ 上传头像 → 顶栏头像应换成真实路径
    page.set_input_files("input.el-upload__input", PNG_PATH)
    page.wait_for_timeout(2500)
    avatar_src = page.get_attribute(".el-dropdown-link img", "src") or ""
    ok(
        f"{who}：上传头像后顶栏头像变为真实路径",
        "/assets/avatars/" in avatar_src,
        f"src={avatar_src[:80]}",
    )

    # ⑥ 改密码：原密码错误必须被拒（成功路径见 verify-profile.mjs）
    page.fill("input[placeholder='请输入当前密码']", "definitely-wrong-pwd")
    page.fill("input[placeholder='至少 8 位']", "newpassword123")
    page.fill("input[placeholder='再次输入新密码']", "newpassword123")
    page.click("button:has-text('修改密码')")
    page.wait_for_timeout(1500)
    ok(
        f"{who}：改密码填错原密码被拒且未登出",
        "/login" not in page.url,
        f"url={page.url}",
    )
    body2 = page.inner_text("body")
    ok(f"{who}：错误提示可见", "原密码不正确" in body2, "")

    errs = getattr(page, "_errs", [])
    page.screenshot(path=os.path.join(EV, f"profile-{who}.png"), full_page=True)
    return errs


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 950})

    for who, tok in (("管理员", admin), ("教师", teacher)):
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg._errs = errs
        try:
            walk(pg, who, tok)
            ok(f"{who}：整页无 JS 报错", len(errs) == 0, f"{errs[:2]}")
        except Exception as e:  # noqa: BLE001
            ok(f"{who}：走查未抛异常", False, str(e)[:200])
        finally:
            pg.close()

    # ⑦ 员工管理页：头像列（admin 视角）
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    inject_login(pg, admin)
    pg.goto(f"{WEB}/#/user", wait_until="networkidle")
    pg.wait_for_timeout(2200)
    body = pg.inner_text("body")
    ok("管理员：员工管理页可打开", "/user" in pg.url, pg.url)
    ok("管理员：表格含「头像」列", "头像" in body, "")
    headers = [th.inner_text().strip() for th in pg.query_selector_all(".el-table__header th")]
    ok("管理员：表头顺序含 头像", "头像" in headers, f"表头={headers}")
    has_avatar_img = pg.query_selector(".el-table__body .el-avatar img") is not None
    has_fallback = pg.query_selector(".el-table__body .avatar-fallback") is not None
    ok(
        "管理员：头像列渲染（已上传显示图片，未上传回落姓名首字）",
        has_avatar_img or has_fallback,
        f"图片={has_avatar_img} 首字回落={has_fallback}",
    )
    ok("管理员：员工管理页无 JS 报错", len(errs) == 0, f"{errs[:2]}")
    pg.screenshot(path=os.path.join(EV, "profile-users-avatar-col.png"), full_page=True)
    pg.close()

    # ⑧ ★ 改密**成功**路径：必须落到登录页，且**不能**出现红色「登录状态已失效」
    #    （2026-09-23 代码审查发现的缺陷：成功后若再调登出接口 → 已吊销 token 必然 401 → 红色报错）
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    inject_login(pg, teacher)
    pg.goto(f"{WEB}/#/profile", wait_until="networkidle")
    pg.wait_for_timeout(1500)
    pg.fill("input[placeholder='请输入当前密码']", "teacher123456")
    pg.fill("input[placeholder='至少 8 位']", NEW_PWD)
    pg.fill("input[placeholder='再次输入新密码']", NEW_PWD)
    pg.click("button:has-text('修改密码')")
    pg.wait_for_timeout(2200)
    ok("教师：改密成功后跳到登录页", "/login" in pg.url, pg.url)
    ok(
        "教师：改密成功后**无**红色错误提示（不出现「登录状态已失效」）",
        pg.query_selector(".el-message--error") is None,
        (pg.query_selector(".el-message--error").inner_text() if pg.query_selector(".el-message--error") else "无"),
    )
    ok(
        "教师：改密成功提示可见",
        pg.query_selector(".el-message--success") is not None,
        "",
    )
    ok("教师：改密页无 JS 报错", len(errs) == 0, f"{errs[:2]}")
    pg.screenshot(path=os.path.join(EV, "profile-pwd-success.png"), full_page=True)
    pg.close()
    b.close()

# 收尾：把走查改掉的姓名还原
try:
    # 先处理第 ⑧ 步成功改密后的密码还原（用新密码登录 → 改回原密码）
    try:
        t_new = login_api("teacher", NEW_PWD)
        requests.put(
            f"{API}/api/auth/password",
            headers={"Authorization": f"Bearer {t_new['accessToken']}", "Content-Type": "application/json"},
            json={"old_password": NEW_PWD, "password": "teacher123456"},
            timeout=15,
        )
        print("[info] 已把 teacher 密码还原为默认值")
    except Exception as e:  # noqa: BLE001
        print("[WARN] 密码还原失败（可能第 ⑧ 步未执行）：", e)

    t2 = login_api("teacher", "teacher123456")
    requests.put(
        f"{API}/api/auth/profile",
        headers={"Authorization": f"Bearer {t2['accessToken']}", "Content-Type": "application/json"},
        json={"name": teacher_orig["name"], "phone": teacher_orig.get("phone", "")},
        timeout=15,
    )
    a2 = login_api("admin", "admin123456")
    ai = requests.get(f"{API}/api/auth/info", headers={"Authorization": f"Bearer {a2['accessToken']}"}, timeout=15).json()["data"]
    requests.put(
        f"{API}/api/auth/profile",
        headers={"Authorization": f"Bearer {a2['accessToken']}", "Content-Type": "application/json"},
        json={"name": ai["name"].replace("·走查", ""), "phone": ai.get("phone", "")},
        timeout=15,
    )
    print("[info] 已还原 admin / teacher 姓名")
except Exception as e:  # noqa: BLE001
    print("[WARN] 还原姓名失败：", e)

print(f"\n======= 结果：PASS {len(PASS)} / FAIL {len(FAIL)} =======")
if FAIL:
    print("失败项：\n - " + "\n - ".join(FAIL))
sys.exit(1 if FAIL else 0)
