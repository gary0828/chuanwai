<script setup lang="ts">
// 新增课次弹窗（★ 2026-09-30 校区反馈②：调休后补课要能「加到某一天」）
//
// 入口：周课表格子上点「＋」，日期与节次由格子带入（进来仍可改）。
// 后端复用既有 POST /sessions —— 该接口早已存在且校验完整，此前只是前端没有入口。
// 写法对照同目录的 GenerateSessionsDialog（弹窗骨架 / el-form / 提示语风格保持一致）。
import { ref, computed, watch } from "vue";
import { ElMessage } from "element-plus";
import { getAllClasses, getAllCourses, getUserList } from "@/api/attendance";
import { createSession } from "@/api/sessions";
import { getRoomList } from "@/api/rooms";

defineOptions({
  name: "AddSessionDialog"
});

const props = defineProps<{
  modelValue: boolean;
  /** 格子带入的日期（YYYY-MM-DD） */
  presetDate?: string;
  /** 格子带入的节次 */
  presetPeriod?: number | null;
  /** 可选节次列表（复用父级已加载的课表节次，保证与周视图口径一致） */
  periodOptions?: any[];
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  /** 新增成功：父级据此刷新周课表 */
  (e: "created"): void;
}>();

const visible = computed({
  get: () => props.modelValue,
  set: v => emit("update:modelValue", v)
});

const formRef = ref<any>(null);
const submitting = ref(false);
const classOptions = ref<any[]>([]);
const courseOptions = ref<any[]>([]);
const teacherOptions = ref<any[]>([]);
const roomOptions = ref<any[]>([]);

const form = ref({
  class_id: null as number | null,
  course_id: null as number | null,
  teacher_id: null as number | null,
  room_id: null as number | null,
  session_date: "",
  period: null as number | null,
  origin: "补课"
});

const rules = {
  class_id: [{ required: true, message: "请选择班级", trigger: "change" }],
  course_id: [{ required: true, message: "请选择课程", trigger: "change" }],
  session_date: [{ required: true, message: "请选择日期", trigger: "change" }],
  period: [{ required: true, message: "请选择节次", trigger: "change" }]
};

/** 打开时重置表单（带入格子点的日期/节次）并加载下拉 */
watch(
  () => props.modelValue,
  async open => {
    if (!open) return;
    form.value = {
      class_id: null,
      course_id: null,
      teacher_id: null,
      room_id: null,
      session_date: props.presetDate || "",
      period: props.presetPeriod ?? null,
      origin: "补课"
    };
    const jobs: Promise<any>[] = [
      getAllClasses().then((res: any) => {
        if (res.success) classOptions.value = res.data;
      }),
      getAllCourses().then((res: any) => {
        if (res.success) courseOptions.value = res.data;
      }),
      getUserList({ role: "teacher", pageSize: 100 }).then((res: any) => {
        if (res.success) teacherOptions.value = res.data.list;
      }),
      getRoomList().then((res: any) => {
        if (res.success) roomOptions.value = res.data || [];
      })
    ];
    await Promise.all(jobs);
    formRef.value?.clearValidate();
  }
);

async function submit() {
  const passed = await formRef.value?.validate().catch(() => false);
  if (!passed) return;
  submitting.value = true;
  try {
    const res: any = await createSession({
      class_id: form.value.class_id,
      course_id: form.value.course_id,
      teacher_id: form.value.teacher_id || undefined,
      room_id: form.value.room_id || undefined,
      session_date: form.value.session_date,
      period: form.value.period,
      origin: form.value.origin
    });
    if (res.success) {
      ElMessage.success("课次已添加，周课表已刷新");
      emit("created");
      visible.value = false;
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="新增课次"
    width="min(520px, 100vw - 32px)"
    :close-on-click-modal="false"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="82px">
      <el-form-item label="班级" prop="class_id">
        <el-select
          v-model="form.class_id"
          placeholder="请选择班级"
          filterable
          class="!w-full"
        >
          <el-option
            v-for="c in classOptions"
            :key="c.id"
            :label="c.name"
            :value="c.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="课程" prop="course_id">
        <el-select
          v-model="form.course_id"
          placeholder="请选择课程"
          filterable
          class="!w-full"
        >
          <el-option
            v-for="c in courseOptions"
            :key="c.id"
            :label="c.name"
            :value="c.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="上课日期" prop="session_date">
        <el-date-picker
          v-model="form.session_date"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选择日期"
          class="!w-full"
        />
      </el-form-item>

      <el-form-item label="节次" prop="period">
        <el-select v-model="form.period" placeholder="请选择节次" class="!w-full">
          <el-option
            v-for="p in periodOptions || []"
            :key="p.period"
            :label="
              p.start_time
                ? `${p.label}（${p.start_time}-${p.end_time}）`
                : p.label
            "
            :value="p.period"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="授课教师">
        <el-select
          v-model="form.teacher_id"
          placeholder="可不填，后续在课次详情里指定"
          clearable
          filterable
          class="!w-full"
        >
          <el-option
            v-for="t in teacherOptions"
            :key="t.id"
            :label="t.name"
            :value="t.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="上课教室">
        <el-select
          v-model="form.room_id"
          placeholder="可不填，后续在课次详情里指定"
          clearable
          filterable
          class="!w-full"
        >
          <el-option
            v-for="r in roomOptions"
            :key="r.id"
            :label="r.capacity ? `${r.name}（${r.capacity}人）` : r.name"
            :value="r.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="来源">
        <el-radio-group v-model="form.origin">
          <el-radio value="补课">补课</el-radio>
          <el-radio value="手工">手工加课</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>

    <p class="page-hint">
      用于「调休后补课加到某一天」与临时加课；添加后课次立刻出现在周课表对应格子，
      可正常点名、挪课与停课。
    </p>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">
        确认添加
      </el-button>
    </template>
  </el-dialog>
</template>
