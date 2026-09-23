<script setup lang="ts">
// 周课表页（班级 / 教师两视角 · 时间网格）
//
// ★ 呈现铁律：排课是"时间占用型"功能 → 自绘 CSS Grid 周历，禁止列表。
// ★ 仅一次请求：GET /sessions/week 返回 days/periods/sessions，前端建 map[日期|节次]。
// ★ Q8：教师登录默认「教师视角 + 锁定本人」；admin 进入默认「班级视角 + 今天所在周」。
// ★ 接口全部走 @/api/sessions；本组件内不出现 axios / $route / localStorage（周状态用 ref）。
import { ref, computed, onMounted } from "vue";
import dayjs from "dayjs";
import { useUserStoreHook } from "@/store/modules/user";
import { getAllClasses, getUserList } from "@/api/attendance";
import { getSessionWeek } from "@/api/sessions";
import { AppPageHeader } from "@/components/AppPageHeader";
import { AppEmpty } from "@/components/AppEmpty";
import WeekGrid from "./components/WeekGrid.vue";
import SessionDetailDrawer from "./components/SessionDetailDrawer.vue";
import GenerateSessionsDialog from "./components/GenerateSessionsDialog.vue";

defineOptions({
  name: "Sessions"
});

const roles = useUserStoreHook().roles || [];
const isTeacher = roles.includes("teacher");
const isAdmin = roles.includes("admin");
const nickname = useUserStoreHook().nickname;

const STATUS_OPTIONS = ["待上课", "已上课", "已停课", "已调课", "已取消"];

const view = ref<"class" | "teacher">(isTeacher ? "teacher" : "class");
const classId = ref<number | null>(null);
const teacherId = ref<number | null>(null);
const statuses = ref<string[]>([]);
const weekStart = ref(mondayOf(dayjs().format("YYYY-MM-DD")));

const classOptions = ref<any[]>([]);
const teacherOptions = ref<any[]>([]);

const loading = ref(false);
const days = ref<any[]>([]);
const periods = ref<any[]>([]);
const sessions = ref<any[]>([]);

const generateVisible = ref(false);
const drawerVisible = ref(false);
const activeSessionId = ref<number | null>(null);

/** 给定日期（或今天）所在周的周一（YYYY-MM-DD） */
function mondayOf(dateStr: string): string {
  const d = dayjs(dateStr);
  const dow = d.day(); // 0=周日
  const diff = dow === 0 ? -6 : 1 - dow;
  return d.add(diff, "day").format("YYYY-MM-DD");
}

const weekEnd = computed(() =>
  dayjs(weekStart.value).add(6, "day").format("YYYY-MM-DD")
);

/** 单元格索引：{ [`${date}|${period}`]: session[] } */
const cells = computed(() => {
  const map: Record<string, any[]> = {};
  sessions.value.forEach(s => {
    const key = `${s.session_date}|${s.period}`;
    (map[key] = map[key] || []).push(s);
  });
  return map;
});

/** 是否存在可渲染的课次 */
const hasSessions = computed(() => sessions.value.length > 0);

async function loadOptions() {
  const jobs: Promise<any>[] = [
    getAllClasses().then((res: any) => {
      if (res.success) {
        classOptions.value = res.data;
        if (!isTeacher && classId.value === null && res.data.length > 0) {
          classId.value = res.data[0].id;
        }
      }
    })
  ];
  if (isAdmin) {
    jobs.push(
      getUserList({ role: "teacher", pageSize: 100 }).then((res: any) => {
        if (res.success) {
          teacherOptions.value = res.data.list;
          if (
            view.value === "teacher" &&
            teacherId.value === null &&
            res.data.list.length > 0
          ) {
            teacherId.value = res.data.list[0].id;
          }
        }
      })
    );
  }
  await Promise.all(jobs);
}

function loadWeek() {
  // 教师视角（admin）：必须指定教师
  if (view.value === "teacher" && isAdmin && !teacherId.value) {
    days.value = [];
    periods.value = [];
    sessions.value = [];
    return;
  }
  // 班级视角：必须指定班级
  if (view.value === "class" && !classId.value) {
    days.value = [];
    periods.value = [];
    sessions.value = [];
    return;
  }
  loading.value = true;
  getSessionWeek({
    view: view.value,
    class_id: view.value === "class" ? classId.value : undefined,
    teacher_id: view.value === "teacher" ? teacherId.value : undefined,
    week_start: weekStart.value,
    statuses: statuses.value.join(",")
  })
    .then((res: any) => {
      if (res.success) {
        days.value = res.data.days || [];
        periods.value = res.data.periods || [];
        sessions.value = res.data.sessions || [];
        weekStart.value = res.data.week_start || weekStart.value;
      }
    })
    .finally(() => (loading.value = false));
}

function onViewChange() {
  loadWeek();
}

function shiftWeek(n: number) {
  weekStart.value = dayjs(weekStart.value)
    .add(n * 7, "day")
    .format("YYYY-MM-DD");
  loadWeek();
}

function goThisWeek() {
  weekStart.value = mondayOf(dayjs().format("YYYY-MM-DD"));
  loadWeek();
}

function openDetail(s: any) {
  activeSessionId.value = s.id;
  drawerVisible.value = true;
}

function onGenerated(startDate: string) {
  if (startDate) weekStart.value = mondayOf(startDate);
  loadWeek();
}

onMounted(async () => {
  await loadOptions();
  loadWeek();
});
</script>

<template>
  <div class="app-page">
    <AppPageHeader
      title="课次课表"
      description="按周查看每个班级 / 教师的真实课次（含起止时间与状态）"
    >
      <el-button v-if="isAdmin" type="primary" @click="generateVisible = true">
        生成本学期课次
      </el-button>
    </AppPageHeader>

    <div class="page-card">
      <!-- 工具栏 -->
      <div class="page-toolbar">
        <el-radio-group v-model="view" @change="onViewChange">
          <el-radio-button value="class">班级视角</el-radio-button>
          <el-radio-button value="teacher">教师视角</el-radio-button>
        </el-radio-group>

        <el-select
          v-if="view === 'class'"
          v-model="classId"
          placeholder="请选择班级"
          class="!w-52"
          @change="loadWeek"
        >
          <el-option
            v-for="c in classOptions"
            :key="c.id"
            :label="c.name"
            :value="c.id"
          />
        </el-select>

        <el-input
          v-else-if="isTeacher"
          :model-value="`${nickname}（本人）`"
          disabled
          class="!w-44"
        />
        <el-select
          v-else
          v-model="teacherId"
          placeholder="请选择教师"
          class="!w-44"
          @change="loadWeek"
        >
          <el-option
            v-for="t in teacherOptions"
            :key="t.id"
            :label="t.name"
            :value="t.id"
          />
        </el-select>

        <div class="page-toolbar__spacer" />

        <el-button @click="shiftWeek(-1)">‹ 上周</el-button>
        <span class="week-label num">
          {{ weekStart }} ~ {{ weekEnd.slice(5) }}
        </span>
        <el-button @click="shiftWeek(1)">下周 ›</el-button>
        <el-button @click="goThisWeek">本周</el-button>
      </div>

      <!-- 状态筛选 -->
      <div class="page-toolbar">
        <el-select
          v-model="statuses"
          multiple
          collapse-tags
          clearable
          placeholder="状态筛选"
          class="!w-64"
          @change="loadWeek"
        >
          <el-option
            v-for="s in STATUS_OPTIONS"
            :key="s"
            :label="s"
            :value="s"
          />
        </el-select>
        <span class="page-hint"> 同格出现多节课次时以红色边框标注为冲突 </span>
      </div>

      <!-- 周历网格 -->
      <WeekGrid
        v-if="days.length"
        :days="days"
        :periods="periods"
        :cells="cells"
        :loading="loading"
        @open="openDetail"
      />
      <AppEmpty
        v-else-if="!loading"
        title="当前条件下暂无课次"
        description="可切换班级 / 教师或周区间；若整学期尚未生成，请在右上角「生成本学期课次」"
      />

      <el-alert
        v-if="
          !hasSessions &&
          !loading &&
          days.length === 0 &&
          view === 'teacher' &&
          isAdmin &&
          !teacherId
        "
        type="info"
        :closable="false"
        title="请先选择要查看的教师"
        class="mt-3"
      />
    </div>

    <!-- 生成弹窗 -->
    <GenerateSessionsDialog
      v-model="generateVisible"
      @generated="onGenerated"
    />

    <!-- 课次详情抽屉 -->
    <SessionDetailDrawer
      v-model="drawerVisible"
      :session-id="activeSessionId"
      @changed="loadWeek"
    />
  </div>
</template>

<style lang="scss" scoped>
.week-label {
  min-width: 150px;
  font-size: var(--text-sm);
  color: var(--ink-600);
  text-align: center;
}
</style>
