<script setup lang="ts">
import { computed, ref } from "vue";
import IconArrow from "~icons/ep/arrow-right";
import IconWarn from "~icons/ep/warning-filled";
import AiPanel from "@/components/AiPanel.vue";
import KpBar from "@/components/KpBar.vue";
import * as engine from "@/ai/engine";
import { genClassDiagnosis, type AiOutput } from "@/ai/generators";
import { classRecords, homeworkList, unit, unitProgressRows } from "@/workbench-data";

const overview = engine.classOverview();
const unitInfo = engine.unitProgress();
const kps = engine.kpMasteryRanking();
const support = engine.supportStudents();
const top = engine.extendStudents();
const records = engine.recentRecords(3);
const homework = [...homeworkList.value].reverse();

const output = ref<AiOutput | null>(null);
const loading = ref(false);

const metrics = computed(() => [
  { label: "在班学员", value: String(overview.studentCount), unit: "人" },
  { label: "出勤率", value: overview.attendanceRate.toFixed(1), unit: "%" },
  { label: "最近检测平均得分率", value: overview.avgScoreRate.toFixed(1), unit: "%" },
  { label: "作业提交率", value: overview.homeworkSubmitRate.toFixed(1), unit: "%" },
  { label: "需关注学员", value: String(support.length), unit: "人" }
]);

const statusCls: Record<string, string> = {
  已达成: "tag-green",
  基本达成: "tag-blue",
  需复教: "tag-red",
  未开始: "tag-gray"
};

async function runDiagnosis() {
  loading.value = true;
  try {
    output.value = await genClassDiagnosis();
  } finally {
    loading.value = false;
  }
}

function reasonOf(tags: string[]): string {
  return tags.length ? tags.join("、") : "成绩偏低";
}
</script>

<template>
  <div class="page">
    <div class="metrics">
      <div v-for="m in metrics" :key="m.label" class="metric">
        <div class="metric-label">{{ m.label }}</div>
        <div class="metric-value">{{ m.value }}<small>{{ m.unit }}</small></div>
      </div>
    </div>

    <div class="grid-2">
      <section class="card">
        <div class="card-head">
          <div class="card-title">当前单元</div>
          <span class="tag tag-blue">{{ unitInfo.percent }}% 已完成</span>
        </div>
        <div class="card-body">
          <div class="unit-name">{{ unit.no }} {{ unit.name }}</div>
          <div class="unit-meta">
            共 {{ unit.totalHours }} 课时，已完成 {{ unit.doneHours }} 课时，剩 {{ unitInfo.remainHours }} 课时
          </div>

          <div class="track">
            <div class="track-fill" :style="{ width: unitInfo.percent + '%' }" />
          </div>

          <div class="lesson-row">
            <div class="lesson-box">
              <div class="lesson-tag">上次课</div>
              <div class="lesson-title">第 {{ unit.current.no }} 课时 · {{ unit.current.title }}</div>
              <div class="lesson-date">{{ unit.current.date }}</div>
            </div>
            <IconArrow class="arrow" />
            <div class="lesson-box next">
              <div class="lesson-tag next-tag">下一课时</div>
              <div class="lesson-title">第 {{ unit.next.no }} 课时 · {{ unit.next.title }}</div>
              <div class="lesson-date">{{ unit.next.date }}</div>
            </div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div class="card-title">单元目标落实</div>
          <span class="card-sub">依据检测与作业记录</span>
        </div>
        <div class="card-body">
          <div v-for="(g, i) in unitProgressRows" :key="i" class="goal">
            <div class="goal-top">
              <span class="goal-name">{{ g.goal }}</span>
              <span class="tag" :class="statusCls[g.status] || 'tag-gray'">{{ g.status }}</span>
            </div>
            <div class="goal-ev">{{ g.evidence }}</div>
          </div>
        </div>
      </section>
    </div>

    <AiPanel
      title="下一步建议"
      sub="依据最近课堂记录、作业与检测情况，给出下一节课的具体调整"
      :output="output"
      :loading="loading"
      action-text="生成下一步建议"
      hint="点击生成：系统会先算出班级共性问题与薄弱知识点，再给出下节课的具体动作。"
      @generate="runDiagnosis"
    />

    <div class="grid-2">
      <section class="card">
        <div class="card-head">
          <div class="card-title">最近课堂记录</div>
          <span class="card-sub">共 {{ classRecords.length }} 条</span>
        </div>
        <div class="card-body">
          <div v-for="r in records" :key="r.id" class="rec">
            <div class="rec-top">
              <span class="rec-title">{{ r.lesson }}</span>
              <span class="rec-date">{{ r.date }}</span>
            </div>
            <div class="rec-body">{{ r.summary }}</div>
            <div v-if="r.issues.length" class="rec-issues">
              <IconWarn class="warn-icon" />
              <span>{{ r.issues.join("；") }}</span>
            </div>
            <div v-if="r.followUps.length" class="rec-follow">
              待办：{{ r.followUps.join("；") }}
            </div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div class="card-title">作业情况</div>
          <span class="card-sub">最近 {{ homework.length }} 次</span>
        </div>
        <div class="card-body">
          <div v-for="h in homework" :key="h.id" class="rec">
            <div class="rec-top">
              <span class="rec-title">{{ h.title }}</span>
              <span class="rec-date">{{ h.date }}</span>
            </div>
            <div class="hw-stats">
              <span>提交 {{ h.submitted }}/{{ h.assigned }}</span>
              <span>平均 {{ h.avgScore }}/{{ h.fullScore }}</span>
              <span v-if="h.missing.length" class="hw-miss">未交 {{ h.missing.length }} 人</span>
            </div>
            <div class="rec-body">{{ h.comments }}</div>
          </div>
        </div>
      </section>
    </div>

    <div class="grid-2">
      <section class="card">
        <div class="card-head">
          <div class="card-title">需要支持</div>
          <span class="card-sub">{{ support.length }} 人</span>
        </div>
        <div class="card-body">
          <div v-if="!support.length" class="empty">当前没有需要特别支持的学生</div>
          <div v-for="s in support" v-else :key="s.id" class="stu">
            <div class="stu-top">
              <span class="stu-name">{{ s.name }}</span>
              <span class="stu-no">{{ s.no }}</span>
            </div>
            <div class="stu-tags">
              <span v-for="t in s.tags" :key="t" class="tag tag-amber">{{ t }}</span>
              <span class="tag tag-gray">得分率 {{ s.avgRate.toFixed(1) }}%</span>
            </div>
            <div class="stu-extra">
              出勤 {{ s.attendance.rate.toFixed(1) }}% · 近三次变化
              {{ s.trend >= 0 ? "+" : "" }}{{ s.trend }} · 剩余课时 {{ s.hours.remain }}
            </div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div class="card-title">班级薄弱知识点</div>
          <span class="card-sub">按掌握度升序</span>
        </div>
        <div class="card-body">
          <KpBar
            v-for="k in kps.slice(0, 5)"
            :key="k.id"
            :name="k.name"
            :value="k.value"
            :meta="k.parent"
          />
        </div>
      </section>
    </div>

    <section class="card">
      <div class="card-head">
        <div class="card-title">可以拓展</div>
        <span class="card-sub">{{ top.length }} 人 · 建议给拓展题而非重复刷基础</span>
      </div>
      <div class="card-body">
        <div class="chips">
          <span v-for="s in top" :key="s.id" class="chip">
            {{ s.name }}
            <em>{{ s.avgRate.toFixed(0) }}%</em>
          </span>
        </div>
      </div>
    </section>

    <p class="foot-note">
      名单与标记均来自本地记录，仅用于教学动作，不作为学生能力或性格评判。标记者：{{ reasonOf(support[0]?.tags || []) }} 等。
    </p>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 12px;
}

.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.unit-name {
  font-size: 17px;
  font-weight: 600;
}

.unit-meta {
  margin-top: 3px;
  font-size: 12px;
  color: var(--c-text-3);
}

.track {
  height: 8px;
  margin: 14px 0;
  overflow: hidden;
  background: #eef1f4;
  border-radius: 4px;
}

.track-fill {
  height: 100%;
  background: var(--c-primary);
  border-radius: 4px;
}

.lesson-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.lesson-box {
  flex: 1;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid var(--c-border);
  border-radius: 8px;
}

.lesson-box.next {
  background: var(--c-primary-soft);
  border-color: var(--c-primary-line);
}

.lesson-tag {
  font-size: 11px;
  color: var(--c-text-3);
}

.lesson-tag.next-tag {
  color: var(--c-primary);
}

.lesson-title {
  margin-top: 2px;
  font-size: 13px;
  font-weight: 500;
}

.lesson-date {
  font-size: 11px;
  color: var(--c-text-3);
}

.arrow {
  flex-shrink: 0;
  color: var(--c-text-3);
}

.goal + .goal {
  padding-top: 11px;
  margin-top: 11px;
  border-top: 1px dashed var(--c-border);
}

.goal-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.goal-name {
  font-size: 13px;
  font-weight: 500;
}

.goal-ev {
  margin-top: 3px;
  font-size: 12px;
  color: var(--c-text-3);
}

.rec + .rec {
  padding-top: 12px;
  margin-top: 12px;
  border-top: 1px dashed var(--c-border);
}

.rec-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.rec-title {
  font-size: 13px;
  font-weight: 500;
}

.rec-date {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--c-text-3);
}

.rec-body {
  margin-top: 5px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--c-text-2);
}

.rec-issues {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  margin-top: 6px;
  font-size: 12px;
  color: #b45309;
}

.warn-icon {
  flex-shrink: 0;
  margin-top: 2px;
}

.rec-follow {
  margin-top: 5px;
  font-size: 12px;
  color: var(--c-primary-dark);
}

.hw-stats {
  display: flex;
  gap: 14px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--c-text-2);
}

.hw-miss {
  color: var(--c-danger);
}

.stu + .stu {
  padding-top: 11px;
  margin-top: 11px;
  border-top: 1px dashed var(--c-border);
}

.stu-top {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.stu-name {
  font-size: 13px;
  font-weight: 500;
}

.stu-no {
  font-size: 11px;
  color: var(--c-text-3);
}

.stu-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.stu-extra {
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--c-text-3);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  font-size: 12.5px;
  background: #f6f8fa;
  border: 1px solid var(--c-border);
  border-radius: 999px;
}

.chip em {
  font-size: 11px;
  font-style: normal;
  color: var(--c-text-3);
}

.foot-note {
  margin: 0;
  font-size: 11.5px;
  color: var(--c-text-3);
}

@media (max-width: 1200px) {
  .metrics {
    grid-template-columns: repeat(3, 1fr);
  }

  .grid-2 {
    grid-template-columns: 1fr;
  }
}
</style>
