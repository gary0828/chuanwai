/**
 * 成长数据种子脚本（2026-09-20）
 *
 * 目的：造出「足够跑通功能、又足够真实到能暴露问题」的数据。
 *
 * 设计原则（对齐本次拍板）：
 * 1. **造骨架不造海量**：1 个班 + 8 名学员 × 12 周。不求真实分布，
 *    只求「每条曲线都有起伏」——平坦的数据看不出任何 bug。
 * 2. **刻意埋入边界样本**：4 类典型学员，
 *    - 持续进步型（成绩稳步上升、知识点逐级提升）
 *    - 波动型（成绩上下跳、出勤偶有迟到）
 *    - 需关注型（成绩下滑 + 连续缺勤 + 课时将尽）
 *    - 稳定优秀型（高出席、高成绩、知识点快速全掌握）
 *    这样「需支持 / 可拓展 / 离群 / 里程碑」四个功能都能被触发。
 * 3. **时间序列连贯**：每周一次课，12 周连续，日期不跳空，
 *    否则「连续缺勤」「周趋势」这类依赖序列的判断测不出来。
 * 4. **走真实链路**：直接写库 + 调 timeline.appendEvent，
 *    与线上采集路径同一套逻辑，避免造出「只有脚本能读」的数据。
 *
 * 用法：
 *   node server/scripts/seed-growth.mjs              # 默认造 12 周
 *   node server/scripts/seed-growth.mjs --weeks 16   # 自定义周数
 *   node server/scripts/seed-growth.mjs --clear      # 先清空成长数据再造
 *
 * 注意：脚本可重复执行（先按班级清理成长数据，再重建），不会重复堆叠。
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 允许通过 DB_PATH 指定库文件，默认走 server/data/attendance.db
const db = require(path.join(__dirname, "..", "src", "db.js"));
const timeline = require(path.join(__dirname, "..", "src", "utils", "timeline.js"));

const args = process.argv.slice(2);
const weeks = Number(args.find(a => a.startsWith("--weeks="))?.split("=")[1]) || 12;
const CLEAR = args.includes("--clear");

const TARGET_CLASS_NAME = "启明八年级数学A班";

// ── 工具 ────────────────────────────────────────────────────────
function dateStr(d) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 生成「从今天往前 N 周」的每周上课日（固定周三） */
function weeklyDates(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 7 * 24 * 3600 * 1000);
    out.push(dateStr(d));
  }
  return out;
}

/** 伪随机但可复现（避免每次跑出来的数据不一样，便于对比） */
let seed = 20260920;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function rndInt(min, max) {
  return Math.floor(min + rnd() * (max - min + 1));
}

// ── 主流程 ──────────────────────────────────────────────────────
function main() {
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version < 18) {
    console.error(`❌ 数据库版本 v${version} < v18，请先启动后端执行迁移`);
    process.exit(1);
  }

  // 1. 准备班级（存在则复用）
  // ★ 必须绑定 head_teacher_id：教师账号靠它取数（utils/scope.js 的 classScopeClause）。
  //   实测教训 —— 若为 null，教师登录后看不到这个班，「成长路径」对老师完全不可用。
  const teacher = db
    .prepare("SELECT id, name FROM users WHERE role = 'teacher' ORDER BY id LIMIT 1")
    .get();
  if (!teacher) {
    console.error("❌ 库中没有 teacher 角色账号，请先确保种子数据已初始化");
    process.exit(1);
  }

  let klass = db.prepare("SELECT id, name, head_teacher_id FROM classes WHERE name = ?").get(TARGET_CLASS_NAME);
  if (!klass) {
    const r = db
      .prepare("INSERT INTO classes (name, grade, head_teacher, head_teacher_id) VALUES (?, ?, ?, ?)")
      .run(TARGET_CLASS_NAME, "八年级", teacher.name, teacher.id);
    klass = { id: Number(r.lastInsertRowid), name: TARGET_CLASS_NAME, head_teacher_id: teacher.id };
    console.log(`[seed] 新建班级：${klass.name}（id=${klass.id}，班主任=${teacher.name}）`);
  } else {
    // 复用班级时也补绑（防止历史数据 head_teacher_id 为空）
    if (!klass.head_teacher_id) {
      db.prepare("UPDATE classes SET head_teacher_id = ?, head_teacher = ? WHERE id = ?")
        .run(teacher.id, teacher.name, Number(klass.id));
      console.log(`[seed] 已补绑班主任：${teacher.name} → ${klass.name}`);
    } else {
      console.log(`[seed] 复用班级：${klass.name}（id=${klass.id}）`);
    }
  }
  const classId = Number(klass.id);

  // 2. 清空该班成长数据（保证可重复执行）
  if (CLEAR) {
    const ids = db.prepare("SELECT id FROM students WHERE class_id = ?").all(classId).map(r => r.id);
    if (ids.length) {
      const ph = ids.map(() => "?").join(",");
      db.prepare(`DELETE FROM student_timeline WHERE student_id IN (${ph})`).run(...ids);
      db.prepare(`DELETE FROM class_evaluations WHERE class_id = ?`).run(classId);
      db.prepare(`DELETE FROM kp_assessments WHERE class_id = ?`).run(classId);
      db.prepare(`DELETE FROM attendances WHERE student_id IN (${ph})`).run(...ids);
      db.prepare(`DELETE FROM exam_scores WHERE student_id IN (${ph})`).run(...ids);
      db.prepare(`DELETE FROM hour_consumptions WHERE student_id IN (${ph})`).run(...ids);
      console.log(`[seed] 已清理该班 ${ids.length} 名学员的成长数据`);
    }
  }

  // 3. 课程（存在则复用）
  let course = db.prepare("SELECT id FROM courses WHERE name = ?").get("初中数学");
  if (!course) {
    const r = db
      .prepare("INSERT INTO courses (code, name, teacher) VALUES (?, ?, ?)")
      .run("MATH8", "初中数学", "王老师");
    course = { id: Number(r.lastInsertRowid) };
  }
  const courseId = Number(course.id);

  // 4. 课表（周三，供 eval-form 带出知识点）
  const hasSchedule = db
    .prepare("SELECT 1 FROM schedules WHERE class_id = ? AND course_id = ?")
    .get(classId, courseId);
  if (!hasSchedule) {
    db.prepare(
      "INSERT INTO schedules (class_id, course_id, day_of_week, period) VALUES (?, ?, 3, 1)"
    ).run(classId, courseId);
  }

  // 5. 知识点（课时级粒度：一级=单元，二级=知识点）
  const KP_TREE = [
    {
      code: "U1", name: "第一单元 · 全等三角形", unit: 1, children: [
        { code: "U1-1", name: "全等图形与对应关系", diff: 1 },
        { code: "U1-2", name: "SSS 判定", diff: 2 },
        { code: "U1-3", name: "SAS 判定", diff: 2 },
        { code: "U1-4", name: "ASA 与 AAS 判定", diff: 3 }
      ]
    },
    {
      code: "U2", name: "第二单元 · 角平分线与垂直平分线", unit: 2, children: [
        { code: "U2-1", name: "角平分线的性质", diff: 2 },
        { code: "U2-2", name: "垂直平分线", diff: 3 },
        { code: "U2-3", name: "尺规作图", diff: 3 }
      ]
    },
    {
      code: "U3", name: "第三单元 · 等腰三角形", unit: 3, children: [
        { code: "U3-1", name: "等腰三角形的性质", diff: 2 },
        { code: "U3-2", name: "等边三角形", diff: 3 },
        { code: "U3-3", name: "含 30° 角的直角三角形", diff: 4 }
      ]
    }
  ];

  const kpIds = new Map(); // code -> id
  let seqCounter = 0;
  for (const unit of KP_TREE) {
    let parent = db.prepare("SELECT id FROM knowledge_points WHERE code = ?").get(unit.code);
    if (!parent) {
      const r = db
        .prepare(
          `INSERT INTO knowledge_points (parent_id, code, name, course_id, grade, unit_no, seq, difficulty)
           VALUES (NULL, ?, ?, ?, '八年级', ?, ?, 1)`
        )
        .run(unit.code, unit.name, courseId, unit.unit, 0);
      parent = { id: Number(r.lastInsertRowid) };
    }
    kpIds.set(unit.code, Number(parent.id));
    for (const c of unit.children) {
      seqCounter++;
      const found = db.prepare("SELECT id FROM knowledge_points WHERE code = ?").get(c.code);
      if (found) {
        kpIds.set(c.code, Number(found.id));
        continue;
      }
      const r = db
        .prepare(
          `INSERT INTO knowledge_points (parent_id, code, name, course_id, grade, unit_no, seq, difficulty)
           VALUES (?, ?, ?, ?, '八年级', ?, ?, ?)`
        )
        .run(Number(parent.id), c.code, c.name, courseId, unit.unit, seqCounter, c.diff);
      kpIds.set(c.code, Number(r.lastInsertRowid));
    }
  }
  const leafKps = KP_TREE.flatMap(u =>
    u.children.map(c => ({ id: kpIds.get(c.code), code: c.code, name: c.name, diff: c.diff }))
  );
  console.log(`[seed] 知识点：${KP_TREE.length} 个单元 / ${leafKps.length} 个知识点`);

  // 6. 学员（8 名，4 类典型画像）
  const ROSTER = [
    { no: "2026001", name: "陈嘉禾", profile: "rising" },
    { no: "2026002", name: "刘思远", profile: "steady_top" },
    { no: "2026003", name: "杨雨桐", profile: "wave" },
    { no: "2026004", name: "黄子涵", profile: "at_risk" },
    { no: "2026005", name: "周欣然", profile: "rising" },
    { no: "2026006", name: "吴梓豪", profile: "wave" },
    { no: "2026007", name: "徐若曦", profile: "steady_top" },
    { no: "2026008", name: "孙浩然", profile: "at_risk" }
  ];

  const studentIds = new Map();
  for (const s of ROSTER) {
    const found = db.prepare("SELECT id FROM students WHERE student_no = ?").get(s.no);
    if (found) {
      studentIds.set(s.no, Number(found.id));
      db.prepare("UPDATE students SET class_id = ?, status = '在读' WHERE id = ?").run(classId, Number(found.id));
      continue;
    }
    const r = db
      .prepare(
        `INSERT INTO students (student_no, name, gender, class_id, status, parent_name, parent_phone, enroll_date)
         VALUES (?, ?, ?, ?, '在读', ?, ?, ?)`
      )
      .run(
        s.no, s.name,
        Number(s.no) % 2 === 0 ? "男" : "女",
        classId, "家长", `1390000${s.no.slice(-4)}`,
        dateStr(new Date(Date.now() - (weeks * 7 + 30) * 86400000))
      );
    studentIds.set(s.no, Number(r.lastInsertRowid));
  }
  console.log(`[seed] 学员：${ROSTER.length} 名`);

  // 7. 报班订单（课时包，供「课时将尽」判断）
  for (const s of ROSTER) {
    const sid = studentIds.get(s.no);
    const exists = db.prepare("SELECT id FROM orders WHERE student_id = ? AND class_id = ?").get(sid, classId);
    const totalHours = 60;
    // at_risk 学员刻意设置低剩余课时，触发「课时将尽」
    const remainHours = s.profile === "at_risk" ? rndInt(4, 10) : rndInt(20, 45);
    if (exists) {
      db.prepare("UPDATE orders SET total_hours = ?, remain_hours = ? WHERE id = ?").run(totalHours, remainHours, Number(exists.id));
    } else {
      db.prepare(
        `INSERT INTO orders (student_id, class_id, course_id, enroll_date, amount, status, total_hours, remain_hours)
         VALUES (?, ?, ?, ?, 0, '在读', ?, ?)`
      ).run(sid, classId, courseId, dateStr(new Date(Date.now() - (weeks * 7 + 30) * 86400000)), totalHours, remainHours);
    }
  }

  // 8. 生成每周序列
  const dates = weeklyDates(weeks);
  console.log(`[seed] 时间范围：${dates[0]} → ${dates[dates.length - 1]}（${weeks} 次课）`);

  // 成绩曲线参数（每次课的基准得分率轨迹）
  const PROFILE_CURVE = {
    rising:      i => 58 + i * 3.1 + (rnd() - 0.5) * 4,   // 稳步上升
    steady_top:  i => 90 + (rnd() - 0.5) * 5,             // 高位稳定
    wave:        i => 75 + Math.sin(i / 1.6) * 12 + (rnd() - 0.5) * 8, // 波动
    at_risk:     i => 72 - i * 2.4 + (rnd() - 0.5) * 6   // 持续下滑
  };
  // 知识点推进速度：rising 快、steady_top 很快、wave 中等、at_risk 慢
  const PROFILE_KP = {
    rising: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10],
    steady_top: [3, 5, 7, 8, 10, 10, 10, 10, 10, 10, 10, 10],
    wave: [2, 2, 3, 4, 4, 5, 6, 6, 7, 7, 8, 8],
    at_risk: [1, 1, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3]
  };
  // 缺勤安排：at_risk 中段连续缺勤（触发「连续缺勤」与「需支持」）
  const ABSENT_MAP = {
    "2026004": [5, 6, 7],       // 黄子涵：连续 3 课缺勤
    "2026008": [7, 8]           // 孙浩然：连续 2 课缺勤
  };

  let attCount = 0, evalCount = 0, kpCount = 0, examCount = 0, hourCount = 0;

  for (let wi = 0; wi < weeks; wi++) {
    const date = dates[wi];

    for (const s of ROSTER) {
      const sid = studentIds.get(s.no);
      const curve = PROFILE_CURVE[s.profile];

      // ── ① 出勤 ──
      let status = "正常";
      const absentList = ABSENT_MAP[s.no] || [];
      if (absentList.includes(wi)) {
        status = "缺勤";
      } else if (rnd() < (s.profile === "at_risk" ? 0.18 : 0.06)) {
        status = rnd() < 0.6 ? "迟到" : "请假";
      }
      const dup = db
        .prepare("SELECT 1 FROM attendances WHERE student_id = ? AND course_id = ? AND date = ?")
        .get(sid, courseId, date);
      if (dup) {
        db.prepare("UPDATE attendances SET status = ? WHERE id = ?").run(status, Number(dup.id) || 0);
      } else {
        db.prepare(
          "INSERT INTO attendances (student_id, course_id, date, status) VALUES (?, ?, ?, ?)"
        ).run(sid, courseId, date, status);
      }
      attCount++;
      // 注意：出勤由 attendances 表承载，**不写时间轴**（写了会与 UNION 重复）

      // ── ② 课时消耗（正常出勤才扣）──
      if (status !== "缺勤" && status !== "请假") {
        db.prepare(
          `INSERT INTO hour_consumptions (student_id, order_id, course_id, class_id, date, hours, type)
           VALUES (?, (SELECT id FROM orders WHERE student_id = ? AND class_id = ? LIMIT 1), ?, ?, ?, 2, '扣减')`
        ).run(sid, sid, classId, courseId, classId, date);
        hourCount++;
      }

      // ── ③ 课堂评价（3 维，1-5 分）──
      // 出勤为缺勤时不产生课堂评价（没来上课无法评价），这也是真实情况
      if (status !== "缺勤") {
        const base = s.profile === "at_risk" ? 3 : s.profile === "steady_top" ? 5 : 4;
        const drift = s.profile === "rising" ? wi * 0.12 : s.profile === "at_risk" ? -wi * 0.1 : 0;
        const clamp5 = v => Math.min(5, Math.max(1, Math.round(v)));
        const focus = clamp5(base + drift + (rnd() - 0.5) * 1.2);
        const participation = clamp5(base + drift + (rnd() - 0.5) * 1.2);
        const mastery = clamp5(base + drift - 0.3 + (rnd() - 0.5) * 1.2);
        // 迟到当天的专注度通常低一档，制造真实相关性
        const adjFocus = status === "迟到" ? Math.max(1, focus - 1) : focus;

        const notes = {
          rising: ["这节课主动举手三次", "开始能独立完成证明", "作业质量明显提升", "能帮同桌讲题了"],
          steady_top: ["思路清晰，可加拓展题", "完成速度快", "方法最简", "可尝试竞赛题"],
          wave: ["状态起伏，但基础题稳定", "注意力易分散", "需要多提问带动", "本次表现不错"],
          at_risk: ["注意力不集中", "基础概念仍不牢", "需要单独辅导", "今天状态稍好"]
        };
        const note = rnd() < 0.5 ? "" : notes[s.profile][rndInt(0, notes[s.profile].length - 1)];

        db.prepare(
          `INSERT INTO class_evaluations
             (class_id, course_id, student_id, eval_date, session_no, focus, participation, mastery, teacher_note, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT id FROM users WHERE username='teacher'))
           ON CONFLICT(student_id, course_id, eval_date) DO UPDATE SET
             focus = excluded.focus, participation = excluded.participation,
             mastery = excluded.mastery, teacher_note = excluded.teacher_note`
        ).run(classId, courseId, sid, date, wi + 1, adjFocus, participation, mastery, note);
        evalCount++;

        // 只增不改：时间轴事件（与线上采集路径一致）
        db.prepare(
          `DELETE FROM student_timeline WHERE student_id = ? AND occurred_at = ? AND event_type = 'class_eval'`
        ).run(sid, date);
        timeline.appendEvent({
          studentId: sid, classId, courseId, occurredAt: date,
          eventType: "class_eval",
          payload: { focus: adjFocus, participation, mastery, teacherNote: note },
          source: "manual"
        });
      }

      // ── ④ 知识点掌握评定（三档，逐步推进）──
      // ★ 关键设计（2026-09-20 实测缺陷后修正）：
      // 每次课都写评定，**即使等级没变化**。原因：真实教学里老师每节课都会看
      // 学生当前状态，这条记录本身就是「过程证据」。
      // 若只在等级变化时写入，每个知识点就只剩一条记录，
      // 「从 0 到成功」的过程会被压缩成孤立快照，里程碑识别也会失效
      // （实测：省略未变化记录时，进步型学员的里程碑从 8 个掉到 1 个）。
      const reached = PROFILE_KP[s.profile][Math.min(wi, 11)];
      if (status !== "缺勤") {
        for (let ki = 0; ki < leafKps.length; ki++) {
          const kp = leafKps[ki];
          let level;
          if (ki < reached) {
            level = "已掌握";
          } else if (ki < reached + 2) {
            // 正在学的：难度低的已部分掌握，难度高的仍未掌握
            level = kp.diff <= 2 ? "部分掌握" : "未掌握";
          } else {
            continue; // 还没学到，不做评定（不做无依据的评定）
          }
          // 只评难度允许范围内的，避免「还没教就评已掌握」
          if (kp.diff > 4 && level === "已掌握") level = "部分掌握";

          const prev = db
            .prepare(
              `SELECT level FROM kp_assessments WHERE student_id = ? AND kp_id = ?
               ORDER BY assessed_at DESC, id DESC LIMIT 1`
            )
            .get(sid, kp.id);

          // 等级不变也写——保留过程证据（这是成长曲线的点，不是噪声）
          const changed = !prev || prev.level !== level;
          db.prepare(
            `INSERT INTO kp_assessments
               (student_id, kp_id, class_id, course_id, assessed_at, session_no, level, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT id FROM users WHERE username='teacher'))`
          ).run(sid, kp.id, classId, courseId, date, wi + 1, level);
          kpCount++;

          timeline.appendEvent({
            studentId: sid, classId, courseId, occurredAt: date,
            eventType: "kp_assessment",
            payload: {
              kpId: kp.id, kpName: kp.name, level,
              from: prev ? prev.level : null,
              changed
            },
            source: "manual"
          });
        }
      }
    }
  }

  // 9. 考试（每 4 周一次，共 3 次，覆盖单元测/期中/期末）
  const examPlan = [
    { idx: 3, name: `${weeks}周 · 第一次单元测`, type: "单元测" },
    { idx: 7, name: `${weeks}周 · 期中检测`, type: "期中" },
    { idx: weeks - 1, name: `${weeks}周 · 期末检测`, type: "期末" }
  ];
  for (const ep of examPlan) {
    const date = dates[Math.min(ep.idx, dates.length - 1)];
    let exam = db
      .prepare("SELECT id FROM exams WHERE name = ? AND class_id = ?")
      .get(ep.name, classId);
    if (!exam) {
      const r = db
        .prepare(
          `INSERT INTO exams (name, course_id, class_id, exam_date, type, full_score)
           VALUES (?, ?, ?, ?, ?, 100)`
        )
        .run(ep.name, courseId, classId, date, ep.type);
      exam = { id: Number(r.lastInsertRowid) };
    }
    const examId = Number(exam.id);

    for (const s of ROSTER) {
      const sid = studentIds.get(s.no);
      const raw = PROFILE_CURVE[s.profile](ep.idx);
      const score = Math.min(100, Math.max(30, Math.round(raw * 10) / 10));
      db.prepare(
        `INSERT INTO exam_scores (exam_id, student_id, score)
         VALUES (?, ?, ?)
         ON CONFLICT(exam_id, student_id) DO UPDATE SET score = excluded.score`
      ).run(examId, sid, score);
      examCount++;
      // 注意：成绩由 exam_scores 表承载，**不写时间轴**（写了会与 UNION 重复）
    }
  }

  // 10. 输出结果
  const summary = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM student_timeline WHERE class_id = ?) AS timeline,
         (SELECT COUNT(*) FROM class_evaluations WHERE class_id = ?) AS evals,
         (SELECT COUNT(*) FROM kp_assessments WHERE class_id = ?) AS kpas,
         (SELECT COUNT(*) FROM attendances WHERE student_id IN
            (SELECT id FROM students WHERE class_id = ?)) AS atts`
    )
    .get(classId, classId, classId, classId);

  console.log("");
  console.log("═══════════════════════════════════════════════");
  console.log(`  班级：${TARGET_CLASS_NAME}（id=${classId}）`);
  console.log(`  时间跨度：${dates[0]} → ${dates[dates.length - 1]}（${weeks} 周）`);
  console.log(`  学员：${ROSTER.length} 名`);
  console.log(`  知识点：${leafKps.length} 个（3 个单元）`);
  console.log("───────────────────────────────────────────────");
  console.log(`  考勤记录      ${summary.atts}`);
  console.log(`  课堂评价      ${summary.evals}`);
  console.log(`  知识点评定    ${summary.kpas}`);
  console.log(`  考试成绩      ${examCount}`);
  console.log(`  课时消耗      ${hourCount}`);
  console.log(`  时间轴事件    ${summary.timeline}  ← 核心`);
  console.log("═══════════════════════════════════════════════");
  console.log("");
  console.log("典型画像（用于验证各功能能否被触发）：");
  console.log("  陈嘉禾 / 周欣然  持续进步型 → 应触发「进步明显」「里程碑」");
  console.log("  刘思远 / 徐若曦  稳定优秀型 → 应触发「可以拓展」");
  console.log("  杨雨桐 / 吴梓豪  波动型     → 应触发「离群检测」");
  console.log("  黄子涵 / 孙浩然  需关注型   → 应触发「连续缺勤」「成绩下滑」「课时将尽」");
}

main();
