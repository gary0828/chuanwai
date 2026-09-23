import os, subprocess, time

base = r"C:\Users\rui08\Desktop\教学管理系统"
rep = []

# 1) 相关进程
for img in ["git.exe", "node.exe", "python.exe", "Code.exe", "WorkBuddy.exe", "OneDrive.exe"]:
    r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq " + img, "/FO", "CSV", "/NH"],
                       capture_output=True)
    t = r.stdout.decode("gbk", "ignore").strip()
    rep.append("%-16s -> %s" % (img, (t[:300] if t else "(none)")))

# 2) ai-workbench 是否 reparse point / 是否真不存在
aw = os.path.join(base, "ai-workbench")
rep.append("")
rep.append("ai-workbench exists: %s" % os.path.exists(aw))
try:
    st = os.lstat(aw)
    rep.append("lstat mode=%o reparse=%s" % (st.st_mode, bool(st.st_file_attributes & 0x400) if hasattr(st, "st_file_attributes") else "n/a"))
except Exception as e:
    rep.append("lstat err: %s" % e)

# 3) 根目录里 ai 开头的条目
rep.append("")
rep.append("root entries with 'ai': %s" % [x for x in os.listdir(base) if "ai" in x.lower()])

# 4) .gitignore 里是否误加了 ai-workbench 相关规则
gi = open(os.path.join(base, ".gitignore"), encoding="utf-8").read()
hits = [l for l in gi.splitlines() if "ai-workbench" in l or l.strip() == "*" or "ai-" in l]
rep.append("")
rep.append(".gitignore 命中 ai-workbench 的行: %s" % (hits or "无"))
ai = os.path.join(base, ".aiignore")
if os.path.exists(ai):
    rep.append("")
    rep.append("=== .aiignore ===")
    rep.append(open(ai, encoding="utf-8", errors="replace").read()[:800])

open(os.path.join(os.environ["TEMP"], "_proc.txt"), "w", encoding="utf-8").write("\n".join(rep))
