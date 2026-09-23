<script setup lang="ts">
import { ref } from "vue";
import AiPanel from "@/components/AiPanel.vue";
import * as engine from "@/ai/engine";
import { genLessonPlan, type AiOutput } from "@/ai/generators";
import { unit } from "@/workbench-data";

const kps = engine.kpMasteryRanking();
const support = engine.supportStudents();
const output = ref<AiOutput | null>(null);
const loading = ref(false);

const existing = [
  { id: 1, title: "第 6 课时 · 角平分线的性质", updatedAt: "2026-09-10 21:14", status: "已用于上课" },
  { id: 2, title: "第 5 课时 · 判定方法 HL", updatedAt: "2026-09-08 20:02", status: "已归档" }
];

const consistency = [
  {
    teach: "角平分线性质定理的条件与结论",
    practice: "3 道递进题（直接套用 / 需作垂线 / 需先证角相等）",
    judge: "能在新图形中主动作垂线；课堂练习 C 组正确率 ≥ 60%"
  },
  {
    teach: "性质与判定的区别",
    practice: "同一图形正用一次、反用一次",
    judge: "能说出反向使用需补「在角的内部」这一条件"
  },
  {
    teach: "倍长中线三步走",
    practice: "1 道模板题 + 1 道变式",
    judge: "能独立写出辅助线作法，并说明为什么这样添"
  }
];

async function run() {
  loading.value = true;
  try {
    output.value = await genLessonPlan();
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="page">
    <section class="card">
      <div class="card-head">
        <div class="card-title">本课信息</div>
        <span class="tag tag-blue">第 {{ unit.next.no }} 课时</span>
      </div>
      <div class="card-body">
        <div class="head-row">
          <div class="head-main">
            <div class="lesson-name">{{ unit.next.title }}</div>
            <div class="lesson-sub">
              {{ unit.no }}{{ unit.name }} · 上课时间 {{ unit.next.date }} · 45 分钟
            </div>
          </div>
          <div class="head-side">
            <div class="side-item">
              <span class="side-k">班级最薄弱</span>
              <span class="side-v">{{ kps[0]?.name }}（{{ kps[0]?.value.toFixed(1) }}%）</span>
            </div>
            <div class="side-item">
              <span class="side-k">需关注学生</span>
              <span class="side-v">{{ support.length }} 人</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div class="card-title">备课一致性检查</div>
        <span class="card-sub">教什么 → 学生练什么 → 拿什么判断学会了</span>
      </div>
      <div class="card-body">
        <div class="check-head">
          <span>教什么</span>
          <span>练什么</span>
          <span>怎么判断学会</span>
        </div>
        <div v-for="(c, i) in consistency" :key="i" class="check-row">
          <div>{{ c.teach }}</div>
          <div>{{ c.practice }}</div>
          <div>{{ c.judge }}</div>
        </div>
      </div>
    </section>

    <AiPanel
      title="AI 备课方案"
      sub="输出教学目标、重难点、45 分钟流程、提问设计、分层任务与板书"
      :output="output"
      :loading="loading"
      action-text="生成备课方案"
      hint="生成结果会带上本班最薄弱的知识点与需关注学生，不需要你重复录入学情。"
      @generate="run"
    />

    <section class="card">
      <div class="card-head">
        <div class="card-title">已有教案</div>
        <span class="card-sub">生成结果可另存为教案，按课时归档</span>
      </div>
      <div class="card-body">
        <div v-for="e in existing" :key="e.id" class="plan">
          <div>
            <div class="plan-title">{{ e.title }}</div>
            <div class="plan-time">更新于 {{ e.updatedAt }}</div>
          </div>
          <span class="tag" :class="e.status === '已用于上课' ? 'tag-green' : 'tag-gray'">
            {{ e.status }}
          </span>
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

.head-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.lesson-name {
  font-size: 17px;
  font-weight: 600;
}

.lesson-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--c-text-3);
}

.head-side {
  flex-shrink: 0;
  text-align: right;
}

.side-item {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  font-size: 12px;
}

.side-item + .side-item {
  margin-top: 4px;
}

.side-k {
  color: var(--c-text-3);
}

.side-v {
  font-weight: 500;
}

.check-head,
.check-row {
  display: grid;
  grid-template-columns: 1fr 1.2fr 1.2fr;
  gap: 14px;
}

.check-head {
  padding-bottom: 8px;
  font-size: 12px;
  color: var(--c-text-3);
  border-bottom: 1px solid var(--c-border);
}

.check-row {
  padding: 11px 0;
  font-size: 12.5px;
  line-height: 1.7;
  border-bottom: 1px dashed var(--c-border);
}

.check-row:last-child {
  border-bottom: none;
}

.plan {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--c-border);
}

.plan:last-child {
  border-bottom: none;
}

.plan-title {
  font-size: 13px;
  font-weight: 500;
}

.plan-time {
  margin-top: 2px;
  font-size: 11px;
  color: var(--c-text-3);
}
</style>
