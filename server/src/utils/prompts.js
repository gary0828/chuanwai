// 场景提示词模板（服务端权威版本）
//
// 设计原则（对应调研报告 ADR-004 / ADR-007）：
// 1. **数字全部由本地指标引擎算出**，模型只负责组织语言、给可执行建议；
// 2. 明确禁止模型编造数据、下诊断结论、给学生贴标签；
// 3. 统一用「【小标题】」分段，便于前端直接渲染；
// 4. 载荷在进入本模块前已由 utils/redact.js 过滤（姓名/电话/金额不出网）。

const COMMON_SYSTEM = `你是一位有 15 年一线教学经验的教研组长，正在协助培训机构的教师完成教学工作。

必须遵守：
1. 只能使用我提供的数字与事实，禁止编造、推算或补充任何未给出的数据；数据不足时明确说「数据不足，暂不做判断」，不要硬凑结论。
2. 不对学生做人格、性格、家庭、心理或能力上的评价，只描述可观测的学习事实与教师可执行的教学动作。
3. 建议必须具体可执行。反例：「加强关注」「多做练习」「提升兴趣」；正例：「下节课开场用 5 分钟重讲角平分线性质的反向判定，配 2 道变式题」。
4. 不要出现任何学生真实姓名（如需指代，用「学员A」「该生」），不要提及任何金额。
5. 输出格式：用「【小标题】」分段，每段标题单独一行，段内可用「· 」列点。不要使用 Markdown 表格、代码块或多级标题。`;

/** 各场景的个性化要求 */
const SCENES = {
  course_design: {
    label: "课程设计",
    output:
      "【单元定位】【学段与课标对应】【单元目标（可观测）】【课时结构】【学情基线说明】【设计建议】"
  },
  lesson_plan: {
    label: "备课方案",
    output:
      "【本课定位】【教学目标】【教学重难点】【教学流程（按分钟给时间轴）】【课堂提问设计（含预设答案要点）】【分层任务】【需要关注的学生（只说教学动作，不点名）】【板书设计】"
  },
  teaching_flow: {
    label: "授课流程",
    output: "【课前 2 分钟】【环节卡（环节 / 时长 / 目标）】【课堂快捷工具用法】【本课观察重点】"
  },
  homework_design: {
    label: "作业设计",
    output:
      "【作业定位】【设计依据】【题量与配比】【分层方案（按掌握度分组）】【作业要求（含书写规范）】"
  },
  grading_feedback: {
    label: "作业检查与评价",
    output:
      "【批改概况】【共性错误（按人次排序，每条给复教建议）】【需要单独反馈的学生】【批语模板（可直接套用的 3 条）】【复教建议】"
  },
  student_insight: {
    label: "学员学情解读",
    output: "【总体判断】【薄弱知识点（含班内对比）】【可执行建议（3 条以内，按优先级）】【依据说明】"
  },
  class_diagnosis: {
    label: "班级学情诊断",
    output:
      "【班级总体】【共性问题（按弱到强）】【错因归集】【离群情况】【下一阶段教学动作】【名单口径说明】"
  },
  parent_feedback: {
    label: "家长反馈文案",
    output:
      "【开头（客观陈述）】【具体表现（只讲事实）】【我们会怎么做】【需要家长配合】"
  },
  report_narrative: {
    label: "学情报告叙述",
    output:
      "【一、基本情况】【二、学习情况】【三、日常表现】【四、知识点掌握】【五、下一阶段教学安排】【六、依据与说明】"
  }
};

function isScene(key) {
  return Object.prototype.hasOwnProperty.call(SCENES, key);
}

function sceneLabel(key) {
  return SCENES[key]?.label || key;
}

/**
 * 组装一次生成的 messages。
 * @param {string} scene 场景 key
 * @param {Record<string, unknown>} payload 已脱敏的载荷
 * @param {string} [extra] 该场景的额外要求（如教师补充说明）
 */
function buildMessages(scene, payload, extra) {
  const conf = SCENES[scene];
  if (!conf) {
    throw new Error(`未知场景：${scene}`);
  }

  const user = [
    `场景：${conf.label}`,
    "",
    "以下是系统本地计算好的数据（请严格基于这些数据）：",
    JSON.stringify(payload, null, 2),
    "",
    extra ? `教师补充说明：${extra}` : "",
    "",
    `请按以下小标题组织输出：${conf.output}`,
    "",
    "再次强调：不要编造任何未给出的数字；不要出现学生真实姓名；不要提及金额。"
  ]
    .filter(Boolean)
    .join("\n");

  return [
    { role: "system", content: COMMON_SYSTEM },
    { role: "user", content: user }
  ];
}

/** 供接口做参数校验与前端展示 */
function sceneList() {
  return Object.entries(SCENES).map(([key, v]) => ({ key, label: v.label }));
}

module.exports = { buildMessages, isScene, sceneLabel, sceneList, COMMON_SYSTEM };
