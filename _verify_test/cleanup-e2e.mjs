// e2e 残留清理（一次性工具）
// 用途：删除守卫变严后（K-052），有课消流水/课次的 e2e 测试数据无法再经 API 删除，
//      需要直接按依赖顺序清理。本脚本用相对路径打开数据库，便于在容器内执行：
//        docker cp _verify_test/cleanup-e2e.mjs attendance-server:/app/cleanup-e2e.mjs
//        docker exec attendance-server node cleanup-e2e.mjs
import { DatabaseSync } from "node:sqlite";

// 容器内执行时用绝对路径（写在文件里，不会被 Git Bash 的路径转换干扰）
const db = new DatabaseSync(process.env.DB || "/app/data/attendance.db");
const ids = sql => db.prepare(sql).all().map(r => r.id);

const stuIds = ids("SELECT id FROM students WHERE name LIKE 'e2e\\_%' ESCAPE '\\'");
const clsIds = ids("SELECT id FROM classes WHERE name LIKE 'e2e\\_%' ESCAPE '\\'");
const crsIds = ids("SELECT id FROM courses WHERE code LIKE 'e2e\\_%' ESCAPE '\\' OR name LIKE 'e2e\\_%' ESCAPE '\\'");
const ordIds = stuIds.length ? ids("SELECT id FROM orders WHERE student_id IN (" + stuIds.join(",") + ")") : [];
const leadIds = ids("SELECT id FROM leads WHERE name LIKE 'e2e\\_%' ESCAPE '\\'");

console.log(`待清理：学生 ${stuIds.length} / 班级 ${clsIds.length} / 课程 ${crsIds.length} / 订单 ${ordIds.length} / 线索 ${leadIds.length}`);
const L = a => (a.length ? a.join(",") : "-1");
let total = 0;
const run = (sql, label) => {
  const c = db.prepare(sql).run().changes;
  if (c) {
    console.log(`  删除 ${label}：${c}`);
    total += c;
  }
};

// 按依赖顺序：先子后父
run(`DELETE FROM hour_consumptions WHERE order_id IN (${L(ordIds)}) OR student_id IN (${L(stuIds)})`, "课消流水");
run(`DELETE FROM class_sessions WHERE course_id IN (${L(crsIds)}) OR class_id IN (${L(clsIds)})`, "课次");
run(`DELETE FROM attendances WHERE student_id IN (${L(stuIds)}) OR course_id IN (${L(crsIds)})`, "考勤");
run(`DELETE FROM leaves WHERE student_id IN (${L(stuIds)})`, "请假");
run(`DELETE FROM makeup_classes WHERE student_id IN (${L(stuIds)})`, "补课");
run(`DELETE FROM notifications WHERE student_id IN (${L(stuIds)})`, "通知");
run(`DELETE FROM exam_scores WHERE student_id IN (${L(stuIds)})`, "成绩");
run(`DELETE FROM class_evaluations WHERE student_id IN (${L(stuIds)})`, "课堂评价");
run(`DELETE FROM student_timeline WHERE student_id IN (${L(stuIds)})`, "成长档案");
run(`DELETE FROM kp_assessments WHERE student_id IN (${L(stuIds)})`, "知识点测评");
run(`DELETE FROM payments WHERE order_id IN (${L(ordIds)})`, "缴费");
run(`DELETE FROM refunds WHERE order_id IN (${L(ordIds)})`, "退费");
run(`DELETE FROM orders WHERE id IN (${L(ordIds)})`, "订单");
run(`DELETE FROM schedules WHERE class_id IN (${L(clsIds)}) OR course_id IN (${L(crsIds)})`, "排课模板");
run(`DELETE FROM schedule_adjustments WHERE class_id IN (${L(clsIds)}) OR course_id IN (${L(crsIds)})`, "调课申请");
run(`DELETE FROM teaching_assignments WHERE class_id IN (${L(clsIds)}) OR course_id IN (${L(crsIds)})`, "任课关系");
run(`DELETE FROM exams WHERE class_id IN (${L(clsIds)}) OR course_id IN (${L(crsIds)})`, "考试");
run(`DELETE FROM students WHERE id IN (${L(stuIds)})`, "学生");
run(`DELETE FROM leads WHERE id IN (${L(leadIds)})`, "线索");
run(`DELETE FROM classes WHERE id IN (${L(clsIds)})`, "班级");
run(`DELETE FROM courses WHERE id IN (${L(crsIds)})`, "课程");

console.log(`共清理 ${total} 行`);
db.close();
