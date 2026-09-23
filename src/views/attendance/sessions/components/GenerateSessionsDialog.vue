<script setup lang="ts">
// 生成本学期课次 · 三步弹窗（选学期 → 预览 → 确认）
//
// 拍板结论 3：手工触发 + 可预览；预览与执行共用后端同一展开函数，保证「预览到的 = 将生成的」。
// 幂等（Q1）：已存在课次跳过，确认后返回 { created, skipped, backfilled, report_unmatched }。
import { ref, computed, watch } from "vue";
import { ElMessage } from "element-plus";
import { getAllTerms } from "@/api/attendance";
import { previewSessions, generateSessions } from "@/api/sessions";

defineOptions({
  name: "GenerateSessionsDialog"
});

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  /** 生成成功：回传学期起始日期字符串，父级据此跳到"确认后所在周" */
  (e: "generated", startDate: string): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: v => emit("update:modelValue", v)
});

const step = ref(0);
const termOptions = ref<any[]>([]);
const termId = ref<number | null>(null);
const preview = ref<any>(null);
const loading = ref(false);
const generating = ref(false);

/** 打开弹窗时重置并加载学期 */
watch(
  () => props.modelValue,
  open => {
    if (!open) return;
    step.value = 0;
    termId.value = null;
    preview.value = null;
    getAllTerms().then((res: any) => {
      if (res.success) {
        termOptions.value = res.data;
        const cur = res.data.find((t: any) => t.is_current);
        termId.value = cur ? cur.id : (res.data[0]?.id ?? null);
      }
    });
  }
);

function close() {
  visible.value = false;
}

async function doPreview() {
  if (!termId.value) {
    ElMessage.warning("请选择学期");
    return;
  }
  loading.value = true;
  try {
    const res: any = await previewSessions({ term_id: termId.value });
    if (res.success) {
      preview.value = res.data;
      step.value = 1;
    }
  } finally {
    loading.value = false;
  }
}

async function doGenerate() {
  if (!termId.value) return;
  generating.value = true;
  try {
    const res: any = await generateSessions({ term_id: termId.value });
    if (res.success) {
      const d = res.data;
      ElMessage.success(
        `生成完成：新增 ${d.created} 节，跳过（已存在）${d.skipped} 节，回填 ${d.backfilled} 条`
      );
      emit("generated", preview.value?.range?.start || "");
      visible.value = false;
    }
  } finally {
    generating.value = false;
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="生成本学期课次"
    width="min(620px, 100vw - 32px)"
    :close-on-click-modal="false"
  >
    <el-steps :active="step" align-center finish-status="success" class="mb-5">
      <el-step title="选择学期" />
      <el-step title="预览" />
      <el-step title="确认" />
    </el-steps>

    <!-- Step ① 选择学期 -->
    <div v-if="step === 0">
      <el-form label-width="80px">
        <el-form-item label="学期">
          <el-select v-model="termId" placeholder="请选择学期" class="!w-full">
            <el-option
              v-for="t in termOptions"
              :key="t.id"
              :label="`${t.name}${t.is_current ? '（当前学期）' : ''}`"
              :value="t.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <p class="page-hint">
        将按该学期内的排课模板展开为每一节具体课次；已存在的课次会被跳过，不会覆盖已录考勤/课评。
      </p>
    </div>

    <!-- Step ② 预览 -->
    <div v-if="step === 1 && preview">
      <div class="stat-grid mb-4">
        <div class="stat-card stat-card--brand">
          <div class="stat-card__top">
            <span class="stat-card__label">预计新增课次</span>
          </div>
          <div class="metric-value">{{ preview.to_create }}</div>
        </div>
        <div class="stat-card stat-card--warning">
          <div class="stat-card__top">
            <span class="stat-card__label">已存在（跳过）</span>
          </div>
          <div class="metric-value">{{ preview.already_exists }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__top">
            <span class="stat-card__label">参与班级</span>
          </div>
          <div class="metric-value">{{ preview.classes }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__top">
            <span class="stat-card__label">排课模板</span>
          </div>
          <div class="metric-value">{{ preview.templates }}</div>
        </div>
      </div>

      <el-descriptions :column="1" border size="small">
        <el-descriptions-item label="学期范围">
          {{ preview.range?.start }} ~ {{ preview.range?.end }}
        </el-descriptions-item>
      </el-descriptions>

      <el-alert
        v-if="preview.missing_period_times?.length"
        type="warning"
        :closable="false"
        class="mt-3"
        :title="`第 ${preview.missing_period_times
          .map((m: any) => m.period)
          .join('、')} 节未配置节次时间 → 对应课次起止时间将为空`"
      />
    </div>

    <!-- Step ③ 确认 -->
    <div v-if="step === 2">
      <el-alert
        type="info"
        :closable="false"
        title="确认后将写入本学期课次，并顺带对历史考勤 / 课消 / 课评执行一次课次回填。"
        description="该操作幂等：重复执行不会重复生成，也不会覆盖已有数据。"
      />
    </div>

    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button v-if="step === 1" @click="step = 0">上一步</el-button>
      <el-button
        v-if="step === 0"
        type="primary"
        :loading="loading"
        @click="doPreview"
      >
        预览
      </el-button>
      <el-button v-else-if="step === 1" type="primary" @click="step = 2">
        下一步
      </el-button>
      <el-button
        v-else
        type="primary"
        :loading="generating"
        @click="doGenerate"
      >
        确认生成
      </el-button>
    </template>
  </el-dialog>
</template>
