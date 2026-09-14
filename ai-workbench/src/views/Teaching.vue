<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import IconPlus from "~icons/ep/plus";
import IconRefresh from "~icons/ep/refresh";
import IconUser from "~icons/ep/user";
import AiPanel from "@/components/AiPanel.vue";
import { genTeachingFlow, type AiOutput } from "@/ai/generators";
import { students, unit } from "@/workbench-data";

const steps = ref([
  { id: 1, name: "错题回顾", min: 5, goal: "把注意力拉回上次失分点", done: true },
  { id: 2, name: "性质再认识", min: 10, goal: "说清条件与结论，区分正反用法", done: true },
  { id: 3, name: "变式练习", min: 15, goal: "能在新情境中主动作垂线", done: false },
  { id: 4, name: "辅助线入门", min: 10, goal: "记住倍长中线三步走", done: false },
  { id: 5, name: "小结与布置", min: 5, goal: "学生能复述辅助线触发信号", done: false }
]);

const output = ref<AiOutput | null>(null);
const loading = ref(false);

/* 倒计时 */
const remain = ref(0);
const running = ref(false);
let timer: number | undefined;

const clock = computed(() => {
  const m = Math.floor(Math.max(0, remain.value) / 60);
  const s = Math.max(0, remain.value) % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
});

function startTimer(min: number) {
  stopTimer();
  remain.value = min * 60;
  running.value = true;
  timer = window.setInterval(() => {
    remain.value -= 1;
    if (remain.value <= 0) stopTimer();
  }, 1000);
}

function stopTimer() {
  if (timer) window.clearInterval(timer);
  timer = undefined;
  running.value = false;
}

onUnmounted(stopTimer);

/* 随机点名 */
const picked = ref("");
function pickStudent() {
  if (!students.value.length) return;
  const s = students.value[Math.floor(Math.random() * students.value.length)];
  picked.value = `${s.name}（${s.no}）`;
}

/* 快速标记 */
const markStudent = ref<number | null>(null);
const markTag = ref("典型问题");
const markNote = ref("");
const marks = ref<{ id: number; student: string; tag: string; note: string }[]>([
  {
    id: 1,
    student: "郑一鸣",
    tag: "关注学生",
    note: "变式题第 2 题卡住，未想到作垂线"
  }
]);

function addMark() {
  const s = students.value.find(x => x.id === markStudent.value);
  if (!s) return;
  marks.value.unshift({
    id: Date.now(),
    student: s.name,
    tag: markTag.value,
    note: markNote.value || "—"
  });
  markNote.value = "";
  markStudent.value = null;
}

async function run() {
  loading.value = true;
  try {
    output.value = await genTeachingFlow();
  } finally {
    loading.value = false;
  }
}

const doneCount = computed(() => steps.value.filter(s => s.done).length);
</script>

<template>
  <div class="page">
    <section class="card">
      <div class="card-head">
        <div class="card-title">课堂环节卡</div>
        <span class="card-sub">
          {{ unit.no }}{{ unit.name }} · 第 {{ unit.next.no }} 课时 · 已完成
          {{ doneCount }}/{{ steps.length }} 环节
        </span>
      </div>
      <div class="card-body">
        <div v-for="s in steps" :key="s.id" class="step" :class="{ done: s.done }">
          <el-checkbox v-model="s.done" />
          <div class="step-main">
            <div class="step-name">{{ s.name }}</div>
            <div class="step-goal">{{ s.goal }}</div>
          </div>
          <div class="step-min">{{ s.min }} 分钟</div>
          <button class="mini-btn" type="button" @click="startTimer(s.min)">计时</button>
        </div>
      </div>
    </section>

    <div class="grid-3">
      <section class="card">
        <div class="card-head"><div class="card-title">倒计时</div></div>
        <div class="card-body center">
          <div class="clock" :class="{ running }">{{ clock }}</div>
          <div class="btn-row">
            <el-button size="small" type="primary" @click="startTimer(12)">12 分钟</el-button>
            <el-button size="small" @click="startTimer(5)">5 分钟</el-button>
            <el-button size="small" @click="stopTimer">停止</el-button>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><div class="card-title">随机点名</div></div>
        <div class="card-body center">
          <div class="picked">
            <IconUser v-if="!picked" class="picked-icon" />
            <span v-if="picked">{{ picked }}</span>
            <span v-else class="picked-empty">点击下方按钮抽取</span>
          </div>
          <el-button size="small" @click="pickStudent">
            <template #icon><IconRefresh /></template>
            抽一位
          </el-button>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div class="card-title">快速标记</div>
          <span class="card-sub">自动进入学情与建议</span>
        </div>
        <div class="card-body">
          <div class="mark-form">
            <el-select v-model="markStudent" placeholder="选择学生" size="small" filterable>
              <el-option v-for="s in students" :key="s.id" :label="s.name" :value="s.id" />
            </el-select>
            <el-select v-model="markTag" size="small">
              <el-option label="典型问题" value="典型问题" />
              <el-option label="关注学生" value="关注学生" />
              <el-option label="本课调整" value="本课调整" />
            </el-select>
          </div>
          <el-input
            v-model="markNote"
            size="small"
            placeholder="一句话说明（可选）"
            style="margin-top: 8px"
          />
          <el-button
            size="small"
            type="primary"
            style="margin-top: 8px; width: 100%"
            @click="addMark"
          >
            <template #icon><IconPlus /></template>
            记录
          </el-button>
        </div>
      </section>
    </div>

    <section class="card">
      <div class="card-head">
        <div class="card-title">本课标记记录</div>
        <span class="card-sub">{{ marks.length }} 条 · 课后自动汇总到评价与学情</span>
      </div>
      <div class="card-body">
        <div v-if="!marks.length" class="empty">本课还没有标记，可随时记录。</div>
        <div v-for="m in marks" v-else :key="m.id" class="mark">
          <span class="mark-stu">{{ m.student }}</span>
          <span class="tag" :class="m.tag === '典型问题' ? 'tag-amber' : m.tag === '关注学生' ? 'tag-red' : 'tag-blue'">
            {{ m.tag }}
          </span>
          <span class="mark-note">{{ m.note }}</span>
        </div>
      </div>
    </section>

    <AiPanel
      title="AI 授课流程"
      sub="按课时输出环节卡、快捷工具与本课观察重点"
      :output="output"
      :loading="loading"
      action-text="生成授课流程"
      hint="授课流程依附当前课时生成，不单独占导航；课堂结束后标记会回填到评价与学情。"
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

.grid-3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.step {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px dashed var(--c-border);
}

.step:last-child {
  border-bottom: none;
}

.step-main {
  flex: 1;
  min-width: 0;
}

.step-name {
  font-size: 13px;
  font-weight: 500;
}

.step.done .step-name {
  color: var(--c-text-3);
  text-decoration: line-through;
}

.step-goal {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--c-text-3);
}

.step-min {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--c-text-2);
}

.mini-btn {
  flex-shrink: 0;
  height: 24px;
  padding: 0 9px;
  font-family: inherit;
  font-size: 11.5px;
  color: var(--c-primary-dark);
  cursor: pointer;
  background: var(--c-primary-soft);
  border: 1px solid var(--c-primary-line);
  border-radius: 6px;
}

.center {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 126px;
}

.clock {
  font-size: 30px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--c-text);
}

.clock.running {
  color: var(--c-primary);
}

.btn-row {
  display: flex;
  gap: 6px;
}

.picked {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  font-size: 15px;
  font-weight: 500;
}

.picked-icon {
  font-size: 20px;
  color: var(--c-text-3);
}

.picked-empty {
  font-size: 12.5px;
  font-weight: 400;
  color: var(--c-text-3);
}

.mark-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.mark {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  font-size: 12.5px;
  border-bottom: 1px dashed var(--c-border);
}

.mark:last-child {
  border-bottom: none;
}

.mark-stu {
  flex-shrink: 0;
  font-weight: 500;
}

.mark-note {
  color: var(--c-text-2);
}

@media (max-width: 1200px) {
  .grid-3 {
    grid-template-columns: 1fr;
  }
}
</style>
