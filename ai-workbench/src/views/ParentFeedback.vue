<script setup lang="ts">
import { computed, ref, watch } from "vue";
import IconCopy from "~icons/ep/copy-document";
import IconInfo from "~icons/ep/info-filled";
import AiPanel from "@/components/AiPanel.vue";
import * as engine from "@/ai/engine";
import { genParentFeedback, type AiOutput } from "@/ai/generators";
import { students } from "@/workbench-data";

const studentId = ref(students.value[0].id);
const output = ref<AiOutput | null>(null);
const loading = ref(false);
const copied = ref(false);

const ins = computed(() => engine.studentInsight(studentId.value));
const support = engine.supportStudents();

watch(studentId, () => {
  output.value = null;
});

async function run() {
  loading.value = true;
  try {
    output.value = await genParentFeedback(studentId.value);
  } finally {
    loading.value = false;
  }
}

async function copyText() {
  if (!output.value) return;
  try {
    await navigator.clipboard.writeText(output.value.text);
    copied.value = true;
    window.setTimeout(() => (copied.value = false), 1600);
  } catch {
    copied.value = false;
  }
}

function printIt() {
  window.print();
}
</script>

<template>
  <div class="page">
    <section class="card">
      <div class="card-head">
        <div class="card-title">选择学员</div>
        <div class="tools">
          <el-select v-model="studentId" size="small" filterable style="width: 180px">
            <el-option
              v-for="s in students"
              :key="s.id"
              :label="`${s.name}（${s.no}）`"
              :value="s.id"
            />
          </el-select>
        </div>
      </div>
      <div class="card-body">
        <div class="notice">
          <IconInfo class="notice-icon" />
          <div>
            <div class="notice-t">本模块只生成文案与可打印文件，系统不提供任何自动发送通道。</div>
            <div class="notice-d">
              文案中不包含剩余课时、金额、家长电话等任何敏感信息，只陈述学习事实。生成后由教师线下与家长沟通。
            </div>
          </div>
        </div>

        <div class="quick">
          <span class="quick-k">需跟进学员</span>
          <span
            v-for="s in support.slice(0, 5)"
            :key="s.id"
            class="quick-item"
            :class="{ on: s.id === studentId }"
            @click="studentId = s.id"
          >
            {{ s.name }}
          </span>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div class="card-title">本次沟通要点</div>
        <span class="card-sub">来源：考勤 / 成绩 / 课堂评价记录</span>
      </div>
      <div class="card-body">
        <div v-if="ins" class="points">
          <div class="point">
            <span class="point-k">最近检测</span>
            <span>{{ ins.latest?.name }} · 得分率 {{ ins.latest?.rate.toFixed(1) }}%</span>
          </div>
          <div class="point">
            <span class="point-k">需要加强</span>
            <span>{{ ins.kpWeak.slice(0, 2).map(k => k.name).join("、") }}</span>
          </div>
          <div class="point">
            <span class="point-k">出勤</span>
            <span>出勤率 {{ ins.student.attendance.rate.toFixed(1) }}%，缺勤 {{ ins.student.attendance.absent }} 次</span>
          </div>
          <div class="point">
            <span class="point-k">课堂表现</span>
            <span>{{ ins.student.eval.note }}</span>
          </div>
        </div>
        <div class="excluded">
          按机构要求，家长沟通内容不出现剩余课时与任何金额信息。
        </div>
      </div>
    </section>

    <AiPanel
      title="AI 家长反馈文案"
      sub="按「客观陈述 → 具体表现 → 我们怎么做 → 需要家长配合」组织"
      :output="output"
      :loading="loading"
      action-text="生成沟通文案"
      hint="只讲事实，不做能力或性格评价；措辞可直接复制后微调。"
      @generate="run"
    />

    <section v-if="output" class="card no-print">
      <div class="card-head">
        <div class="card-title">交付方式</div>
      </div>
      <div class="card-body">
        <div class="deliver">
          <button class="ghost-btn" type="button" @click="copyText">
            <IconCopy />
            {{ copied ? "已复制文案" : "复制全文" }}
          </button>
          <button class="ghost-btn" type="button" @click="printIt">打印 / 另存为 PDF</button>
          <span class="deliver-hint">
            导出后由教师自行通过线下渠道发送；系统不会代发。
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

.tools {
  display: flex;
  align-items: center;
  gap: 10px;
}

.notice {
  display: flex;
  gap: 9px;
  padding: 11px 13px;
  background: var(--c-info-soft);
  border: 1px solid #bae6fd;
  border-radius: 8px;
}

.notice-icon {
  flex-shrink: 0;
  margin-top: 2px;
  font-size: 14px;
  color: #0e7490;
}

.notice-t {
  font-size: 12.5px;
  font-weight: 500;
  color: #0e7490;
}

.notice-d {
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--c-text-2);
}

.quick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

.quick-k {
  font-size: 12px;
  color: var(--c-text-3);
}

.quick-item {
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
  background: #f6f8fa;
  border: 1px solid var(--c-border);
  border-radius: 999px;
}

.quick-item.on {
  color: var(--c-primary-dark);
  background: var(--c-primary-soft);
  border-color: var(--c-primary-line);
}

.points {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px 24px;
}

.point {
  display: flex;
  gap: 10px;
  font-size: 12.5px;
  line-height: 1.7;
}

.point-k {
  flex-shrink: 0;
  width: 60px;
  color: var(--c-text-3);
}

.excluded {
  padding: 8px 12px;
  margin-top: 14px;
  font-size: 12px;
  color: #b45309;
  background: var(--c-warn-soft);
  border-radius: 8px;
}

.ghost-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 12px;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--c-text-2);
  cursor: pointer;
  background: #fff;
  border: 1px solid var(--c-border-strong);
  border-radius: 7px;
}

.ghost-btn:hover {
  color: var(--c-primary-dark);
  border-color: var(--c-primary-line);
  background: var(--c-primary-soft);
}

.deliver {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.deliver-hint {
  font-size: 12px;
  color: var(--c-text-3);
}

@media (max-width: 1200px) {
  .points {
    grid-template-columns: 1fr;
  }
}
</style>
