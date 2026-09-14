/**
 * 规则引擎模板（未配置模型或调用失败时的降级路径）
 * 输入：由 generators 组装好的本地指标；输出：结构化段落。
 * 所有数字均来自本地指标引擎，模板只负责组织语言。
 */

export interface Section {
  title: string;
  body: string;
}

const pct = (n: number) => `${Number(n).toFixed(1)}%`;

function list(items: string[]): string {
  return items.map((t, i) => `${i + 1}. ${t}`).join("\n");
}

function bullets(items: string[]): string {
  return items.map(t => `· ${t}`).join("\n");
}

/** 课程设计 */
export function courseDesign(d: any): Section[] {
  const { course, unit, goals, weakKps, examAvg } = d;
  return [
    {
      title: "单元定位",
      body: `${course.textbook} · ${unit.no}${unit.name}，共 ${unit.totalHours} 课时，当前已完成 ${unit.doneHours} 课时。\n本单元是初中几何推理的起点，后续「轴对称」「四边形」的证明都依赖这里的判定与性质。`
    },
    {
      title: "学段与课标对应",
      body: bullets([
        "掌握基本事实：两边及其夹角分别相等的两个三角形全等",
        "掌握判定定理：SSS、ASA、AAS、HL",
        "能利用全等证明线段相等、角相等，并解决简单的实际问题",
        "经历观察—猜想—验证的过程，发展推理能力与几何直观"
      ])
    },
    {
      title: "单元目标（可观测）",
      body: list(goals)
    },
    {
      title: "课时结构",
      body: bullets([
        "① 全等图形与对应元素（1 课时）",
        "② 判定方法 SSS / SAS（1 课时）",
        "③ 判定方法 ASA / AAS（1 课时）",
        "④ 判定方法 HL 与判定辨析（1 课时）",
        "⑤ 角平分线的性质与判定（2 课时）",
        "⑥ 综合应用与辅助线（2 课时）"
      ])
    },
    {
      title: "学情基线（本地指标）",
      body: bullets([
        `本单元三次检测平均得分率 ${pct(examAvg)}`,
        `当前最薄弱知识点：${weakKps.map((k: any) => `${k.name}（${pct(k.value)}）`).join("、")}`,
        "结论：判定方法本身掌握可接受，失分集中在「性质的反向应用」与「辅助线构造」"
      ])
    },
    {
      title: "设计建议",
      body: bullets([
        "把「辅助线构造」单独拆成 2 课时，并配模板题，不与其他内容混讲",
        "每课时固定 5 分钟「证明书写格式」训练，纠正跳步习惯",
        "角平分线性质与判定成对教学，用同一组图形正反各用一次"
      ])
    }
  ];
}

/** 备课方案 */
export function lessonPlan(d: any): Section[] {
  const { unit, lesson, className, weakKps, focusStudents } = d;
  return [
    {
      title: "本课定位",
      body: `第 ${lesson.no} 课时 · ${lesson.title}（${unit.no}${unit.name}，${lesson.date} 上课，${className}）`
    },
    {
      title: "教学目标",
      body: bullets([
        "能说出角平分线性质定理的条件与结论，并区分「性质」与「判定」的使用场景",
        "能在证明题中主动作垂线，构造「点到直线的距离」",
        "能识别需要倍长中线的题目特征，并写出第一步辅助线作法"
      ])
    },
    {
      title: "教学重难点",
      body: bullets([
        "重点：性质定理的应用（作垂线 → 得相等线段）",
        `难点：反向判定与辅助线。依据本节课前测，${weakKps.map((k: any) => k.name).join("、")} 掌握度偏低`,
        "易错点：把「距离」写成斜线段；反向判定条件漏写「在角的内部」"
      ])
    },
    {
      title: "教学流程（45 分钟）",
      body: bullets([
        "0–5 分钟｜错题回顾：投影上次作业失分最集中的一题，只讲「错在哪一步」",
        "5–15 分钟｜性质再认识：用同一图形正用一次、反用一次，强调条件的不可省略",
        "15–30 分钟｜变式练习：3 道递进题（直接套用 → 需要作垂线 → 需要先证角相等）",
        "30–40 分钟｜辅助线入门：倍长中线「三步走」——延长、连接、找全等",
        "40–45 分钟｜小结与作业布置：让学生自己说出「什么信号提示我要作辅助线」"
      ])
    },
    {
      title: "课堂提问设计",
      body: bullets([
        "「题目给了角平分线，你为什么想到要作垂线？」（指向性质的使用条件）",
        "「这个结论反过来还成立吗？如果成立，条件够不够？」（指向反向判定）",
        "「图里有中线，你会怎么处理？」（指向辅助线触发信号）"
      ])
    },
    {
      title: "分层任务",
      body: bullets([
        "A 组（基础）：「角平分线 + 垂直」直接应用，2 题",
        "B 组（多数）：需要自己作垂线的证明题，2 题",
        "C 组（拓展）：含倍长中线的综合题，1 题"
      ])
    },
    {
      title: "需要关注的学生",
      body: focusStudents.length
        ? bullets(focusStudents.map((s: any) => `${s.name}（${s.reason}）`))
        : "本次无需特别标注"
    },
    {
      title: "板书设计",
      body: "左栏：性质定理（条件 / 结论 / 图形）\n中栏：例题证明过程（完整书写格式示范）\n右栏：易错提醒（距离必须是垂线段；反向判定要写「在角的内部」）"
    }
  ];
}

/** 授课流程 */
export function teachingFlow(d: any): Section[] {
  const { unit, lesson } = d;
  return [
    {
      title: "课前 2 分钟",
      body: bullets(["打开本课环节卡", "确认到课名单与请假情况", "准备投影的两道错题"])
    },
    {
      title: "环节卡",
      body: bullets([
        "环节 1｜错题回顾（5 分钟）— 目标：把注意力拉回上次失分点",
        "环节 2｜性质再认识（10 分钟）— 目标：说清条件与结论",
        "环节 3｜变式练习（15 分钟）— 目标：能在新情境中主动作垂线",
        "环节 4｜辅助线入门（10 分钟）— 目标：记住倍长中线三步",
        "环节 5｜小结与布置（5 分钟）— 目标：学生能复述触发信号"
      ])
    },
    {
      title: "课堂快捷工具",
      body: bullets([
        "倒计时：环节 3 用 12 分钟计时",
        "随机点名：用于环节 5 的复述检查",
        "快速标记：典型问题 / 关注学生 / 本课调整"
      ])
    },
    {
      title: "本课观察重点",
      body: bullets([
        "有多少学生能主动作垂线（预计不足一半，需重点观察）",
        "证明书写是否出现跳步",
        `本节课归属：${unit.no}${unit.name} · 第 ${lesson.no} 课时`
      ])
    }
  ];
}

/** 作业设计 */
export function homeworkDesign(d: any): Section[] {
  const { unit, lesson, weakKps, errorRank, questionPool } = d;
  return [
    {
      title: "作业定位",
      body: `${unit.no}${unit.name} · 第 ${lesson.no} 课时配套作业｜建议 25 分钟内完成`
    },
    {
      title: "设计依据（来自本地统计）",
      body: bullets([
        `薄弱知识点：${weakKps.map((k: any) => `${k.name}（掌握度 ${pct(k.value)}）`).join("、")}`,
        `高频错因：${errorRank.slice(0, 3).map((e: any) => `${e.desc}（${e.count} 人次）`).join("、")}`,
        `题库可用题量：${questionPool.available} 题（已启用 ${questionPool.enabled} 题）`
      ])
    },
    {
      title: "题量与配比",
      body: bullets([
        "基础巩固 4 题｜对应已掌握知识点，保证完成信心",
        "针对性训练 3 题｜对应最高频错因，必须做",
        "拓展提高 1 题｜辅助线构造，标「选做」"
      ])
    },
    {
      title: "分层方案",
      body: bullets([
        "A 组（掌握度 < 60）：只做基础巩固 4 题 + 针对性训练前 2 题",
        "B 组（60–85）：全部必做，拓展题选做",
        "C 组（> 85）：跳过基础题，直接做针对性训练 + 拓展题，并补 1 道变式"
      ])
    },
    {
      title: "作业要求",
      body: bullets([
        "证明题必须写出「在△…和△…中」的完整格式",
        "辅助线要写明作法（如「延长 AD 到 E，使 DE=AD」）",
        "做完后对照课本页脚自查清单自评一次"
      ])
    }
  ];
}

/** 作业检查与评价 */
export function gradingFeedback(d: any): Section[] {
  const { hw, errorRank, className, submitRate, supportList } = d;
  return [
    {
      title: "批改概况",
      body: bullets([
        `${hw.title}｜应收 ${hw.assigned} 份，实收 ${hw.submitted} 份，提交率 ${pct(submitRate)}`,
        `平均分 ${hw.avgScore} / ${hw.fullScore}，未提交：${hw.missing.join("、") || "无"}`
      ])
    },
    {
      title: "共性错误（按人次排序）",
      body: errorRank.length
        ? bullets(errorRank.map((e: any) => `${e.desc}　${e.count} 人次　→ 建议：${suggestFor(e.kp)}`))
        : "本次作业未发现集中性问题"
    },
    {
      title: "需要单独反馈的学生",
      body: supportList.length
        ? bullets(supportList.map((s: any) => `${s.name}：${s.reason}　建议动作：${s.action}`))
        : "本次无需单独反馈"
    },
    {
      title: "批语模板（可直接套用）",
      body: bullets([
        "书写规范类：「证明过程请补上『在△…和△…中』，这三行是得分点。」",
        "思路类：「辅助线想不出来时，先问自己：题目要我证哪两条线段相等？」",
        "鼓励类：「这次基础题全对，说明判定方法已经稳了，下次挑战拓展题。」"
      ])
    },
    {
      title: "复教建议",
      body: "下一课开场用 5 分钟专讲最高频错因，不讲新题；把错因对应的 2 道变式题放进课堂练习。"
    }
  ];
}

function suggestFor(kp: string): string {
  const map: Record<string, string> = {
    "k1-4": "用两组图对比 ASA 与 AAS 的边角位置",
    "k1-2": "强调「夹角」必须在两条已知边之间",
    "k3-2": "反向判定要补「在角的内部」这个条件",
    "k3-1": "提醒距离必须是垂线段",
    "k4-1": "把倍长中线拆成三步，配模板题",
    "k4-2": "遇到「线段和」结论优先想截长补短"
  };
  return map[kp] ?? "安排一道同类变式题强化";
}

/** 单学员学情解读 */
export function studentInsight(d: any): Section[] {
  const { student, latest, gapToClass, kpWeak, className } = d;
  const dir = gapToClass >= 0 ? "高于" : "低于";
  return [
    {
      title: "总体判断",
      body: `${student.name} 最近一次「${latest.name}」得分率 ${pct(latest.rate)}，${dir}班级平均 ${pct(Math.abs(gapToClass))} 个百分点；近三次成绩 ${student.exams.map((e: any) => e.rate).join(" → ")}，变化 ${student.trend >= 0 ? "+" : ""}${student.trend}。出勤 ${pct(student.attendance.rate)}（缺勤 ${student.attendance.absent} 次）。`
    },
    {
      title: "薄弱知识点（含班内对比）",
      body: bullets(
        kpWeak.map(
          (k: any) => `${k.name}：本人 ${pct(k.value)}，班级平均 ${pct(k.classValue)}`
        )
      )
    },
    {
      title: "可执行建议",
      body: bullets(
        buildStudentActions(student, kpWeak).map(
          (a, i) => `${i + 1}. ${a}`
        )
      )
    },
    {
      title: "依据说明",
      body: `以上判断依据：${className} 的考勤记录、近三次检测成绩、课堂评价记录。数据不足时不做趋势结论。`
    }
  ];
}

function buildStudentActions(student: any, kpWeak: any[]): string[] {
  const acts: string[] = [];
  const weakest = kpWeak[0];
  if (weakest) {
    acts.push(
      `优先补「${weakest.name}」，用 2 道模板题 + 1 道变式，做完当堂面批`
    );
  }
  if (student.trend <= -8) {
    acts.push("成绩连续下滑，本周内单独沟通一次，确认是内容难度还是状态问题");
  }
  if (student.attendance.absent >= 2) {
    acts.push(
      `近期缺勤 ${student.attendance.absent} 次，先与家长确认原因，并把缺课内容安排一次补课`
    );
  }
  if (student.tags.includes("课时将尽")) {
    acts.push(
      `剩余课时 ${student.hours.remain}，按当前节奏约可上 ${Math.floor(
        student.hours.remain / 2
      )} 周，需提前与教务同步续课安排`
    );
  }
  if (student.avgRate >= 88) {
    acts.push("基础已稳，可给拓展题（含辅助线综合），避免重复刷基础题");
  }
  if (acts.length === 0) {
    acts.push("保持现有节奏，每两次课做一次错题回顾即可");
  }
  return acts;
}

/** 班级学情诊断 */
export function classDiagnosis(d: any): Section[] {
  const { className, overview, weakKps, errorRank, supportList, topList, outliers } = d;
  return [
    {
      title: "班级总体",
      body: bullets([
        `在班 ${overview.studentCount} 人｜出勤率 ${pct(overview.attendanceRate)}｜最近检测平均得分率 ${pct(overview.avgScoreRate)}｜优秀率 ${pct(overview.excellentRate)}`,
        `作业提交率 ${pct(overview.homeworkSubmitRate)}｜近三次平均变化 ${overview.avgTrend >= 0 ? "+" : ""}${overview.avgTrend}`
      ])
    },
    {
      title: "共性问题（按弱到强）",
      body: bullets(
        weakKps.slice(0, 4).map((k: any) => `${k.name}：班级平均掌握度 ${pct(k.value)}`)
      )
    },
    {
      title: "错因归集",
      body: errorRank.length
        ? bullets(errorRank.slice(0, 5).map((e: any) => `${e.desc}　${e.count} 人次`))
        : "暂无集中错因"
    },
    {
      title: "离群检测（同班 Z-score）",
      body: outliers.length
        ? bullets(
            outliers.map(
              (o: any) =>
                `${o.name}：最近得分率 ${pct(o.rate)}，Z = ${o.z}（${o.z < 0 ? "显著偏低" : "显著偏高"}）`
            )
          )
        : "本次未发现显著离群"
    },
    {
      title: "下一阶段教学动作",
      body: bullets([
        "把最弱知识点安排在最近一次课的前 15 分钟复教",
        "对需要支持的学生做一对一错题面批（名单见下）",
        "拓展题只发给可以拓展的学生，避免全班统一加量"
      ])
    },
    {
      title: "名单",
      body: bullets([
        `需要支持（${supportList.length} 人）：${supportList.map((s: any) => s.name).join("、") || "无"}`,
        `可以拓展（${topList.length} 人）：${topList.map((s: any) => s.name).join("、") || "无"}`
      ])
    }
  ];
}

/** 家长反馈文案（不含课时余量、不含任何金额） */
export function parentFeedback(d: any): Section[] {
  const { student, latest, kpWeak } = d;
  return [
    {
      title: "开头（客观陈述）",
      body: `您好，${student.name} 家长。跟您同步一下孩子最近一次「${latest.name}」的情况：得分率 ${pct(latest.rate)}，出勤情况 ${pct(student.attendance.rate)}。`
    },
    {
      title: "具体表现（只讲事实）",
      body: bullets([
        `最近三次检测：${student.exams.map((e: any) => e.rate).join(" → ")}`,
        `课堂表现：${student.eval.note}`,
        `目前需要加强的知识点：${kpWeak.slice(0, 2).map((k: any) => k.name).join("、")}`
      ])
    },
    {
      title: "我们会怎么做",
      body: bullets([
        `接下来两次课会安排「${kpWeak[0]?.name ?? "薄弱知识点"}」的专项练习，并在课上当堂面批`,
        "每周在群里同步一次孩子的作业完成情况"
      ])
    },
    {
      title: "需要家长配合",
      body: bullets([
        "督促孩子完成作业后自己检查一遍证明格式",
        "如果本周孩子有特殊情况，请提前告诉我们，方便安排补课"
      ])
    }
  ];
}

/** 学情报告叙述（教师版） */
export function reportNarrative(d: any): Section[] {
  const { student, latest, kpWeak, className, mode } = d;
  const isCampus = mode === "campus";
  const sections: Section[] = [
    {
      title: "一、基本情况",
      body: `${student.name}（学号 ${student.no}）｜${className}｜入学日期 ${student.hours.enrollDate}。`
    },
    {
      title: "二、学习情况",
      body: bullets([
        `考勤：应到 ${student.attendance.total} 次，缺勤 ${student.attendance.absent} 次，迟到 ${student.attendance.late} 次，出勤率 ${pct(student.attendance.rate)}`,
        `成绩：${student.exams.map((e: any) => `${e.name} ${e.rate}%`).join("；")}`,
        `趋势：近三次变化 ${student.trend >= 0 ? "+" : ""}${student.trend} 个百分点`
      ])
    },
    {
      title: "三、日常表现",
      body: bullets([
        `课堂专注度 ${student.eval.focus}/5，参与度 ${student.eval.participation}/5`,
        `作业完成情况 ${student.eval.homework}/5，知识点掌握自评 ${student.eval.mastery}/5`,
        `教师观察：${student.eval.note}`
      ])
    },
    {
      title: "四、知识点掌握",
      body: bullets(
        kpWeak.map((k: any) => `${k.name}：${pct(k.value)}（班级平均 ${pct(k.classValue)}）`)
      )
    },
    {
      title: "五、下一阶段教学安排",
      body: bullets(
        buildStudentActions(student, kpWeak).map((a, i) => `${i + 1}. ${a}`)
      )
    },
    {
      title: "六、依据与说明",
      body: "本报告数据来源：本机构教务系统的考勤记录、考试成绩与课堂评价记录。所有指标由系统本地计算，AI 仅负责文字表述。"
    }
  ];

  if (isCampus) {
    sections.push({
      title: "七、课时与续课建议（教务版）",
      body: bullets([
        `已购课时 ${student.hours.total}，剩余 ${student.hours.remain} 课时`,
        `按每周 2 次课估算，可持续约 ${Math.floor(student.hours.remain / 2)} 周`,
        "建议在剩余 4 周左右沟通下一阶段课程，保持学习连贯性"
      ])
    });
  }

  return sections;
}
