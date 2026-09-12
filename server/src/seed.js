// 初始化种子数据（仅当 users 表为空时执行）
const db = require("./db");
const bcrypt = require("bcryptjs");

function today(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function seed() {
  const userCount = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  if (userCount > 0) return;

  const hash = pwd => bcrypt.hashSync(pwd, 10);

  // 用户：admin（管理员）/ teacher（教师）；初始密码规则 = 用户名 + 123456
  db.prepare(
    "INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)"
  ).run("admin", hash("admin123456"), "系统管理员", "admin");
  const teacherId = db
    .prepare(
      "INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)"
    )
    .run("teacher", hash("teacher123456"), "王老师", "teacher").lastInsertRowid;

  // 班级
  const classNames = [
    { name: "软件工程一班", grade: "2023级", head_teacher: "王老师" },
    { name: "软件工程二班", grade: "2023级", head_teacher: "李老师" },
    { name: "计算机科学一班", grade: "2022级", head_teacher: "张老师" }
  ];
  const classIds = classNames.map((c, idx) => {
    // 仅软件工程一班绑定 teacher 账号（王老师），用于演示教师"仅管本班"数据权限
    const headTeacherId = idx === 0 ? teacherId : null;
    return db
      .prepare(
        "INSERT INTO classes (name, grade, head_teacher, head_teacher_id) VALUES (?, ?, ?, ?)"
      )
      .run(c.name, c.grade, c.head_teacher, headTeacherId).lastInsertRowid;
  });

  // 学生：每班 8~10 名（含家长姓名/电话，家长信息并入学生档案）
  const surnames = ["陈", "刘", "杨", "黄", "周", "吴", "徐", "孙", "马", "朱"];
  const givenNames = [
    "伟",
    "芳",
    "娜",
    "敏",
    "静",
    "磊",
    "军",
    "洋",
    "勇",
    "艳",
    "杰",
    "涛",
    "明",
    "超",
    "秀英"
  ];
  const parentSurnames = [
    "李",
    "张",
    "王",
    "赵",
    "孙",
    "周",
    "吴",
    "郑",
    "冯",
    "陈"
  ];
  let no = 2023001;
  classIds.forEach((cid, ci) => {
    const count = 8 + ci; // 8、9、10
    for (let i = 0; i < count; i++) {
      const gender = i % 2 === 0 ? "男" : "女";
      const name = `${surnames[(ci + i) % surnames.length]}${givenNames[(ci * 3 + i) % givenNames.length]}`;
      db.prepare(
        "INSERT INTO students (student_no, name, gender, phone, email, class_id, status, parent_name, parent_phone) VALUES (?, ?, ?, ?, ?, ?, '在读', ?, ?)"
      ).run(
        String(no++),
        name,
        gender,
        `1380000${String(no).slice(-4)}`,
        `${no}@example.com`,
        cid,
        `${parentSurnames[(ci + i) % parentSurnames.length]}家长`,
        `1390000${String(no).slice(-4)}`
      );
    }
  });

  // 课程
  const courses = [
    { code: "SE101", name: "高等数学", teacher: "李老师" },
    { code: "SE102", name: "数据结构", teacher: "王老师" },
    { code: "SE103", name: "操作系统", teacher: "张老师" },
    { code: "SE104", name: "计算机网络", teacher: "刘老师" },
    { code: "SE105", name: "软件工程导论", teacher: "陈老师" }
  ];
  const courseIds = courses.map(
    c =>
      db
        .prepare("INSERT INTO courses (code, name, teacher) VALUES (?, ?, ?)")
        .run(c.code, c.name, c.teacher).lastInsertRowid
  );

  // 默认学期（当前学期）
  db.prepare(
    "INSERT INTO terms (name, start_date, end_date, is_current) VALUES (?, ?, ?, 1)"
  ).run("2025-2026学年第二学期", today(-60), today(120));

  // 示例考勤：近 5 天，一班 + 课程1
  const students = db
    .prepare("SELECT id FROM students WHERE class_id = ? ORDER BY id")
    .all(classIds[0]);
  const statuses = [
    "正常",
    "正常",
    "正常",
    "迟到",
    "正常",
    "缺勤",
    "正常",
    "请假",
    "正常",
    "正常"
  ];
  for (let day = 4; day >= 0; day--) {
    const date = today(-day);
    students.forEach((s, idx) => {
      db.prepare(
        "INSERT INTO attendances (student_id, course_id, date, status) VALUES (?, ?, ?, ?)"
      ).run(s.id, courseIds[0], date, statuses[idx % statuses.length]);
    });
  }

  // 示例请假：1 条待审批、1 条已通过
  db.prepare(
    "INSERT INTO leaves (student_id, type, reason, start_date, end_date, status) VALUES (?, ?, ?, ?, ?, '待审批')"
  ).run(students[3].id, "病假", "感冒发烧，医院就诊", today(-1), today());
  db.prepare(
    "INSERT INTO leaves (student_id, type, reason, start_date, end_date, status, approved_by, approve_time) VALUES (?, ?, ?, ?, ?, '通过', ?, datetime('now', 'localtime'))"
  ).run(
    students[7].id,
    "事假",
    "家里有事需请假",
    today(-2),
    today(-1),
    teacherId
  );

  console.log("[seed] 种子数据初始化完成");
  console.log(
    "[seed] admin/admin123456（管理员）、teacher/teacher123456（教师）"
  );
}

module.exports = seed;
