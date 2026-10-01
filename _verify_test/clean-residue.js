// 清理容器库中的 e2e 测试残留（按外键依赖顺序），保留演示数据与 admin/teacher 账号
const db = require("/app/src/db");

const echo = (label, fn) => {
  try {
    const r = fn();
    console.log(`${label}: ${r.changes ?? r}`);
  } catch (e) {
    console.log(`${label}: ERR ${e.message}`);
  }
};

console.log("=== 清理前 ===");
for (const t of ["students", "classes", "courses", "leads", "orders", "notifications", "schedules", "schedule_adjustments", "makeup_classes", "attendances", "exam_scores", "exams", "leaves", "payments", "refunds", "hour_consumptions"]) {
  try { console.log(` ${t}:`, db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c); } catch {}
}

console.log("\n=== 执行清理（仅清 e2e_ 相关）===");
// 1) 先清依赖 e2e 学生/班级/课程的子表
echo("attendance(e2e学生)", () => db.prepare("DELETE FROM attendances WHERE student_id IN (SELECT id FROM students WHERE name LIKE 'e2e_%')").run());
echo("hour_consumptions(e2e学生)", () => db.prepare("DELETE FROM hour_consumptions WHERE student_id IN (SELECT id FROM students WHERE name LIKE 'e2e_%')").run());
echo("exam_scores(e2e考试)", () => db.prepare("DELETE FROM exam_scores WHERE exam_id IN (SELECT id FROM exams WHERE name LIKE 'e2e_%')").run());
echo("student_timeline(e2e学生)", () => db.prepare("DELETE FROM student_timeline WHERE student_id IN (SELECT id FROM students WHERE name LIKE 'e2e_%')").run());
echo("growth/class_evaluations", () => db.prepare("DELETE FROM class_evaluations WHERE class_id IN (SELECT id FROM classes WHERE name LIKE 'e2e_%')").run());
echo("leaves(e2e学生)", () => db.prepare("DELETE FROM leaves WHERE student_id IN (SELECT id FROM students WHERE name LIKE 'e2e_%')").run());
echo("makeup_classes(e2e)", () => db.prepare("DELETE FROM makeup_classes WHERE student_id IN (SELECT id FROM students WHERE name LIKE 'e2e_%') OR class_id IN (SELECT id FROM classes WHERE name LIKE 'e2e_%')").run());
echo("schedule_adjustments(e2e)", () => db.prepare("DELETE FROM schedule_adjustments WHERE class_id IN (SELECT id FROM classes WHERE name LIKE 'e2e_%')").run());
echo("schedules(e2e)", () => db.prepare("DELETE FROM schedules WHERE class_id IN (SELECT id FROM classes WHERE name LIKE 'e2e_%')").run());
echo("notifications(e2e)", () => db.prepare("DELETE FROM notifications WHERE student_id IN (SELECT id FROM students WHERE name LIKE 'e2e_%') OR title LIKE '%e2e_%' OR content LIKE '%e2e_%'").run());
echo("payments(e2e订单)", () => db.prepare("DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE student_id IN (SELECT id FROM students WHERE name LIKE 'e2e_%'))").run());
echo("refunds(e2e订单)", () => db.prepare("DELETE FROM refunds WHERE order_id IN (SELECT id FROM orders WHERE student_id IN (SELECT id FROM students WHERE name LIKE 'e2e_%'))").run());
echo("orders(e2e学生)", () => db.prepare("DELETE FROM orders WHERE student_id IN (SELECT id FROM students WHERE name LIKE 'e2e_%')").run());
echo("exams(e2e)", () => db.prepare("DELETE FROM exams WHERE name LIKE 'e2e_%'").run());
// 2) 学生 / 线索 / 班级 / 课程
echo("students(e2e_)", () => db.prepare("DELETE FROM students WHERE name LIKE 'e2e_%'").run());
echo("leads(e2e_ 未转化)", () => db.prepare("DELETE FROM leads WHERE name LIKE 'e2e_%' AND status <> '已转化'").run());
echo("leads(e2e_ 已转化)", () => db.prepare("DELETE FROM leads WHERE name LIKE 'e2e_%'").run());
echo("classes(e2e_)", () => db.prepare("DELETE FROM classes WHERE name LIKE 'e2e_%'").run());
echo("courses(e2e_)", () => db.prepare("DELETE FROM courses WHERE name LIKE 'e2e_%'").run());

console.log("\n=== 清理后 ===");
for (const t of ["students", "classes", "courses", "leads", "orders", "notifications", "schedules", "schedule_adjustments", "makeup_classes", "attendances", "exams"]) {
  try { console.log(` ${t}:`, db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c); } catch {}
}
console.log("\n=== 剩余班级 ===");
for (const c of db.prepare("SELECT id,name,head_teacher_id FROM classes").all()) console.log(" ", c);
