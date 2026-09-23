import os, subprocess, time

base = r"C:\Users\rui08\Desktop\教学管理系统"
aw = os.path.join(base, "ai-workbench")

def count():
    return sum(len(fs) for _, _, fs in os.walk(aw)) if os.path.exists(aw) else -1

rep = []
r = subprocess.run(["git", "-C", base, "checkout", "011d4be", "--", "ai-workbench"], capture_output=True)
rep.append("restore rc=%s err=%s" % (r.returncode, r.stderr.decode("utf-8", "replace").strip()))
rep.append("t=0s  -> %d" % count())

for i in range(1, 13):
    time.sleep(5)
    n = count()
    rep.append("t=%ds -> %d" % (i * 5, n))
    if n < 0:
        break

open(os.path.join(os.environ["TEMP"], "_watch.txt"), "w", encoding="utf-8").write("\n".join(rep))
