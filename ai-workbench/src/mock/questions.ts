/**
 * 题库（演示数据）—— 对应报告里的 L2 题目层
 * 版权口径：source 字段区分「自编 / AI原创 / 教材 / 授权题库」，
 * 演示数据一律标注为「演示题库」，不引用任何真实教辅内容。
 */

export interface Question {
  id: number;
  kp: string;
  kpName: string;
  type: "选择题" | "填空题" | "解答题";
  difficulty: 2 | 3 | 4 | 5;
  stem: string;
  options?: string[];
  answer: string;
  analysis: string;
  source: string;
  status: "已启用" | "待审" | "草稿";
  usedCount: number;
}

export const QUESTIONS: Question[] = [
  {
    id: 1,
    kp: "k1-1",
    kpName: "SSS 边边边",
    type: "选择题",
    difficulty: 2,
    stem: "在△ABC 和△DEF 中，AB=DE，BC=EF，AC=DF，则判定△ABC≌△DEF 的依据是（　　）",
    options: ["A. SSS", "B. SAS", "C. ASA", "D. AAS"],
    answer: "A",
    analysis: "三组对应边分别相等，符合 SSS 判定。",
    source: "演示题库",
    status: "已启用",
    usedCount: 9
  },
  {
    id: 2,
    kp: "k1-2",
    kpName: "SAS 边角边",
    type: "选择题",
    difficulty: 3,
    stem: "已知 AB=AC，AD=AE，∠BAC=∠DAE，则△ABD≌△ACE 的依据是（　　）",
    options: ["A. SSS", "B. SAS", "C. ASA", "D. AAS"],
    answer: "B",
    analysis: "由∠BAC=∠DAE 两边同时减去∠DAC，得∠BAD=∠CAE；又 AB=AC、AD=AE，两组边及其夹角相等，符合 SAS。",
    source: "演示题库",
    status: "已启用",
    usedCount: 12
  },
  {
    id: 3,
    kp: "k1-2",
    kpName: "SAS 边角边",
    type: "选择题",
    difficulty: 2,
    stem: "在△ABC 和△DEF 中，AB=DE，∠B=∠E，若判定两三角形全等，下列条件中不能添加的是（　　）",
    options: ["A. BC=EF", "B. ∠A=∠D", "C. ∠C=∠F", "D. AC=DF"],
    answer: "D",
    analysis: "A 为 SAS，B 为 ASA，C 为 AAS；D 是「边边角」，不能判定全等。",
    source: "演示题库",
    status: "已启用",
    usedCount: 15
  },
  {
    id: 4,
    kp: "k1-3",
    kpName: "ASA 角边角",
    type: "填空题",
    difficulty: 3,
    stem: "在△ABC 和△DEF 中，∠B=∠E，BC=EF，若要用 ASA 判定全等，还需要补充的条件是 __________。",
    answer: "∠C=∠F",
    analysis: "ASA 要求两组角及其夹边对应相等，已知∠B=∠E、BC=EF，夹边 BC 的两端角是∠B 与∠C，故补∠C=∠F。",
    source: "演示题库",
    status: "已启用",
    usedCount: 11
  },
  {
    id: 5,
    kp: "k1-4",
    kpName: "AAS 角角边",
    type: "选择题",
    difficulty: 3,
    stem: "在△ABC 和△DEF 中，∠A=∠D，∠B=∠E，AC=DF，则判定全等最直接的依据是（　　）",
    options: ["A. ASA", "B. AAS", "C. SAS", "D. SSS"],
    answer: "B",
    analysis: "AC 是∠B 的对边，DF 是∠E 的对边，构成「两角及其中一角的对边」，用 AAS。",
    source: "演示题库",
    status: "已启用",
    usedCount: 14
  },
  {
    id: 6,
    kp: "k1-5",
    kpName: "HL 斜边、直角边",
    type: "选择题",
    difficulty: 3,
    stem: "两个直角三角形中，斜边和一条直角边分别相等，则这两个三角形（　　）",
    options: ["A. 一定全等", "B. 不一定全等", "C. 一定不全等", "D. 无法判断"],
    answer: "A",
    analysis: "直角三角形中斜边与一条直角边对应相等，可由勾股定理推出另一条直角边也相等，从而全等（HL）。",
    source: "演示题库",
    status: "已启用",
    usedCount: 8
  },
  {
    id: 7,
    kp: "k2-1",
    kpName: "对应边相等",
    type: "填空题",
    difficulty: 2,
    stem: "若△ABC≌△DEF，AB=5，BC=7，AC=6，则 DE=_____，EF=_____。",
    answer: "5；7",
    analysis: "全等三角形的对应边相等：AB 对应 DE，BC 对应 EF。",
    source: "演示题库",
    status: "已启用",
    usedCount: 16
  },
  {
    id: 8,
    kp: "k2-2",
    kpName: "对应角相等",
    type: "选择题",
    difficulty: 2,
    stem: "若△ABC≌△DEF，∠A=50°，∠B=70°，则∠F 的度数是（　　）",
    options: ["A. 50°", "B. 60°", "C. 70°", "D. 80°"],
    answer: "B",
    analysis: "∠C=180°−50°−70°=60°，∠F 与∠C 对应，故为 60°。",
    source: "演示题库",
    status: "已启用",
    usedCount: 13
  },
  {
    id: 9,
    kp: "k3-1",
    kpName: "角平分线上的点到角两边距离相等",
    type: "解答题",
    difficulty: 3,
    stem: "OC 平分∠AOB，点 P 在 OC 上，PD⊥OA 于点 D，PE⊥OB 于点 E。若 PD=3，求 PE 的长，并说明理由。",
    answer: "PE=3",
    analysis: "由角平分线的性质：角平分线上的点到角两边的距离相等，PD 与 PE 分别是 P 到 OA、OB 的距离，故 PE=PD=3。",
    source: "演示题库",
    status: "已启用",
    usedCount: 18
  },
  {
    id: 10,
    kp: "k3-1",
    kpName: "角平分线上的点到角两边距离相等",
    type: "选择题",
    difficulty: 3,
    stem: "OC 平分∠AOB，P 在 OC 上，下列说法正确的是（　　）",
    options: [
      "A. P 到 OA 的距离等于 P 到 OB 的距离",
      "B. PO=PD",
      "C. ∠OPD=∠OPE",
      "D. PD=OD"
    ],
    answer: "A",
    analysis: "角平分线性质只保证「点到两边的距离相等」，距离必须由垂线段体现，B、D 无依据，C 需额外条件。",
    source: "演示题库",
    status: "已启用",
    usedCount: 10
  },
  {
    id: 11,
    kp: "k3-2",
    kpName: "到角两边距离相等的点在角平分线上",
    type: "解答题",
    difficulty: 4,
    stem: "点 P 在∠AOB 的内部，且 P 到 OA、OB 的距离相等。求证：点 P 在∠AOB 的平分线上。",
    answer: "见解析",
    analysis: "过 P 作 PD⊥OA 于 D，PE⊥OB 于 E，则 PD=PE；连接 OP，由 HL 可证 Rt△OPD≌Rt△OPE，得∠DOP=∠EOP，故 OP 平分∠AOB。",
    source: "演示题库",
    status: "已启用",
    usedCount: 7
  },
  {
    id: 12,
    kp: "k3-2",
    kpName: "到角两边距离相等的点在角平分线上",
    type: "填空题",
    difficulty: 3,
    stem: "到角的两边距离相等的点，一定在这个角的 __________ 上。",
    answer: "平分线",
    analysis: "这是角平分线性质定理的逆定理，是判断点是否在角平分线上的依据。",
    source: "演示题库",
    status: "已启用",
    usedCount: 12
  },
  {
    id: 13,
    kp: "k4-1",
    kpName: "倍长中线",
    type: "解答题",
    difficulty: 5,
    stem: "在△ABC 中，AD 是 BC 边上的中线。延长 AD 到点 E，使 DE=AD，连接 BE。求证：△ADC≌△EDB。",
    answer: "见解析",
    analysis: "要写全「在△ADC 和△EDB 中」的格式：AD=ED（作图），∠ADC=∠EDB（对顶角），DC=DB（中线定义），故△ADC≌△EDB（SAS）。这是倍长中线的标准第一步。",
    source: "演示题库",
    status: "已启用",
    usedCount: 6
  },
  {
    id: 14,
    kp: "k4-1",
    kpName: "倍长中线",
    type: "解答题",
    difficulty: 5,
    stem: "在△ABC 中，AB=5，AC=3，AD 是 BC 边上的中线，求 AD 的取值范围。",
    answer: "1 < AD < 4",
    analysis: "倍长中线至 E 使 DE=AD，可证△ADC≌△EDB，于是 BE=AC=3；在△ABE 中由三角形三边关系得 5−3 < 2AD < 5+3，即 1 < AD < 4。",
    source: "演示题库",
    status: "待审",
    usedCount: 0
  },
  {
    id: 15,
    kp: "k4-2",
    kpName: "截长补短",
    type: "解答题",
    difficulty: 5,
    stem: "在△ABC 中，AB > AC，AD 平分∠BAC 交 BC 于 D。求证：AB − AC > DB − DC。",
    answer: "见解析",
    analysis: "用截长法：在 AB 上截取 AE=AC，连接 DE，可证△AED≌△ACD（SAS），得 DE=DC；再在△BDE 中用三角形三边关系得 BE > DB − DE，即 AB−AC > DB−DC。",
    source: "演示题库",
    status: "待审",
    usedCount: 0
  },
  {
    id: 16,
    kp: "k4-2",
    kpName: "截长补短",
    type: "选择题",
    difficulty: 4,
    stem: "当题目中出现「求证一条线段等于另两条线段之和」时，较常用的辅助线方法是（　　）",
    options: ["A. 作高", "B. 截长补短", "C. 倍长中线", "D. 平移"],
    answer: "B",
    analysis: "「a = b + c」型结论优先考虑截长或补短：在长线段上截取，或把短线段延长。",
    source: "演示题库",
    status: "已启用",
    usedCount: 4
  },
  {
    id: 17,
    kp: "k1-2",
    kpName: "SAS 边角边",
    type: "解答题",
    difficulty: 4,
    stem: "已知 AB=AD，AC=AE，∠BAD=∠CAE。求证：BC=DE。",
    answer: "见解析",
    analysis: "由∠BAD=∠CAE 两边加∠DAC 得∠BAC=∠DAE；又 AB=AD、AC=AE，故△ABC≌△ADE（SAS），从而 BC=DE。",
    source: "演示题库",
    status: "已启用",
    usedCount: 8
  },
  {
    id: 18,
    kp: "k1-3",
    kpName: "ASA 角边角",
    type: "解答题",
    difficulty: 4,
    stem: "AB 与 CD 相交于点 O，O 是 AB 的中点，AC∥BD。求证：△AOC≌△BOD。",
    answer: "见解析",
    analysis: "由 AC∥BD 得∠A=∠B（内错角），AO=BO（中点），∠AOC=∠BOD（对顶角），故△AOC≌△BOD（ASA）。",
    source: "演示题库",
    status: "已启用",
    usedCount: 9
  },
  {
    id: 19,
    kp: "k1-5",
    kpName: "HL 斜边、直角边",
    type: "解答题",
    difficulty: 4,
    stem: "在△ABC 中，∠C=90°，AD 平分∠BAC 交 BC 于 D，DE⊥AB 于 E。求证：DC=DE。",
    answer: "见解析",
    analysis: "PD 型结构：由 AD 平分∠BAC、DC⊥AC、DE⊥AB，直接用角平分线性质得 DC=DE；也可用 HL 证 Rt△ACD≌Rt△AED。",
    source: "演示题库",
    status: "已启用",
    usedCount: 11
  },
  {
    id: 20,
    kp: "k1-1",
    kpName: "SSS 边边边",
    type: "填空题",
    difficulty: 2,
    stem: "用尺规作一个角等于已知角，其作图依据是三角形全等的判定方法 __________。",
    answer: "SSS",
    analysis: "作图过程中截取的三段弧对应相等，得到三组边分别相等，故依据是 SSS。",
    source: "演示题库",
    status: "已启用",
    usedCount: 5
  }
];

export const QUESTION_STATS = {
  total: QUESTIONS.length,
  enabled: QUESTIONS.filter(q => q.status === "已启用").length,
  pending: QUESTIONS.filter(q => q.status === "待审").length,
  byKp: ALL_KP_STAT()
};

function ALL_KP_STAT() {
  const map: Record<string, number> = {};
  for (const q of QUESTIONS) map[q.kp] = (map[q.kp] || 0) + 1;
  return map;
}
