/**
 * 演示数据集（全部为虚构数据，仅用于原型走查）
 * 替换为真实数据时，只需改 src/data-source.ts 的适配器实现，本文件可整体删除。
 */

export interface KpNode {
  id: string;
  name: string;
  /** 相对难度系数，用于演示掌握度推算 */
  difficulty: number;
  children?: KpNode[];
}

export interface Student {
  id: number;
  no: string;
  name: string;
  attendance: {
    total: number;
    normal: number;
    late: number;
    early: number;
    absent: number;
    leave: number;
    rate: number;
  };
  exams: { name: string; date: string; score: number; full: number; rate: number }[];
  eval: {
    date: string;
    focus: number;
    participation: number;
    homework: number;
    mastery: number;
    note: string;
  };
  hours: { total: number; remain: number; enrollDate: string };
  /** 知识点掌握度 0-100 */
  kpMastery: Record<string, number>;
  tags: string[];
  avgRate: number;
  trend: number;
}

export const DEMO = { isDemo: true } as const;

export const ORG = {
  name: "启明教育培训中心",
  campus: "总校区",
  term: "2026 秋季学期"
};

export const TEACHER = {
  id: 2,
  name: "王老师",
  role: "teacher" as const,
  subject: "数学",
  subjectFull: "初中数学",
  grade: "八年级",
  title: "数学教研组长"
};

export const COURSE = {
  id: 1,
  name: "初二数学强化班",
  subject: "数学",
  grade: "八年级",
  textbook: "人教版 · 八年级上册",
  schedule: "每周二、周五 18:30–20:00",
  totalHours: 48,
  doneHours: 19
};

export const KLASS = {
  id: 1,
  name: "初二数学强化班 A 班",
  studentCount: 24,
  room: "3 号教室"
};

export const UNIT = {
  id: 12,
  no: "第十二章",
  name: "全等三角形",
  totalHours: 8,
  doneHours: 5,
  current: { no: 6, title: "角平分线的性质", date: "2026-09-11" },
  next: { no: 7, title: "全等三角形的综合应用", date: "2026-09-15" },
  goals: [
    "理解全等三角形的概念，能准确识别对应边与对应角",
    "掌握 SSS / SAS / ASA / AAS / HL 五种判定方法，能按条件选择合适判定",
    "掌握角平分线的性质与判定，能完成基本尺规作图",
    "能通过添加辅助线（倍长中线、截长补短）解决全等证明题"
  ]
};

/** 知识点树（L1） */
export const KNOWLEDGE_TREE: KpNode[] = [
  {
    id: "k1",
    name: "全等三角形的判定",
    difficulty: 0.95,
    children: [
      { id: "k1-1", name: "SSS 边边边", difficulty: 0.95 },
      { id: "k1-2", name: "SAS 边角边", difficulty: 0.9 },
      { id: "k1-3", name: "ASA 角边角", difficulty: 0.92 },
      { id: "k1-4", name: "AAS 角角边", difficulty: 0.85 },
      { id: "k1-5", name: "HL 斜边、直角边", difficulty: 0.9 }
    ]
  },
  {
    id: "k2",
    name: "全等三角形的性质",
    difficulty: 0.95,
    children: [
      { id: "k2-1", name: "对应边相等", difficulty: 0.96 },
      { id: "k2-2", name: "对应角相等", difficulty: 0.95 }
    ]
  },
  {
    id: "k3",
    name: "角平分线",
    difficulty: 0.85,
    children: [
      { id: "k3-1", name: "角平分线上的点到角两边距离相等", difficulty: 0.88 },
      { id: "k3-2", name: "到角两边距离相等的点在角平分线上", difficulty: 0.78 }
    ]
  },
  {
    id: "k4",
    name: "辅助线构造",
    difficulty: 0.62,
    children: [
      { id: "k4-1", name: "倍长中线", difficulty: 0.65 },
      { id: "k4-2", name: "截长补短", difficulty: 0.55 }
    ]
  }
];

export const ALL_KP: { id: string; name: string; difficulty: number; parent: string }[] = [];
for (const g of KNOWLEDGE_TREE) {
  for (const c of g.children || []) {
    ALL_KP.push({ id: c.id, name: c.name, difficulty: c.difficulty, parent: g.name });
  }
}

export const EXAMS = [
  {
    id: 1,
    name: "全等三角形单元小测（一）",
    date: "2026-09-04",
    full: 100,
    kps: ["k1-1", "k1-2", "k1-3", "k2-1"],
    avg: 78.4
  },
  {
    id: 2,
    name: "全等三角形单元小测（二）",
    date: "2026-09-08",
    full: 100,
    kps: ["k1-4", "k1-5", "k3-1", "k2-2"],
    avg: 74.1
  },
  {
    id: 3,
    name: "角平分线专项检测",
    date: "2026-09-11",
    full: 100,
    kps: ["k3-1", "k3-2", "k4-1"],
    avg: 69.8
  }
];

/** 学生原始数据：[学号, 姓名, [总课次, 缺勤, 迟到], [三次得分率], [专注,参与,作业完成,掌握], [总课时,剩余课时], 建档日] */
type Raw = [
  string,
  string,
  [number, number, number],
  [number, number, number],
  [number, number, number, number],
  [number, number],
  string
];

const RAW_STUDENTS: Raw[] = [
  ["2501", "陈嘉禾", [24, 0, 1], [88, 91, 93], [5, 4, 5, 5], [48, 29], "2026-03-02"],
  ["2502", "林予安", [24, 0, 0], [95, 96, 97], [5, 5, 5, 5], [48, 31], "2026-03-02"],
  ["2503", "周景行", [24, 0, 2], [82, 85, 88], [4, 4, 4, 4], [48, 24], "2026-03-02"],
  ["2504", "苏砚清", [23, 0, 1], [76, 79, 83], [4, 4, 4, 4], [48, 26], "2026-03-05"],
  ["2505", "何思远", [24, 1, 3], [71, 68, 74], [3, 4, 3, 3], [48, 18], "2026-03-05"],
  ["2506", "许知微", [24, 0, 0], [90, 92, 94], [5, 5, 5, 5], [48, 33], "2026-03-05"],
  ["2507", "郑一鸣", [22, 2, 4], [68, 63, 59], [3, 3, 2, 3], [48, 12], "2026-03-09"],
  ["2508", "吴清和", [24, 0, 1], [84, 86, 89], [4, 5, 4, 4], [48, 27], "2026-03-09"],
  ["2509", "沈亦然", [23, 1, 0], [79, 83, 86], [4, 4, 4, 4], [48, 22], "2026-03-09"],
  ["2510", "唐若川", [24, 0, 2], [73, 76, 81], [4, 3, 4, 4], [48, 25], "2026-03-12"],
  ["2511", "白栖迟", [24, 0, 0], [92, 90, 95], [5, 4, 5, 5], [48, 30], "2026-03-12"],
  ["2512", "顾泊舟", [21, 3, 5], [64, 58, 52], [2, 3, 2, 2], [48, 8], "2026-03-12"],
  ["2513", "叶书宁", [24, 0, 1], [86, 88, 90], [5, 4, 4, 4], [48, 28], "2026-03-16"],
  ["2514", "孟星野", [24, 0, 2], [77, 74, 79], [4, 4, 3, 3], [48, 20], "2026-03-16"],
  ["2515", "梁砚书", [24, 0, 0], [81, 84, 87], [4, 4, 4, 4], [48, 26], "2026-03-16"],
  ["2516", "谢念安", [23, 1, 1], [69, 72, 77], [3, 4, 4, 3], [48, 19], "2026-03-19"],
  ["2517", "钟屿澄", [24, 0, 0], [93, 94, 96], [5, 5, 5, 5], [48, 32], "2026-03-19"],
  ["2518", "范叙白", [24, 0, 3], [75, 78, 76], [4, 3, 4, 4], [48, 23], "2026-03-23"],
  ["2519", "夏听澜", [22, 1, 2], [66, 69, 73], [3, 4, 3, 3], [48, 16], "2026-03-23"],
  ["2520", "钱与之", [24, 0, 1], [87, 89, 91], [5, 4, 5, 4], [48, 27], "2026-03-26"],
  ["2521", "崔明煦", [24, 0, 2], [80, 77, 82], [4, 4, 4, 4], [48, 21], "2026-03-26"],
  ["2522", "陆允初", [24, 0, 0], [89, 87, 92], [4, 5, 5, 5], [48, 29], "2026-03-30"],
  ["2523", "岑昭华", [23, 1, 3], [72, 70, 68], [3, 3, 3, 3], [48, 14], "2026-03-30"],
  ["2524", "宋柏言", [24, 0, 1], [83, 81, 85], [4, 4, 4, 4], [48, 24], "2026-04-02"]
];

/** 确定性伪随机：同一 (学生, 知识点) 每次结果一致 */
function noise(seed: number, key: string): number {
  let h = seed * 2654435761;
  for (let i = 0; i < key.length; i++) h = (h ^ key.charCodeAt(i)) * 16777619;
  return ((h >>> 0) % 1000) / 1000;
}

function buildStudents(): Student[] {
  return RAW_STUDENTS.map((r, idx) => {
    const [no, name, att, scores, ev, hours, enroll] = r;
    const id = 300 + idx;
    const [total, absent, late] = att;
    const early = 0;
    const leave = 0;
    const normal = total - absent - late;

    const exams = scores.map((s, i) => ({
      name: EXAMS[i].name,
      date: EXAMS[i].date,
      score: s,
      full: 100,
      rate: s
    }));

    const avgRate = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
    const trend = Math.round((scores[2] - scores[0]) * 10) / 10;

    const kpMastery: Record<string, number> = {};
    for (const kp of ALL_KP) {
      const base = avgRate * kp.difficulty;
      const jitter = (noise(id, kp.id) - 0.5) * 14;
      kpMastery[kp.id] = Math.max(8, Math.min(100, Math.round(base + jitter)));
    }

    const tags: string[] = [];
    if (absent >= 2) tags.push("连续缺勤");
    if (trend <= -8) tags.push("成绩下滑");
    if (hours[1] <= 12) tags.push("课时将尽");
    if (avgRate >= 90 && absent === 0) tags.push("表现优异");
    if (trend >= 8) tags.push("进步明显");

    const notes = [
      "课堂专注度较好，能主动举手回答问题。",
      "参与度不错，但解题书写过程仍需规范。",
      "课堂表现稳定，作业完成认真。",
      "听讲认真，遇到难点愿意追问。",
      "练习速度偏慢，需要更多时间保障。",
      "课堂活跃，能带动小组讨论。",
      "近期状态有所波动，需要多关注。"
    ];

    return {
      id,
      no,
      name,
      attendance: {
        total,
        normal,
        late,
        early,
        absent,
        leave,
        rate: Math.round(((total - absent) / total) * 1000) / 10
      },
      exams,
      eval: {
        date: "2026-09-11",
        focus: ev[0],
        participation: ev[1],
        homework: ev[2],
        mastery: ev[3],
        note: notes[idx % notes.length]
      },
      hours: { total: hours[0], remain: hours[1], enrollDate: enroll },
      kpMastery,
      tags,
      avgRate,
      trend
    };
  });
}

export const STUDENTS: Student[] = buildStudents();

/** 课堂记录（最近 3 次课） */
export const CLASS_RECORDS = [
  {
    id: 1,
    date: "2026-09-04",
    lesson: "第 3 课时 · 三角形全等的判定（SAS）",
    present: 24,
    absent: 0,
    summary: "通过两个三角形叠合演示引入 SAS，学生接受度高；课堂练习 6 题，全班正确率 81%。",
    issues: ["部分学生对\"夹角\"位置判断出错，共 5 人"],
    followUps: ["下次课开场用 3 分钟对比\"两边及夹角\"与\"两边及其中一边对角\""]
  },
  {
    id: 2,
    date: "2026-09-08",
    lesson: "第 4 课时 · 判定方法辨析（ASA / AAS）",
    present: 23,
    absent: 1,
    summary: "ASA 与 AAS 的区分是本节难点，用了两组对比图；当堂小测平均 74.1 分。",
    issues: ["ASA 与 AAS 混用，出错集中在 7 人", "书写证明时跳步，缺少\"在△…和△…中\"的格式"],
    followUps: ["专门安排一次证明格式训练", "对 7 人做一对一批注"]
  },
  {
    id: 3,
    date: "2026-09-11",
    lesson: "第 6 课时 · 角平分线的性质",
    present: 22,
    absent: 2,
    summary: "性质定理推导顺利，但应用到证明题时，学生想不到用\"距离\"作为桥梁。专项检测平均 69.8 分。",
    issues: [
      "角平分线性质的应用题失分最重，全班得分率 61%",
      "\"到两边距离相等\"反向判定掌握不足",
      "倍长中线辅助线几乎无人主动使用"
    ],
    followUps: [
      "下节课开场补一道角平分线性质的变式练习",
      "把倍长中线拆成\"三步走\"口诀，配 2 道模板题"
    ]
  }
];

/** 作业记录 */
export const HOMEWORK_LIST = [
  {
    id: 1,
    title: "第 3 次作业 · 全等判定综合",
    date: "2026-09-08",
    assigned: 24,
    submitted: 23,
    missing: ["2512"],
    avgScore: 76.5,
    fullScore: 100,
    typicalErrors: [
      { kp: "k1-4", desc: "AAS 与 ASA 混用", count: 7 },
      { kp: "k1-2", desc: "SAS 中\"夹角\"判断错误", count: 5 },
      { kp: "k4-2", desc: "不会添加辅助线，直接放弃", count: 9 }
    ],
    comments: "整体完成质量中等，第 5、6 题失分集中，需要在课堂上讲评。"
  },
  {
    id: 2,
    title: "第 4 次作业 · 角平分线专项",
    date: "2026-09-11",
    assigned: 24,
    submitted: 22,
    missing: ["2507", "2512"],
    avgScore: 68.2,
    fullScore: 100,
    typicalErrors: [
      { kp: "k3-2", desc: "反向判定条件写不全", count: 11 },
      { kp: "k3-1", desc: "忘记作垂线，直接用斜线段", count: 8 },
      { kp: "k4-1", desc: "倍长中线思路缺失", count: 14 }
    ],
    comments: "角平分线性质的\"反向使用\"是全班共性薄弱点，建议下次课专门复教。"
  }
];

/** 教材与资料（L3） */
export const MATERIALS = [
  {
    id: 1,
    title: "人教版八年级上册 · 第十二章 全等三角形（教师用书节选）",
    type: "PDF",
    size: "2.4 MB",
    uploadedBy: "王老师",
    uploadedAt: "2026-08-28",
    kps: ["k1", "k2", "k3"],
    status: "已入库"
  },
  {
    id: 2,
    title: "全等三角形判定方法对比表（自制讲义）",
    type: "DOCX",
    size: "186 KB",
    uploadedBy: "王老师",
    uploadedAt: "2026-09-01",
    kps: ["k1-1", "k1-2", "k1-3", "k1-4", "k1-5"],
    status: "已入库"
  },
  {
    id: 3,
    title: "角平分线性质 · 课堂练习单",
    type: "PDF",
    size: "512 KB",
    uploadedBy: "王老师",
    uploadedAt: "2026-09-10",
    kps: ["k3-1", "k3-2"],
    status: "已入库"
  },
  {
    id: 4,
    title: "辅助线构造专题（倍长中线 / 截长补短）",
    type: "PDF",
    size: "1.1 MB",
    uploadedBy: "李老师",
    uploadedAt: "2026-09-12",
    kps: ["k4-1", "k4-2"],
    status: "待解析"
  }
];

/** 单元目标落实情况（用于首页进度） */
export const UNIT_PROGRESS = [
  { goal: "识别对应边与对应角", status: "已达成", evidence: "小测（一）相关题得分率 92%" },
  { goal: "五种判定方法的选择", status: "基本达成", evidence: "小测（二）得分率 78%，AAS/ASA 混用较多" },
  { goal: "角平分线性质与判定", status: "需复教", evidence: "专项检测得分率 61%，反向判定薄弱" },
  { goal: "辅助线构造解决证明题", status: "未开始", evidence: "第 7 课时内容" }
];

/* ─────────────────────── 成长路径演示数据（demo 模式） ───────────────────────
   为什么需要：成长路径页在真实模式下才有数据，而 demo 模式下整页空白 ——
   第一次打开的人（或拿去给老师看时）完全看不出这个功能长什么样。
   这里给一份虚构的成长轨迹，让页面在任何环境下都完整可见、可讲清楚。

   注意：demo 数据只用于走查界面，**demo 模式下采集动作不会落库**
   （Teaching.vue 里有明确分支与标注）。 */

/** 整班课堂表现曲线（每次课一个点） */
export const DEMO_CLASS_EVAL_SERIES = [
  { eval_date: "2026-07-05", n: 24, focus: 3.6, participation: 3.5, mastery: 3.2 },
  { eval_date: "2026-07-09", n: 24, focus: 3.7, participation: 3.6, mastery: 3.3 },
  { eval_date: "2026-07-13", n: 23, focus: 3.9, participation: 3.8, mastery: 3.4 },
  { eval_date: "2026-07-17", n: 24, focus: 4.0, participation: 3.9, mastery: 3.6 },
  { eval_date: "2026-07-22", n: 24, focus: 4.1, participation: 4.0, mastery: 3.7 },
  { eval_date: "2026-08-05", n: 24, focus: 4.2, participation: 4.1, mastery: 3.9 },
  { eval_date: "2026-08-09", n: 23, focus: 4.2, participation: 4.2, mastery: 4.0 },
  { eval_date: "2026-08-13", n: 24, focus: 4.3, participation: 4.2, mastery: 4.0 },
  { eval_date: "2026-08-19", n: 24, focus: 4.3, participation: 4.1, mastery: 4.1 },
  { eval_date: "2026-09-06", n: 24, focus: 4.4, participation: 4.3, mastery: 4.2 },
  { eval_date: "2026-09-11", n: 24, focus: 4.4, participation: 4.4, mastery: 4.3 },
  { eval_date: "2026-09-17", n: 24, focus: 4.5, participation: 4.4, mastery: 4.4 }
];

/** 整班知识点掌握度 */
export const DEMO_CLASS_KP = [
  { kpId: 1, code: "12-1", name: "全等图形与对应关系", unitNo: 12, seq: 1, assessed: 24, mastered: 23, masteryRate: 95.8 },
  { kpId: 2, code: "12-2", name: "SSS 判定", unitNo: 12, seq: 2, assessed: 24, mastered: 22, masteryRate: 91.7 },
  { kpId: 3, code: "12-3", name: "SAS 判定", unitNo: 12, seq: 3, assessed: 24, mastered: 20, masteryRate: 83.3 },
  { kpId: 4, code: "12-4", name: "ASA 与 AAS 判定", unitNo: 12, seq: 4, assessed: 24, mastered: 17, masteryRate: 70.8 },
  { kpId: 5, code: "12-5", name: "HL 判定（直角三角形）", unitNo: 12, seq: 5, assessed: 24, mastered: 19, masteryRate: 79.2 },
  { kpId: 6, code: "12-6", name: "角平分线的性质", unitNo: 12, seq: 6, assessed: 24, mastered: 16, masteryRate: 66.7 },
  { kpId: 7, code: "12-7", name: "角平分线的判定（反向）", unitNo: 12, seq: 7, assessed: 24, mastered: 13, masteryRate: 54.2 },
  { kpId: 8, code: "12-8", name: "线段垂直平分线", unitNo: 12, seq: 8, assessed: 22, mastered: 15, masteryRate: 68.2 },
  { kpId: 9, code: "13-1", name: "等腰三角形性质", unitNo: 13, seq: 1, assessed: 16, mastered: 12, masteryRate: 75.0 },
  { kpId: 10, code: "13-2", name: "倍长中线法", unitNo: 13, seq: 2, assessed: 12, mastered: 5, masteryRate: 41.7 }
];

/**
 * 采集页的可评定知识点（演示用）。
 *
 * **与真实库同构**：只列叶子知识点（可打勾对象），单元名放在 unit_name 里
 * —— 真实 `/api/growth/eval-form` 也是这个形状（单元节点被后端过滤掉，
 * 只把单元名带下来做分组标题）。
 *
 * 编号体系说明：本节用 `U1-x / U2-x / U3-x`（三个单元），
 * 与上面 `DEMO_CLASS_KP` 的 `12-x / 13-x`（章节号）**不统一，这是故意的** ——
 * 两者服务于不同演示场景（前者=采集打勾，后者=掌握度排行），
 * 且真实机构的教材章节号本来就与"单元序号"不同。
 * 若要统一，请连真实 `knowledge_points` 的口径一起改，不要只改这里。
 */
export const DEMO_KP_FORM = [
  { id: 1, code: "U1-1", name: "全等图形与对应关系", unit_no: 1, unit_name: "第一单元 · 全等三角形", seq: 1, difficulty: 1 },
  { id: 2, code: "U1-2", name: "SSS 判定", unit_no: 1, unit_name: "第一单元 · 全等三角形", seq: 2, difficulty: 2 },
  { id: 3, code: "U1-3", name: "SAS 判定", unit_no: 1, unit_name: "第一单元 · 全等三角形", seq: 3, difficulty: 3 },
  { id: 4, code: "U1-4", name: "ASA 与 AAS 判定", unit_no: 1, unit_name: "第一单元 · 全等三角形", seq: 4, difficulty: 3 },
  { id: 5, code: "U2-1", name: "角平分线的性质", unit_no: 2, unit_name: "第二单元 · 角平分线与垂直平分线", seq: 5, difficulty: 2 },
  { id: 6, code: "U2-2", name: "垂直平分线", unit_no: 2, unit_name: "第二单元 · 角平分线与垂直平分线", seq: 6, difficulty: 2 },
  { id: 7, code: "U2-3", name: "尺规作图", unit_no: 2, unit_name: "第二单元 · 角平分线与垂直平分线", seq: 7, difficulty: 3 },
  { id: 8, code: "U3-1", name: "等腰三角形的性质", unit_no: 3, unit_name: "第三单元 · 等腰三角形", seq: 8, difficulty: 2 },
  { id: 9, code: "U3-2", name: "等边三角形", unit_no: 3, unit_name: "第三单元 · 等腰三角形", seq: 9, difficulty: 2 },
  { id: 10, code: "U3-3", name: "含 30° 角的直角三角形", unit_no: 3, unit_name: "第三单元 · 等腰三角形", seq: 10, difficulty: 4 }
];

/** 单学员成长画像（演示：以「陈嘉禾」为样本，体现一个从弱到强的上升轨迹） */
export const DEMO_STUDENT_GROWTH = {
  attendance: { attended: 23, absent: 1, leave: 0, rate: 95.8 },
  evalTrend: DEMO_CLASS_EVAL_SERIES.map((r, i) => ({
    // 该学员起点低于班级均值，逐步追平并反超 —— 这正是「从 0 到成功」的演示意图
    date: r.eval_date,
    focus: Math.min(5, Math.round((r.focus - 0.9 + i * 0.11) * 10) / 10),
    participation: Math.min(5, Math.round((r.participation - 1.0 + i * 0.12) * 10) / 10),
    mastery: Math.min(5, Math.round((r.mastery - 1.2 + i * 0.14) * 10) / 10)
  })),
  examSeries: [
    { date: "2026-07-12", name: "入学摸底", rate: 58 },
    { date: "2026-07-24", name: "小测（一）", rate: 66 },
    { date: "2026-08-14", name: "小测（二）", rate: 74 },
    { date: "2026-09-04", name: "阶段检测", rate: 83 },
    { date: "2026-09-11", name: "专项检测", rate: 88 }
  ],
  kpProgress: [
    { kpId: 1, name: "全等图形与对应关系", from: "部分掌握", to: "已掌握", fromDate: "2026-07-05", toDate: "2026-07-22", delta: 1, attempts: 6, jumps: [{ date: "2026-07-22", from: "部分掌握", to: "已掌握" }] },
    { kpId: 2, name: "SSS 判定", from: "部分掌握", to: "已掌握", fromDate: "2026-07-05", toDate: "2026-08-05", delta: 1, attempts: 8, jumps: [{ date: "2026-08-05", from: "部分掌握", to: "已掌握" }] },
    { kpId: 3, name: "SAS 判定", from: "未掌握", to: "已掌握", fromDate: "2026-07-09", toDate: "2026-08-19", delta: 2, attempts: 9, jumps: [{ date: "2026-07-22", from: "未掌握", to: "部分掌握" }, { date: "2026-08-19", from: "部分掌握", to: "已掌握" }] },
    { kpId: 4, name: "ASA 与 AAS 判定", from: "未掌握", to: "已掌握", fromDate: "2026-07-13", toDate: "2026-09-06", delta: 2, attempts: 10, jumps: [{ date: "2026-08-05", from: "未掌握", to: "部分掌握" }, { date: "2026-09-06", from: "部分掌握", to: "已掌握" }] },
    { kpId: 6, name: "角平分线的性质", from: "未掌握", to: "部分掌握", fromDate: "2026-08-09", toDate: "2026-09-17", delta: 1, attempts: 7, jumps: [{ date: "2026-09-17", from: "未掌握", to: "部分掌握" }] },
    { kpId: 7, name: "角平分线的判定（反向）", from: "未掌握", to: "未掌握", fromDate: "2026-08-19", toDate: "2026-09-17", delta: 0, attempts: 4, jumps: [] },
    { kpId: 10, name: "倍长中线法", from: "未掌握", to: "部分掌握", fromDate: "2026-09-06", toDate: "2026-09-17", delta: 1, attempts: 3, jumps: [{ date: "2026-09-17", from: "未掌握", to: "部分掌握" }] }
  ],
  milestones: [
    { date: "2026-07-22", title: "全等图形与对应关系 由「部分掌握」提升至「已掌握」", kind: "kp_progress" },
    { date: "2026-07-22", title: "SAS 判定 由「未掌握」提升至「部分掌握」", kind: "kp_progress" },
    { date: "2026-07-28", title: "连续 4 次课全勤且按时到课", kind: "attendance_streak" },
    { date: "2026-08-05", title: "SSS 判定 由「部分掌握」提升至「已掌握」", kind: "kp_progress" },
    { date: "2026-08-19", title: "SAS 判定 由「部分掌握」提升至「已掌握」", kind: "kp_progress" },
    { date: "2026-09-06", title: "ASA 与 AAS 判定 由「部分掌握」提升至「已掌握」", kind: "kp_progress" },
    { date: "2026-09-17", title: "倍长中线法 由「未掌握」提升至「部分掌握」", kind: "kp_progress" }
  ],
  breakdown: { attendance: 24, exam: 5, classEval: 12, kpAssessment: 47, total: 88 },
  eventCount: 88
};

/** 单学员时间轴（演示，最近若干条） */
export const DEMO_STUDENT_TIMELINE = [
  { type: "class_eval", label: "课堂表现", date: "2026-07-05", summary: "专注 3 · 参与 3 · 掌握 2 · 对应关系找不准，需提示" },
  { type: "kp_assessment", label: "知识点掌握", date: "2026-07-05", summary: "全等图形与对应关系：部分掌握" },
  { type: "exam_score", label: "成绩", date: "2026-07-12", summary: "入学摸底 58/100（58%）" },
  { type: "class_eval", label: "课堂表现", date: "2026-07-13", summary: "专注 3 · 参与 3 · 掌握 3 · 开始能自己找对应角" },
  { type: "kp_assessment", label: "知识点掌握", date: "2026-07-22", summary: "全等图形与对应关系：已掌握（部分掌握 → 已掌握）" },
  { type: "attendance", label: "出勤", date: "2026-07-28", summary: "正常" },
  { type: "milestone", label: "成长里程碑", date: "2026-07-28", summary: "连续 4 次课全勤且按时到课" },
  { type: "kp_assessment", label: "知识点掌握", date: "2026-08-05", summary: "SSS 判定：已掌握（部分掌握 → 已掌握）" },
  { type: "exam_score", label: "成绩", date: "2026-08-14", summary: "小测（二）74/100（74%）" },
  { type: "kp_assessment", label: "知识点掌握", date: "2026-08-19", summary: "SAS 判定：已掌握（部分掌握 → 已掌握）" },
  { type: "class_eval", label: "课堂表现", date: "2026-09-06", summary: "专注 4 · 参与 4 · 掌握 4 · 主动上黑板讲辅助线思路" },
  { type: "kp_assessment", label: "知识点掌握", date: "2026-09-06", summary: "ASA 与 AAS 判定：已掌握（部分掌握 → 已掌握）" },
  { type: "exam_score", label: "成绩", date: "2026-09-11", summary: "专项检测 88/100（88%）" },
  { type: "kp_assessment", label: "知识点掌握", date: "2026-09-17", summary: "倍长中线法：部分掌握（未掌握 → 部分掌握）" }
];
