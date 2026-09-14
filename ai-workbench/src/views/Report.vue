<script setup lang="ts">
import { computed, ref, watch } from "vue";
import IconPrinter from "~icons/ep/printer";
import AiPanel from "@/components/AiPanel.vue";
import KpBar from "@/components/KpBar.vue";
import * as engine from "@/ai/engine";
import { genReportNarrative, type AiOutput } from "@/ai/generators";
import { klass, students } from "@/workbench-data";
import { currentUser } from "@/session";

const me = currentUser();
const isAdmin = me.role === "admin";

const studentId = ref(students.value[0].id);
const mode = ref<"teacher" | "campus">("teacher");
const output = ref<AiOutput | null>(null);
const loading = ref(false);

const ins = computed(() => engine.studentInsight(studentId.value));
const support = engine.supportStudents();

watch([studentId, mode], () => {
  output.value = null;
});

async function run() {
  loading.value = true;
  try {
    output.value = await genReportNarrative(studentId.value, mode.value);
  } finally {
    loading.value = false;
  }
}

function printReport() {
  window.print();
}
</script>

<template>
  <div class="page">
    <section class="card no-print">
      <div class="card-head">
        <div class="card-title">选择学员与报告版式</div>
        <div class="tools">
          <el-select v-model="studentId" size="small" filterable style="width: 180px">
            <el-option
              v-for="s in students"
              :key="s.id"
              :label="`${s.name}（${s.no}）`"
              :value="s.id"
            />
          </el-select>
          <el-radio-group v-model="mode" size="small">
            <el-radio-button value="teacher">教师版（不含金额）</el-radio-button>
            <el-radio-button value="campus" :disabled="!isAdmin">教务版（含课时建议）</el-radio-button>
          </el-radio-group>
        </div>
      </div>
      <div class="card-body">
        <div v-if="!isAdmin && mode === 'teacher'" class="perm-hint">
          当前登录角色为教师，仅可生成教师版报告；教务版（含课时与续课建议）需教务/校长权限。
        </div>
        <div class="quick">
          <span class="quick-k">需关注学员</span>
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

    <section v-if="ins" class="card print-area">
      <div class="card-head">
        <div class="card-title">
          学情报告 · {{ ins.student.name }}
          <span class="tag" :class="mode === 'campus' ? 'tag-blue' : 'tag-gray'">
            {{ mode === "campus" ? "教务版" : "教师版" }}
          </span>
        </div>
        <button class="ghost-btn no-print" type="button" @click="printReport">
          <IconPrinter />
          打印 / 另存为 PDF
        </button>
      </div>
      <div class="card-body">
        <div class="report-head">
          <div>
            <div class="rh-name">{{ ins.student.name }}</div>
            <div class="rh-sub">
              学号 {{ ins.student.no }} · {{ klass.name }} · 建档 {{ ins.student.hours.enrollDate }}
            </div>
          </div>
          <div class="rh-side">
            <div>报告日期 {{ new Date().toISOString().slice(0, 10) }}</div>
            <div>数据版本 {{ dataVersion || "未知" }}</div>
          </div>
        </div>

        <div class="overview">
          <div class="metric">
            <div class="metric-label">出勤率</div>
            <div class="metric-value">{{ ins.student.attendance.rate.toFixed(1) }}<small>%</small></div>
          </div>
          <div class="metric">
            <div class="metric-label">最近检测得分率</div>
            <div class="metric-value">{{ ins.latest?.rate.toFixed(1) }}<small>%</small></div>
          </div>
          <div class="metric">
            <div class="metric-label">与班级平均差</div>
            <div class="metric-value">
              {{ ins.gapToClass >= 0 ? "+" : "" }}{{ ins.gapToClass.toFixed(1) }}<small>pp</small>
            </div>
          </div>
          <div class="metric">
            <div class="metric-label">近三次变化</div>
            <div class="metric-value">
              {{ ins.trend >= 0 ? "+" : "" }}{{ ins.trend }}<small>pp</small>
            </div>
          </div>
        </div>

        <div class="grid-2">
          <div>
            <div class="sec-title">学习情况</div>
            <div class="kv">
              <span>考勤</span>
              <span>
                应到 {{ ins.student.attendance.total }} 次，缺勤 {{ ins.student.attendance.absent }} 次，
                迟到 {{ ins.student.attendance.late }} 次
              </span>
            </div>
            <div class="kv">
              <span>成绩</span>
              <span>
                <em v-for="e in ins.student.exams" :key="e.name">{{ e.name }} {{ e.rate }}%</em>
              </span>
            </div>
            <div class="kv">
              <span>课时</span>
              <span>
                已购 {{ ins.student.hours.total }}，剩余 {{ ins.student.hours.remain }} 课时{{
                  mode === "teacher" ? "（教师版不展示金额）" : ""
                }}
              </span>
            </div>
          </div>

          <div>
            <div class="sec-title">日常表现（课堂评价）</div>
            <div class="score-row">
              <div class="score-item">
                <div class="score-v">{{ ins.student.eval.focus }}</div>
                <div class="score-k">专注度</div>
              </div>
              <div class="score-item">
                <div class="score-v">{{ ins.student.eval.participation }}</div>
                <div class="score-k">参与度</div>
              </div>
              <div class="score-item">
                <div class="score-v">{{ ins.student.eval.homework }}</div>
                <div class="score-k">作业完成</div>
              </div>
              <div class="score-item">
                <div class="score-v">{{ ins.student.eval.mastery }}</div>
                <div class="score-k">掌握自评</div>
              </div>
            </div>
            <div class="eval-note">教师观察：{{ ins.student.eval.note }}</div>
          </div>
        </div>

        <div class="sec-title" style="margin-top: 18px">知识点掌握（本人 vs 班级）</div>
        <div class="kp-grid">
          <KpBar
            v-for="k in ins.kpWeak"
            :key="k.id"
            :name="k.name"
            :value="k.value"
            :class-value="k.classValue"
          />
        </div>
      </div>
    </section>

    <AiPanel
      class="no-print"
      title="AI 学情报告叙述"
      sub="把上面的数据组织成可直接交付的报告文字"
      :output="output"
      :loading="loading"
      action-text="生成报告叙述"
      hint="数字全部来自本地指标；教师版不含金额，教务版追加课时与续课建议。"
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

.tools {
  display: flex;
  align-items: center;
  gap: 10px;
}

.perm-hint {
  padding: 8px 12px;
  margin-bottom: 10px;
  font-size: 12px;
  color: #b45309;
  background: var(--c-warn-soft);
  border-radius: 8px;
}

.quick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
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

.ghost-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 11px;
  font-family: inherit;
  font-size: 12px;
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

.report-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding-bottom: 14px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--c-border);
}

.rh-name {
  font-size: 18px;
  font-weight: 600;
}

.rh-sub {
  margin-top: 3px;
  font-size: 12px;
  color: var(--c-text-3);
}

.rh-side {
  font-size: 11.5px;
  color: var(--c-text-3);
  text-align: right;
}

.overview {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 18px;
}

.grid-2 {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 24px;
}

.kv {
  display: flex;
  gap: 10px;
  padding: 6px 0;
  font-size: 12.5px;
}

.kv > span:first-child {
  flex-shrink: 0;
  width: 44px;
  color: var(--c-text-3);
}

.kv em {
  font-style: normal;
}

.kv em + em::before {
  content: "；";
}

.score-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.score-item {
  padding: 8px 4px;
  text-align: center;
  background: #f8fafc;
  border-radius: 8px;
}

.score-v {
  font-size: 17px;
  font-weight: 600;
  color: var(--c-primary);
}

.score-k {
  margin-top: 1px;
  font-size: 11px;
  color: var(--c-text-3);
}

.eval-note {
  padding: 9px 11px;
  margin-top: 10px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--c-text-2);
  background: #f8fafc;
  border-radius: 8px;
}

.kp-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px 26px;
}

@media print {
  .page {
    gap: 0;
  }

  .print-area {
    border: none;
  }
}

@media (max-width: 1200px) {
  .overview,
  .grid-2,
  .kp-grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
