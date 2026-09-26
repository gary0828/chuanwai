<script setup lang="ts">
import EpWarning from "~icons/ep/warning";
import { ref, reactive, computed, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  getAllSchedules,
  getAllClasses,
  getAllCourses,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  createAdjustment
} from "@/api/attendance";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "Schedules"
});

const loading = ref(false);
const classId = ref<number | null>(null);
const classOptions = ref<any[]>([]);
const courseOptions = ref<any[]>([]);
const allRows = ref<any[]>([]);

const weekDays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const periods = Array.from({ length: 8 }, (_, i) => i + 1);

/** 当前班级课表：按 day_of_week × period 索引 */
const scheduleMap = computed(() => {
  const map: Record<string, any> = {};
  if (!classId.value) return map;
  allRows.value
    .filter(r => r.class_id === classId.value)
    .forEach(r => (map[`${r.day_of_week}-${r.period}`] = r));
  return map;
});

const dialogVisible = ref(false);
const dialogTitle = ref("新增排课");
const formRef = ref();
const form = reactive({
  id: null as number | null,
  class_id: null as number | null,
  course_id: null as number | null,
  day_of_week: 1 as number,
  period: 1 as number
});
const rules = {
  class_id: [{ required: true, message: "请选择班级", trigger: "change" }],
  course_id: [{ required: true, message: "请选择课程", trigger: "change" }]
};

function loadClasses() {
  getAllClasses().then((res: any) => {
    if (res.success) classOptions.value = res.data;
  });
}

function loadCourses() {
  getAllCourses().then((res: any) => {
    if (res.success) courseOptions.value = res.data;
  });
}

function loadData() {
  loading.value = true;
  getAllSchedules()
    .then((res: any) => {
      if (res.success) allRows.value = res.data;
    })
    .finally(() => (loading.value = false));
}

function cellData(day: number, period: number) {
  return scheduleMap.value[`${day}-${period}`];
}

function openAdd(day: number, period: number) {
  dialogTitle.value = "新增排课";
  Object.assign(form, {
    id: null,
    class_id: classId.value,
    course_id: null,
    day_of_week: day,
    period
  });
  dialogVisible.value = true;
}

function openEdit(row: any) {
  dialogTitle.value = "编辑排课";
  Object.assign(form, {
    id: row.id,
    class_id: row.class_id,
    course_id: row.course_id,
    day_of_week: row.day_of_week,
    period: row.period
  });
  dialogVisible.value = true;
}

function handleSubmit() {
  formRef.value.validate((valid: boolean) => {
    if (!valid) return;
    const payload = {
      class_id: form.class_id,
      course_id: form.course_id,
      day_of_week: form.day_of_week,
      period: form.period
    };
    const api = form.id
      ? updateSchedule(form.id, payload)
      : createSchedule(payload);
    api.then((res: any) => {
      if (res.success) {
        ElMessage.success(form.id ? "修改成功" : "新增成功");
        if (res.data?.warnings?.length > 0) {
          const w = res.data.warnings[0];
          ElMessage.warning(
            `已保存，但该教师「${w.teacher}」在星期${w.day_of_week}第${w.period}节已安排其他班级「${w.class_name}·${w.course_name}」，请留意冲突`
          );
        }
        dialogVisible.value = false;
        loadData();
      }
    });
  });
}

/** ---------- 调课申请 ---------- */
const adjustDialogVisible = ref(false);
const adjustForm = reactive({
  schedule_id: null as number | null,
  to_day_of_week: 1 as number,
  to_period: 1 as number,
  reason: ""
});

function openAdjust(row: any) {
  Object.assign(adjustForm, {
    schedule_id: row.id,
    to_day_of_week: row.day_of_week,
    to_period: row.period,
    reason: ""
  });
  adjustDialogVisible.value = true;
}

function submitAdjust() {
  if (!adjustForm.schedule_id) return;
  createAdjustment({ ...adjustForm }).then((res: any) => {
    if (res.success) {
      ElMessage.success("调课申请已提交，等待管理员审批");
      adjustDialogVisible.value = false;
    }
  });
}

/** ---------- 冲突检测（前端基于全量课表计算） ---------- */
const conflictDialogVisible = ref(false);
const conflictList = ref<any[]>([]);

function checkConflicts() {
  const rows = allRows.value;
  const list: any[] = [];
  // 1) 同班同时段：当前班级同一 slot 出现多条
  const bySlot: Record<string, any[]> = {};
  rows
    .filter(r => r.class_id === classId.value)
    .forEach(r => {
      const k = `${r.day_of_week}-${r.period}`;
      (bySlot[k] = bySlot[k] || []).push(r);
    });
  Object.values(bySlot).forEach(arr => {
    if (arr.length > 1) {
      arr.forEach(r =>
        list.push({
          type: "同班同时段",
          day_of_week: r.day_of_week,
          period: r.period,
          class_name: r.class_name,
          course_name: r.course_name,
          teacher: r.teacher
        })
      );
    }
  });
  // 2) 同教师文本跨班同时段
  const tBySlot: Record<string, any[]> = {};
  rows.forEach(r => {
    const t = r.teacher || "";
    if (!t) return;
    const k = `${t}-${r.day_of_week}-${r.period}`;
    (tBySlot[k] = tBySlot[k] || []).push(r);
  });
  Object.values(tBySlot).forEach(arr => {
    if (arr.length > 1 && new Set(arr.map(r => r.class_id)).size > 1) {
      arr.forEach(r =>
        list.push({
          type: "教师同时段跨班",
          day_of_week: r.day_of_week,
          period: r.period,
          class_name: r.class_name,
          course_name: r.course_name,
          teacher: r.teacher
        })
      );
    }
  });
  conflictList.value = list;
  conflictDialogVisible.value = true;
}

function handleDelete(row: any) {
  ElMessageBox.confirm(
    `确定删除「${weekDays[row.day_of_week - 1]} 第${row.period}节 · ${row.course_name}」吗？`,
    "提示",
    { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" }
  )
    .then(() => {
      deleteSchedule(row.id).then((res: any) => {
        if (res.success) {
          ElMessage.success("删除成功");
          loadData();
        }
      });
    })
    .catch(() => {});
}

onMounted(() => {
  loadClasses();
  loadCourses();
  loadData();
});
</script>

<template>
  <div class="app-page">
    <AppPageHeader
      title="排课模板"
      description="每周固定的上课安排（模板）——改这里，以后每周都跟着变；只想改某一天的一节课，去「考勤管理 → 周课表」"
    />
    <el-card shadow="never">
      <!-- 筛选 -->
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <el-select
          v-model="classId"
          placeholder="请选择班级"
          clearable
          class="!w-48"
          @change="loadData"
        >
          <el-option
            v-for="item in classOptions"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
        <span class="text-[13px] text-gray-500"
          >点击空格子可新增课程，点击已安排课程可修改</span
        >
        <div class="flex-1" />
        <el-button type="warning" plain @click="checkConflicts">
          <el-icon class="mr-1"><EpWarning /></el-icon>
          冲突检测
        </el-button>
      </div>

      <div v-if="!classId" class="py-16 text-center text-gray-400">
        请先选择班级查看排课模板
      </div>
      <el-table v-else v-loading="loading" :data="periods" border stripe>
        <el-table-column label="节次" width="90" align="center">
          <template #default="{ row }">第 {{ row }} 节</template>
        </el-table-column>
        <el-table-column
          v-for="(day, i) in weekDays"
          :key="day"
          :label="day"
          min-width="150"
          align="center"
        >
          <template #default="{ row }">
            <div
              v-if="cellData(i + 1, row)"
              class="cursor-pointer rounded px-2 py-1"
              style="background: #ecf5ff; border: 1px solid #d9ecff"
              @click="openEdit(cellData(i + 1, row))"
            >
              <div class="text-[13px] font-medium text-primary">
                {{ cellData(i + 1, row).course_name }}
              </div>
              <div class="text-[12px] text-gray-500">
                {{ cellData(i + 1, row).teacher || "未设教师" }}
              </div>
              <el-button
                link
                type="danger"
                class="!text-[12px] mt-0.5"
                @click.stop="openAdjust(cellData(i + 1, row))"
              >
                调课
              </el-button>
            </div>
            <el-button
              v-else
              link
              type="primary"
              class="!text-[12px]"
              @click="openAdd(i + 1, row)"
            >
              + 添加
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新增/编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="460px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="班级" prop="class_id">
          <el-select
            v-model="form.class_id"
            placeholder="请选择班级"
            class="!w-full"
          >
            <el-option
              v-for="item in classOptions"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="课程" prop="course_id">
          <el-select
            v-model="form.course_id"
            placeholder="请选择课程"
            class="!w-full"
          >
            <el-option
              v-for="item in courseOptions"
              :key="item.id"
              :label="`${item.name}（${item.teacher || '未设教师'}）`"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="星期">
          <el-select v-model="form.day_of_week" class="!w-full">
            <el-option
              v-for="(day, i) in weekDays"
              :key="day"
              :label="day"
              :value="i + 1"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="节次">
          <el-select v-model="form.period" class="!w-full">
            <el-option
              v-for="p in periods"
              :key="p"
              :label="`第 ${p} 节`"
              :value="p"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 调课申请弹窗 -->
    <el-dialog v-model="adjustDialogVisible" title="提交调课申请" width="460px">
      <el-form label-width="80px">
        <el-form-item label="目标星期">
          <el-select v-model="adjustForm.to_day_of_week" class="!w-full">
            <el-option
              v-for="(day, i) in weekDays"
              :key="day"
              :label="day"
              :value="i + 1"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="目标节次">
          <el-select v-model="adjustForm.to_period" class="!w-full">
            <el-option
              v-for="p in periods"
              :key="p"
              :label="`第 ${p} 节`"
              :value="p"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="调课原因">
          <el-input
            v-model="adjustForm.reason"
            type="textarea"
            :rows="2"
            placeholder="请填写调课原因（选填）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="adjustDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitAdjust">提交申请</el-button>
      </template>
    </el-dialog>

    <!-- 冲突清单弹窗 -->
    <el-dialog
      v-model="conflictDialogVisible"
      title="课表冲突检测"
      width="640px"
    >
      <el-alert
        v-if="conflictList.length === 0"
        type="success"
        title="未检测到冲突（同班同时段重复 / 同教师跨班同时段）"
        :closable="false"
      />
      <el-table v-else :data="conflictList" border stripe max-height="420">
        <el-table-column prop="type" label="类型" width="130" align="center">
          <template #default="{ row }">
            <el-tag
              :type="row.type === '同班同时段' ? 'danger' : 'warning'"
              size="small"
            >
              {{ row.type }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="时段" width="110" align="center">
          <template #default="{ row }">
            {{ weekDays[row.day_of_week - 1] }} 第{{ row.period }}节
          </template>
        </el-table-column>
        <el-table-column prop="class_name" label="班级" width="150" />
        <el-table-column prop="course_name" label="课程" min-width="140" />
        <el-table-column prop="teacher" label="教师" width="100" />
      </el-table>
    </el-dialog>
  </div>
</template>
