<script setup lang="ts">
import { ref, onMounted } from "vue";
import dayjs from "dayjs";
import { ElMessage } from "element-plus";
import {
  getAllClasses,
  getAllCourses,
  getScheduleList,
  getAttendanceList,
  saveAttendanceBatch
} from "@/api/attendance";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "Checkin"
});

const STATUS_OPTIONS = [
  { label: "正常", value: "正常", tag: "success" },
  { label: "迟到", value: "迟到", tag: "warning" },
  { label: "早退", value: "早退", tag: "warning" },
  { label: "缺勤", value: "缺勤", tag: "danger" },
  {
    label: "请假",
    value: "请假",
    tag: "info",
    tip: "标记请假将自动生成请假申请，需在「请假管理」中审批"
  }
];

const date = ref(dayjs().format("YYYY-MM-DD"));
const classId = ref<number | null>(null);
const courseId = ref<number | null>(null);
const classOptions = ref<any[]>([]);
const courseOptions = ref<any[]>([]);

const loading = ref(false);
const submitting = ref(false);
const rows = ref<any[]>([]);

// 当天课表课程（选中班级+日期后自动带出）
const scheduleCourses = ref<any[]>([]);

function loadOptions() {
  getAllClasses().then((res: any) => {
    if (res.success) classOptions.value = res.data;
  });
  getAllCourses().then((res: any) => {
    if (res.success) courseOptions.value = res.data;
  });
}

/** 根据班级+日期加载当天课表课程（JS getDay: 0=周日 → 映射 1=周一 … 7=周日） */
function loadSchedule() {
  scheduleCourses.value = [];
  if (!classId.value || !date.value) return;
  const dow = ((dayjs(date.value).day() + 6) % 7) + 1;
  getScheduleList({
    class_id: classId.value,
    day_of_week: dow,
    pageSize: 50
  }).then((res: any) => {
    if (res.success) scheduleCourses.value = res.data.list;
  });
}

/** 点击课表课程 → 选中该课程并查询名单 */
function useSchedule(item: any) {
  courseId.value = item.course_id;
  query();
}

function query() {
  if (!date.value || !classId.value || !courseId.value) {
    ElMessage.warning("请先选择日期、班级和课程");
    return;
  }
  loading.value = true;
  getAttendanceList({
    date: date.value,
    class_id: classId.value,
    course_id: courseId.value
  })
    .then((res: any) => {
      if (res.success) {
        rows.value = res.data.map((r: any) => ({
          ...r,
          status: r.status || "正常",
          remark: r.remark || ""
        }));
      }
    })
    .finally(() => (loading.value = false));
}

function setAllNormal() {
  rows.value.forEach(r => (r.status = "正常"));
}

function submit() {
  if (rows.value.length === 0) {
    ElMessage.warning("请先查询考勤名单");
    return;
  }
  submitting.value = true;
  saveAttendanceBatch({
    date: date.value,
    course_id: courseId.value,
    records: rows.value.map(r => ({
      student_id: r.student_id,
      status: r.status,
      remark: r.remark
    }))
  })
    .then((res: any) => {
      if (res.success) {
        ElMessage.success(`已保存 ${res.data.count} 条考勤记录`);
        query();
      }
    })
    .finally(() => (submitting.value = false));
}

onMounted(loadOptions);
</script>

<template>
  <div class="app-page">
    <AppPageHeader title="考勤登记" description="按当日课表点名，记录正常、迟到、早退、缺勤与请假" />
    <el-card shadow="never">
      <!-- 选择条件 -->
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <el-date-picker
          v-model="date"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选择日期"
          class="!w-40"
          @change="loadSchedule"
        />
        <el-select
          v-model="classId"
          placeholder="选择班级"
          class="!w-44"
          @change="loadSchedule"
        >
          <el-option
            v-for="item in classOptions"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
        <el-select v-model="courseId" placeholder="选择课程" class="!w-44">
          <el-option
            v-for="item in courseOptions"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
        <el-button type="primary" @click="query">查询名单</el-button>
        <div class="flex-1" />
        <el-button @click="setAllNormal">全部设为正常</el-button>
        <el-button type="success" :loading="submitting" @click="submit">
          批量提交
        </el-button>
      </div>

      <!-- 当天课表课程（快捷选择） -->
      <div
        v-if="scheduleCourses.length > 0"
        class="mb-3 flex flex-wrap items-center gap-2"
      >
        <span class="text-[13px] text-gray-500">当天课表：</span>
        <el-tag
          v-for="s in scheduleCourses"
          :key="s.id"
          :type="courseId === s.course_id ? 'primary' : 'info'"
          class="cursor-pointer"
          effect="plain"
          @click="useSchedule(s)"
        >
          第{{ s.period }}节 · {{ s.course_name }}
        </el-tag>
      </div>

      <!-- 考勤名单 -->
      <el-table v-loading="loading" :data="rows" border stripe>
        <el-table-column type="index" label="#" width="60" align="center" />
        <el-table-column prop="student_no" label="学号" min-width="110" />
        <el-table-column prop="name" label="姓名" min-width="100" />
        <el-table-column prop="gender" label="性别" width="80" align="center" />
        <el-table-column label="考勤状态" width="200">
          <template #default="{ row }">
            <el-tooltip
              :disabled="row.status !== '请假'"
              :content="STATUS_OPTIONS.find(o => o.value === '请假')?.tip || ''"
              placement="top"
            >
              <el-select v-model="row.status" size="small">
                <el-option
                  v-for="opt in STATUS_OPTIONS"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="备注" min-width="200">
          <template #default="{ row }">
            <el-input
              v-model="row.remark"
              placeholder="选填，如：迟到原因"
              size="small"
              clearable
            />
          </template>
        </el-table-column>
      </el-table>

      <el-empty
        v-if="!loading && rows.length === 0"
        description="请选择日期、班级、课程后点击「查询名单」"
      />
    </el-card>
  </div>
</template>
