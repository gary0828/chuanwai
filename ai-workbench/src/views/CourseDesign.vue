<script setup lang="ts">
import { ref } from "vue";
import AiPanel from "@/components/AiPanel.vue";
import KpBar from "@/components/KpBar.vue";
import * as engine from "@/ai/engine";
import { genCourseDesign, type AiOutput } from "@/ai/generators";
import { course, unit } from "@/workbench-data";

const kps = engine.kpMasteryRanking();
const output = ref<AiOutput | null>(null);
const loading = ref(false);

const lessons = [
  { no: 1, title: "全等图形与对应元素", status: "已完成", date: "08-26" },
  { no: 2, title: "判定方法 SSS", status: "已完成", date: "08-29" },
  { no: 3, title: "判定方法 SAS", status: "已完成", date: "09-04" },
  { no: 4, title: "判定辨析 ASA / AAS", status: "已完成", date: "09-08" },
  { no: 5, title: "判定方法 HL", status: "已完成", date: "09-09" },
  { no: 6, title: "角平分线的性质", status: "进行中", date: "09-11" },
  { no: 7, title: "全等三角形的综合应用", status: "待开始", date: "09-15" },
  { no: 8, title: "辅助线构造（倍长中线 / 截长补短）", status: "待开始", date: "09-18" }
];

const statusCls: Record<string, string> = {
  已完成: "tag-green",
  进行中: "tag-blue",
  待开始: "tag-gray"
};

const standards = [
  "掌握「两边及其夹角分别相等的两个三角形全等」这一基本事实",
  "掌握 SSS、ASA、AAS、HL 判定定理，能按条件选择判定方法",
  "能利用全等证明线段相等、角相等，并解决简单实际问题",
  "经历观察—猜想—验证过程，发展推理能力与几何直观"
];

async function run() {
  loading.value = true;
  try {
    output.value = await genCourseDesign();
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="page">
    <div class="grid-2">
      <section class="card">
        <div class="card-head">
          <div class="card-title">单元结构</div>
          <span class="card-sub">{{ course.textbook }}</span>
        </div>
        <div class="card-body">
          <div class="unit-head">
            <span class="unit-no">{{ unit.no }}</span>
            <span class="unit-name">{{ unit.name }}</span>
            <span class="tag tag-blue">{{ unit.doneHours }}/{{ unit.totalHours }} 课时</span>
          </div>
          <div v-for="l in lessons" :key="l.no" class="lesson">
            <span class="lesson-no">{{ l.no }}</span>
            <span class="lesson-title">{{ l.title }}</span>
            <span class="lesson-date">{{ l.date }}</span>
            <span class="tag" :class="statusCls[l.status]">{{ l.status }}</span>
          </div>
        </div>
      </section>

      <div class="col">
        <section class="card">
          <div class="card-head">
            <div class="card-title">课标对应</div>
          </div>
          <div class="card-body">
            <ul class="std-list">
              <li v-for="(s, i) in standards" :key="i">{{ s }}</li>
            </ul>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <div class="card-title">单元目标</div>
          </div>
          <div class="card-body">
            <ol class="std-list">
              <li v-for="(g, i) in unit.goals" :key="i">{{ g }}</li>
            </ol>
          </div>
        </section>
      </div>
    </div>

    <section class="card">
      <div class="card-head">
        <div class="card-title">学情基线</div>
        <span class="card-sub">本单元涉及知识点的班级平均掌握度</span>
      </div>
      <div class="card-body kp-grid">
        <KpBar
          v-for="k in kps"
          :key="k.id"
          :name="k.name"
          :value="k.value"
          :meta="k.parent"
        />
      </div>
    </section>

    <AiPanel
      title="AI 课程设计"
      sub="结合教材结构与本班学情，输出单元定位、课时结构与设计建议"
      :output="output"
      :loading="loading"
      action-text="生成课程设计"
      hint="生成内容包含课时拆分建议，可直接用于教研讨论；薄弱知识点来自本地统计。"
      @generate="run"
    />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.grid-2 {
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  gap: 16px;
}

.col {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.unit-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 12px;
  margin-bottom: 6px;
  border-bottom: 1px solid var(--c-border);
}

.unit-no {
  font-size: 12px;
  color: var(--c-text-3);
}

.unit-name {
  flex: 1;
  font-size: 15px;
  font-weight: 600;
}

.lesson {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px dashed var(--c-border);
}

.lesson:last-child {
  border-bottom: none;
}

.lesson-no {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  font-size: 11px;
  color: var(--c-text-2);
  background: #f1f3f5;
  border-radius: 6px;
}

.lesson-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
}

.lesson-date {
  font-size: 11px;
  color: var(--c-text-3);
}

.std-list {
  padding-left: 18px;
  margin: 0;
  font-size: 12.5px;
  line-height: 2;
  color: var(--c-text-2);
}

.kp-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px 24px;
}

@media (max-width: 1200px) {
  .grid-2,
  .kp-grid {
    grid-template-columns: 1fr;
  }
}
</style>
