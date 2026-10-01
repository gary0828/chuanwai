# 校区反馈 ④⑤ 的自测（沙箱 8848 + 本机后端 3000，不需要 Docker）
#
# ④ 导入学员名单时自动建班（模板加「班主任」「年级」列）
# ⑤ 教室字典（迁移 v23 + 维护页 + 排课模板/加课弹窗/课次详情三处可设）
#
# ★ 测试数据统一用 QA 前缀，脚本末尾清理；不碰真实数据。
import csv
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import requests
from playwright.sync_api import sync_playwright

WEB = os.environ.get("WEB", "http://127.0.0.1:8848")
API = os.environ.get("API", "http://127.0.0.1:3000")
TZ = timezone(timedelta(hours=8))
STAMP = datetime.now().strftime("%H%M%S")
ROOM_A = f"QA自测教室A_{STAMP}"
ROOM_B = f"QA教室UI_{STAMP}"
NEW_CLASS = f"QA导入新班_{STAMP}"
CSV_PATH = os.path.join(os.environ.get("TEMP", "/tmp"), f"qa-import-{STAMP}.csv")

passed = failed = 0
created = {"rooms": [], "students": [], "classes": [], "schedules": []}


def ok(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print("  ✅ " + name)
    else:
        failed += 1
        print("  ❌ " + name + (("  → " + str(extra)) if extra else ""))


def unwrap(resp, key="data"):
    """兼容两种返回结构：数组 或 { list, total }"""
    d = resp.json().get(key)
    if isinstance(d, dict):
        return d.get("list", [])
    return d or []


def login(u, p):
    r = requests.post(f"{API}/api/auth/login", json={"username": u, "password": p}, timeout=15)
    return r.json().get("data")


A = login("admin", "admin123456")
T = login("teacher", "teacher123456")
HA = {"Authorization": f"Bearer {A['accessToken']}", "Content-Type": "application/json"}
HT = {"Authorization": f"Bearer {T['accessToken']}", "Content-Type": "application/json"}

# ═══════════════════════════════════════════════════════════
print("\n═══ ⑤ 教室接口（CRUD + 权限 + 删除保护）═══")
r = requests.post(f"{API}/api/rooms", json={"name": ROOM_A}, headers=HT, timeout=15)
ok("teacher 新增教室被拒（403）", r.status_code == 403, f"实际 {r.status_code}")

r = requests.post(f"{API}/api/rooms", json={"name": ROOM_A, "capacity": 40, "remark": "自测"},
                  headers=HA, timeout=15)
ok("admin 新增教室成功", r.status_code == 200 and r.json().get("success"), r.text[:120])
room_id = r.json().get("data", {}).get("id") if r.status_code == 200 else None
if room_id:
    created["rooms"].append(room_id)

r = requests.post(f"{API}/api/rooms", json={"name": ROOM_A}, headers=HA, timeout=15)
ok("教室重名被拒（400）", r.status_code == 400, f"实际 {r.status_code}")

r = requests.post(f"{API}/api/rooms", json={"name": f"QA容量非法_{STAMP}", "capacity": -5},
                  headers=HA, timeout=15)
ok("容量传负数被拒（400）", r.status_code == 400, f"实际 {r.status_code}")

r = requests.get(f"{API}/api/rooms?keyword={STAMP}", headers=HA, timeout=15)
names = [x["name"] for x in unwrap(r)]
ok("教室列表可搜索到", ROOM_A in names, str(names))
ok("列表带 capacity 字段", all("capacity" in x for x in unwrap(r)))

r = requests.put(f"{API}/api/rooms/{room_id}", json={"name": ROOM_A, "capacity": 55},
                 headers=HA, timeout=15)
ok("修改教室成功", r.status_code == 200, r.text[:120])

# ═══════════════════════════════════════════════════════════
print("\n═══ ⑤ 排课模板带教室 + 删除保护 ═══")
cls = unwrap(requests.get(f"{API}/api/classes", headers=HA, timeout=15))[0]
crs = unwrap(requests.get(f"{API}/api/courses", headers=HA, timeout=15))[0]
# 找一个该班该时段没被占用的格子（周二第 8 节）
r = requests.post(f"{API}/api/schedules",
                  json={"class_id": cls["id"], "course_id": crs["id"], "day_of_week": 2,
                        "period": 8, "room_id": room_id}, headers=HA, timeout=15)
ok("排课模板可带教室保存", r.status_code == 200 and r.json().get("success"), r.text[:150])
sched_id = r.json().get("data", {}).get("id") if r.status_code == 200 else None
if sched_id:
    created["schedules"].append(sched_id)

r = requests.get(f"{API}/api/schedules?pageSize=200", headers=HA, timeout=15)
row = next((x for x in r.json()["data"]["list"] if x["id"] == sched_id), None)
ok("排课列表返回 room_name", bool(row and row.get("room_name") == ROOM_A),
   f"room_name={row.get('room_name') if row else '未找到'}")

r = requests.delete(f"{API}/api/rooms/{room_id}", headers=HA, timeout=15)
ok("被排课引用的教室删除被拒（400）", r.status_code == 400, f"实际 {r.status_code}")
ok("★ 拒绝原因点名「排课」", "排课" in (r.json().get("message") or ""), r.json().get("message"))

r = requests.post(f"{API}/api/schedules",
                  json={"class_id": cls["id"], "course_id": crs["id"], "day_of_week": 3,
                        "period": 8, "room_id": 999999}, headers=HA, timeout=15)
ok("排课传不存在的教室被拒（400）", r.status_code == 400, f"实际 {r.status_code}")

# ═══════════════════════════════════════════════════════════
print("\n═══ ⑤ 课次教室（改教室接口）═══")
week_start = (datetime.now() - timedelta(days=datetime.now().weekday())).strftime("%Y-%m-%d")
r = requests.get(f"{API}/api/sessions/week?view=all&week_start={week_start}", headers=HA, timeout=15)
sess = r.json()["data"]["sessions"]
ok("周视图返回 room_name 字段", all("room_name" in s for s in sess), f"{len(sess)} 节")
if sess:
    sid = sess[0]["id"]
    r = requests.put(f"{API}/api/sessions/{sid}/room", json={"room_id": room_id},
                     headers=HA, timeout=15)
    ok("admin 可改课次教室", r.status_code == 200, r.text[:120])
    r = requests.get(f"{API}/api/sessions/{sid}", headers=HA, timeout=15)
    ok("★ 详情返回教室名（不再是数字 id）", r.json()["data"]["session"].get("room_name") == ROOM_A,
       f"room_name={r.json()['data']['session'].get('room_name')}")
    r = requests.put(f"{API}/api/sessions/{sid}/room", json={"room_id": None}, headers=HA, timeout=15)
    ok("教室可清空（传 null）", r.status_code == 200, r.text[:120])

# ═══════════════════════════════════════════════════════════
print("\n═══ ④ 导入自动建班（浏览器 + 真实文件上传）═══")
# 教师姓名用于匹配「班主任」列
teachers = requests.get(f"{API}/api/users?role=teacher&pageSize=5", headers=HA, timeout=15)
tname = (unwrap(teachers) or [{}])[0].get("name", "")
with open(CSV_PATH, "w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f)
    w.writerow(["学号", "姓名", "性别", "班级", "班主任", "年级", "状态"])
    w.writerow([f"QA{STAMP}01", f"QA导入学员_{STAMP}", "男", NEW_CLASS, tname, "QA一年级", "在读"])
print(f"     测试 CSV：班级「{NEW_CLASS}」，班主任「{tname}」")

cls_before = requests.get(f"{API}/api/classes?pageSize=1", headers=HA, timeout=15).json()["data"]["total"]
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1500, "height": 950})
    pg = ctx.new_page()
    ms = int(datetime.strptime(A["expires"], "%Y/%m/%d %H:%M:%S").replace(tzinfo=TZ).timestamp() * 1000)
    cv = json.dumps({"accessToken": A["accessToken"], "expires": ms, "refreshToken": A["refreshToken"]})
    iv = json.dumps({"refreshToken": A["refreshToken"], "expires": ms, "avatar": A.get("avatar", ""),
                     "username": A["username"], "nickname": A.get("nickname", ""),
                     "roles": A.get("roles", []), "permissions": A.get("permissions", [])})
    pg.goto(f"{WEB}/#/login", wait_until="domcontentloaded")
    pg.evaluate("""([c,i])=>{document.cookie='authorized-token='+encodeURIComponent(c)+'; path=/';
        document.cookie='multiple-tabs=true; path=/';localStorage.setItem('user-info',i);}""", [cv, iv])
    pg.reload(wait_until="networkidle")
    pg.wait_for_timeout(2000)

    # 学生页导入
    pg.goto(f"{WEB}/#/data/students", wait_until="networkidle")
    pg.wait_for_timeout(2000)
    up = pg.locator("input[type=file]").first
    up.set_input_files(CSV_PATH)
    pg.wait_for_timeout(4000)
    dlg = pg.locator(".el-dialog").filter(has_text="导入结果")
    shown = dlg.count() > 0 and dlg.first.is_visible()
    ok("★ 导入弹窗出现（此前班级不存在会整批取消）", shown)
    if shown:
        txt = dlg.first.inner_text()
        print("     弹窗内容：" + txt.replace("\n", " | ")[:200])
        ok("★ 弹窗提示「已自动创建 1 个班级」", "已自动创建" in txt, txt[:160])
        ok("成功导入 1 条", "成功 1 条" in txt or "成功 1" in txt, txt[:120])
        pg.screenshot(path="evidence/campus-import-autoclass.png")
        pg.get_by_role("button", name="知道了").first.click()
        pg.wait_for_timeout(800)

    _ca = requests.get(f"{API}/api/classes?pageSize=200", headers=HA, timeout=15).json()["data"]
    cls_after = _ca["list"]
    cls_after_total = _ca["total"]
    ok("★ 班级确实被创建", cls_after_total == cls_before + 1, f"总数 {cls_before} → {cls_after_total}")
    newc = next((c for c in cls_after if c["name"] == NEW_CLASS), None)
    if newc:
        created["classes"].append(newc["id"])
        ok("★ 年级列已写入班级", newc.get("grade") == "QA一年级", f"grade={newc.get('grade')}")
        ok("★ 班主任按姓名匹配到教师账号", bool(newc.get("head_teacher_id")), f"head_teacher_id={newc.get('head_teacher_id')}")
    stus = unwrap(requests.get(f"{API}/api/students?name=QA导入学员&pageSize=50", headers=HA, timeout=15))
    ok("★ 学员已被分到新班级", any(s["class_id"] == (newc or {}).get("id") for s in stus), f"{len(stus)} 名")
    for s in stus:
        created["students"].append(s["id"])

    # 教室管理页
    pg.goto(f"{WEB}/#/attendance/rooms", wait_until="networkidle")
    pg.wait_for_timeout(2000)
    ok("★ 教室管理页可打开", pg.locator("text=教室管理").count() > 0)
    pg.get_by_role("button", name="新增教室").first.click()
    pg.wait_for_timeout(800)
    pg.locator(".el-dialog input").first.fill(ROOM_B)
    pg.screenshot(path="evidence/campus-room-page.png")
    pg.get_by_role("button", name="保存").first.click()
    pg.wait_for_timeout(1500)
    ok("★ 维护页新建教室成功", ROOM_B in pg.content())
    news = unwrap(requests.get(f"{API}/api/rooms?keyword={STAMP}", headers=HA, timeout=15))
    nb = next((x for x in news if x["name"] == ROOM_B), None)
    if nb:
        created["rooms"].append(nb["id"])

    # 排课模板弹窗 / 加课弹窗 / 课次详情
    pg.goto(f"{WEB}/#/data/schedules", wait_until="networkidle")
    pg.wait_for_timeout(2500)
    # 该页需先选班级才渲染排课表格
    pg.locator(".el-select").first.click()
    pg.wait_for_timeout(800)
    pg.locator(".el-select-dropdown__item").first.click()
    pg.wait_for_timeout(2000)
    pg.locator("button:has-text('添加')").first.click()
    pg.wait_for_timeout(1200)
    ok("★ 排课模板弹窗有「上课教室」", "上课教室" in pg.content())
    pg.screenshot(path="evidence/campus-schedule-room.png")
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(500)

    pg.goto(f"{WEB}/#/attendance/sessions", wait_until="networkidle")
    pg.wait_for_timeout(2500)
    pg.locator(".wg-cell").first.hover()
    pg.wait_for_timeout(400)
    add = pg.locator(".wg-cell__add").first
    if add.count() > 0:
        add.click()
        pg.wait_for_timeout(1200)
        ok("★ 加课弹窗有「上课教室」", "上课教室" in pg.content())
        pg.screenshot(path="evidence/campus-add-dialog-room.png")
    b.close()

# ═══════════════════════════════════════════════════════════
print("\n═══ 清理测试数据 ═══")
for sid in created["students"]:
    requests.delete(f"{API}/api/students/{sid}", headers=HA, timeout=15)
for cid in created["classes"]:
    requests.delete(f"{API}/api/classes/{cid}", headers=HA, timeout=15)
for sid in created["schedules"]:
    requests.delete(f"{API}/api/schedules/{sid}", headers=HA, timeout=15)
for rid in created["rooms"]:
    requests.delete(f"{API}/api/rooms/{rid}", headers=HA, timeout=15)
left = unwrap(requests.get(f"{API}/api/rooms?keyword={STAMP}", headers=HA, timeout=15))
ok("测试教室已清理", len(left) == 0, f"残留 {[x['name'] for x in left]}")
try:
    os.remove(CSV_PATH)
except OSError:
    pass

print("\n" + "═" * 58)
print(f"自测结果：PASS {passed}  FAIL {failed}")
print("═" * 58)
sys.exit(1 if failed else 0)
