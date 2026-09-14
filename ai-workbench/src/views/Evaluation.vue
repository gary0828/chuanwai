<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AiPanel from "@/components/AiPanel.vue";
import * as engine from "@/ai/engine";
import { genGradingFeedback, type AiOutput } from "@/ai/generators";
import { allKp, homeworkList, students } from "@/workbench-data";

const hwId = ref(homeworkList.value[homeworkList.value.length - 1].id);
const output = ref<AiOutput | null>(null);
const loading = ref(false);

const hw = computed(() => homeworkList.value.find(h => h.id === hwId.value) || homeworkList.value[0]);
const support = engine.supportStudents();

const missingNames = computed(() =>
  hw.value.missing
    .map(no => students.value.find(s => s.no === no)?.name ?? no)
    .join("、")
);

const submitRate = computed(() =>
  Math.round((hw.value.submitted / hw.value.assigned) * 1000) / 10
);

const suggestions: Record<string, string> = {
  "k1-4": "两组图对比 ASA 与 AAS 的边角位置",
  "k1-2": "强调「夹角」必须在两条已知边之间",
  "k3-2": "反向判定要补「在角的内部」这一条件",
  "k3-1": "提醒距离必须是垂线段",
  "k4-1": "把倍长中线拆成三步并配模板题",
  "k4-2": "遇到「线段和」结论优先想截长补短"
};

watch(hwId, () => {
  output.value = null;
});

async function run() {
  loading.value = true;
  try {
    output.value = await genGradingFeedback(hwId.value);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="page">
    <section class="card">
      <div class="card-head">
        <div class="card-title">选择作业</div>
        <el-select v-model="hwId" size="small" style="width: 260px">
          <el-option v-for="h in homeworkList" :key="h.id" :label="h.title" :value="h.id" />
        </el-select>
      </div>
      <div class="card-body">
        <div class="overview">
          <div class="metric">
            <div class="metric-label">应收 / 实收</div>
            <div class="metric-value">{{ hw.assigned }}<small> / {{ hw.submitted }} 份</small></div>
          </div>
          <div class="metric">
            <div class="metric-label">提交率</div>
            <div class="metric-value">{{ submitRate }}<small>%</small></div>
          </div>
          <div class="metric">
            <div class="metric-label">平均分</div>
            <div class="metric-value">{{ hw.avgScore }}<small> / {{ hw.fullScore }}</small></div>
          </div>
          <div class="metric">
            <div class="metric-label">未提交</div>
            <div class="metric-value">{{ hw.missing.length }}<small> 人</small></div>
          </div>
        </div>
        <div v-if="missingNames" class="missing">未提交：{{ missingNames }}</div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div class="card-title">错因归集</div>
        <span class="card-sub">按人次排序，含复教建议</span>
      </div>
      <div class="card-body">
        <div class="err-head">
          <span>错误描述</span>
          <span>知识点</span>
          <span>人次</span>
          <span>建议动作</span>
        </div>
        <div v-for="(e, i) in hw.typicalErrors" :key="i" class="err-row">
          <div>{{ e.desc }}</div>
          <div class="err-kp">{{ allKp.find(k => k.id === e.kp)?.name }}</div>
          <div class="err-count">{{ e.count }}</div>
          <div class="err-act">{{ suggestions[e.kp] || "安排同类变式题" }}</div>
        </div>
      </div>
    </section>

    <AiPanel
      title="AI 批改与评价建议"
      sub="汇总共性错误、生成批语模板与复教建议"
      :output="output"
      :loading="loading"
      action-text="生成评价建议"
      hint="批改建议依据本次作业统计生成；主观题只给建议分与评语，不自动写入成绩。"
      @generate="run"
    />

    <section class="card">
      <div class="card-head">
        <div class="card-title">需要单独反馈的学生</div>
        <span class="card-sub">依据考勤、成绩与作业记录</span>
      </div>
      <div class="card-body">
        <div v-if="!support.length" class="empty">本次无需单独反馈</div>
        <div v-for="s in support" v-else :key="s.id" class="stu">
          <div class="stu-top">
            <span class="stu-name">{{ s.name }}</span>
            <span v-for="t in s.tags" :key="t" class="tag tag-amber">{{ t }}</span>
          </div>
          <div class="stu-body">
            最近得分率 {{ s.avgRate.toFixed(1) }}% · 出勤 {{ s.attendance.rate.toFixed(1) }}% ·
            剩余课时 {{ s.hours.remain }}
          </div>
          <div class="stu-act">
            建议动作：{{
              s.tags.includes("连续缺勤")
                ? "先与家长确认缺勤原因，并安排一次补课"
                : s.tags.includes("课时将尽")
                  ? "与教务同步续课安排，避免中断"
                  : "当堂面批错题，确认是思路问题还是格式问题"
            }}
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.overview {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.missing {
  padding: 8px 12px;
  margin-top: 12px;
  font-size: 12px;
  color: #b91c1c;
  background: var(--c-danger-soft);
  border-radius: 8px;
}

.err-head,
.err-row {
  display: grid;
  grid-template-columns: 1.4fr 1fr 60px 1.4fr;
  gap: 14px;
  align-items: center;
}

.err-head {
  padding-bottom: 8px;
  font-size: 12px;
  color: var(--c-text-3);
  border-bottom: 1px solid var(--c-border);
}

.err-row {
  padding: 10px 0;
  font-size: 12.5px;
  line-height: 1.6;
  border-bottom: 1px dashed var(--c-border);
}

.err-row:last-child {
  border-bottom: none;
}

.err-kp {
  color: var(--c-text-2);
}

.err-count {
  font-weight: 600;
  color: var(--c-danger);
}

.err-act {
  color: var(--c-text-2);
}

.stu {
  padding: 11px 0;
  border-bottom: 1px dashed var(--c-border);
}

.stu:last-child {
  border-bottom: none;
}

.stu-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stu-name {
  font-size: 13px;
  font-weight: 500;
}

.stu-body {
  margin-top: 5px;
  font-size: 12px;
  color: var(--c-text-3);
}

.stu-act {
  margin-top: 4px;
  font-size: 12px;
  color: var(--c-primary-dark);
}

@media (max-width: 1200px) {
  .overview {
    grid-template-columns: repeat(2, 1fr);
  }

  .err-head,
  .err-row {
    grid-template-columns: 1fr;
    gap: 4px;
  }

  .err-head {
    display: none;
  }
}
</style>
