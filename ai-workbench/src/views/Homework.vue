<script setup lang="ts">
import { computed, ref } from "vue";
import AiPanel from "@/components/AiPanel.vue";
import * as engine from "@/ai/engine";
import { genHomeworkDesign, type AiOutput } from "@/ai/generators";
import { allKp, homeworkList, unit } from "@/workbench-data";
import { questions } from "@/workbench-data";

const output = ref<AiOutput | null>(null);
const loading = ref(false);
const kpFilter = ref("全部");

const kps = engine.kpMasteryRanking();
const errors = engine.errorRanking();

const kpOptions = [{ id: "全部", name: "全部知识点" }, ...allKp.value.map(k => ({ id: k.id, name: k.name }))];

const filtered = computed(() =>
  kpFilter.value === "全部"
    ? questions.value
    : questions.value.filter(q => q.kp === kpFilter.value)
);

const diffText = (d: number) => "★".repeat(d) + "☆".repeat(5 - d);

async function run() {
  loading.value = true;
  try {
    output.value = await genHomeworkDesign();
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
          <div class="card-title">本次作业题量与配比</div>
          <span class="card-sub">{{ unit.next.title }} 配套</span>
        </div>
        <div class="card-body">
          <div class="ratio">
            <div class="ratio-item">
              <div class="ratio-num">4</div>
              <div class="ratio-name">基础巩固</div>
              <div class="ratio-desc">已掌握知识点，保证完成信心</div>
            </div>
            <div class="ratio-item">
              <div class="ratio-num">3</div>
              <div class="ratio-name">针对性训练</div>
              <div class="ratio-desc">对应最高频错因，必须做</div>
            </div>
            <div class="ratio-item">
              <div class="ratio-num">1</div>
              <div class="ratio-name">拓展提高</div>
              <div class="ratio-desc">辅助线构造，标记选做</div>
            </div>
          </div>
          <div class="hint-box">
            设计依据：本班最薄弱的知识点是
            <b>{{ kps[0]?.name }}</b>（掌握度 {{ kps[0]?.value.toFixed(1) }}%），
            高频错因为「{{ errors[0]?.desc }}」（{{ errors[0]?.count }} 人次）。
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div class="card-title">分层方案</div>
          <span class="card-sub">按掌握度自动分组</span>
        </div>
        <div class="card-body">
          <div class="layer">
            <span class="tag tag-red">A 组</span>
            <div>
              <div class="layer-t">掌握度 &lt; 60（{{ engine.supportStudents().length }} 人）</div>
              <div class="layer-d">只做基础巩固 4 题 + 针对性训练前 2 题</div>
            </div>
          </div>
          <div class="layer">
            <span class="tag tag-blue">B 组</span>
            <div>
              <div class="layer-t">掌握度 60–85（多数学生）</div>
              <div class="layer-d">全部必做，拓展题选做</div>
            </div>
          </div>
          <div class="layer">
            <span class="tag tag-green">C 组</span>
            <div>
              <div class="layer-t">掌握度 &gt; 85（{{ engine.extendStudents().length }} 人）</div>
              <div class="layer-d">跳过基础题，补 1 道变式</div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <section class="card">
      <div class="card-head">
        <div class="card-title">题库选题</div>
        <div class="head-tools">
          <el-select v-model="kpFilter" size="small" style="width: 200px">
            <el-option v-for="k in kpOptions" :key="k.id" :label="k.name" :value="k.id" />
          </el-select>
          <span class="card-sub">{{ filtered.length }} 题</span>
        </div>
      </div>
      <div class="card-body">
        <div v-for="q in filtered" :key="q.id" class="q">
          <div class="q-top">
            <span class="tag tag-cyan">{{ q.type }}</span>
            <span class="q-kp">{{ q.kpName }}</span>
            <span class="q-diff" :title="`难度 ${q.difficulty}/5`">{{ diffText(q.difficulty) }}</span>
            <span class="tag" :class="q.status === '已启用' ? 'tag-green' : 'tag-amber'">
              {{ q.status }}
            </span>
          </div>
          <div class="q-stem">{{ q.stem }}</div>
          <div v-if="q.options" class="q-opts">
            <span v-for="o in q.options" :key="o">{{ o }}</span>
          </div>
          <div class="q-foot">
            答案：{{ q.answer }} · 已使用 {{ q.usedCount }} 次 · 来源 {{ q.source }}
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div class="card-title">已布置作业</div>
        <span class="card-sub">共 {{ homeworkList.length }} 次</span>
      </div>
      <div class="card-body">
        <div v-for="h in homeworkList" :key="h.id" class="hw">
          <div>
            <div class="hw-title">{{ h.title }}</div>
            <div class="hw-sub">{{ h.date }} · 提交 {{ h.submitted }}/{{ h.assigned }} · 平均 {{ h.avgScore }}/{{ h.fullScore }}</div>
          </div>
          <div class="hw-errs">
            <span v-for="e in h.typicalErrors.slice(0, 2)" :key="e.desc" class="err-chip">
              {{ e.desc }} {{ e.count }} 人
            </span>
          </div>
        </div>
      </div>
    </section>

    <AiPanel
      title="AI 作业设计"
      sub="按薄弱知识点与高频错因生成题量配比、分层方案与作业要求"
      :output="output"
      :loading="loading"
      action-text="生成作业设计"
      hint="题目来自本地题库筛选；题库不足时才会请模型补足，且默认标记待审。"
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
  grid-template-columns: 1.1fr 1fr;
  gap: 16px;
}

.ratio {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.ratio-item {
  padding: 12px;
  text-align: center;
  background: #f8fafc;
  border: 1px solid var(--c-border);
  border-radius: 8px;
}

.ratio-num {
  font-size: 22px;
  font-weight: 600;
  color: var(--c-primary);
}

.ratio-name {
  margin-top: 2px;
  font-size: 12.5px;
  font-weight: 500;
}

.ratio-desc {
  margin-top: 3px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--c-text-3);
}

.hint-box {
  padding: 10px 12px;
  margin-top: 12px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--c-text-2);
  background: var(--c-primary-soft);
  border: 1px solid var(--c-primary-line);
  border-radius: 8px;
}

.layer {
  display: flex;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--c-border);
}

.layer:last-child {
  border-bottom: none;
}

.layer-t {
  font-size: 12.5px;
  font-weight: 500;
}

.layer-d {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--c-text-3);
}

.head-tools {
  display: flex;
  align-items: center;
  gap: 10px;
}

.q {
  padding: 11px 0;
  border-bottom: 1px dashed var(--c-border);
}

.q:last-child {
  border-bottom: none;
}

.q-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
}

.q-kp {
  font-size: 12px;
  color: var(--c-text-2);
}

.q-diff {
  font-size: 11px;
  color: var(--c-warn);
  letter-spacing: 1px;
}

.q-stem {
  font-size: 13px;
  line-height: 1.75;
}

.q-opts {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--c-text-2);
}

.q-foot {
  margin-top: 5px;
  font-size: 11.5px;
  color: var(--c-text-3);
}

.hw {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--c-border);
}

.hw:last-child {
  border-bottom: none;
}

.hw-title {
  font-size: 13px;
  font-weight: 500;
}

.hw-sub {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--c-text-3);
}

.hw-errs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.err-chip {
  padding: 3px 8px;
  font-size: 11px;
  color: #b45309;
  background: var(--c-warn-soft);
  border-radius: 999px;
}

@media (max-width: 1200px) {
  .grid-2,
  .ratio {
    grid-template-columns: 1fr;
  }
}
</style>
