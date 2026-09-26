<script setup lang="ts">
// 课次详情抽屉 · 既有流程的聚合视图（点名 / 课评 / 课消 / 挪课记录）
//
// ★ 采集铁律：不新开"去填课次"入口 —— 点名 / 课评自动带出当前课次（session_id）。
// ★ 停课 / 挪课 / 代课走 ElMessageBox 二次确认；仅「待上课」可挪课（Q4）。
// ★ 全部接口走 @/api/sessions 与 @/api/attendance；本组件内不出现 axios / $route / localStorage。
import { ref, computed, watch } from "vue";
import dayjs from "dayjs";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  getAttendanceList,
  saveAttendanceBatch,
  getUserList
} from "@/api/attendance";
import {
  getSessionDetail,
  stopSession,
  restoreSession,
  rescheduleSession,
  substituteSession,
  saveClassEval
} from "@/api/sessions";
import { useUserStoreHook } from "@/store/modules/user";
import { AppEmpty } from "@/components/AppEmpty";

defineOptions({
  name: "SessionDetailDrawer"
});

const props = defineProps<{
  modelValue: boolean;
  /** 当前课次 id（null 时抽屉不加载） */
  sessionId: number | null;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  /** 课次被变更（停课/恢复/挪课/代课/点名）→ 父级刷新周历 */
  (e: "changed"): void;
}>();

const ATT_STATUS = ["正常", "迟到", "早退", "缺勤", "请假"];

const isAdmin = computed(() =>
  (useUserStoreHook().roles || []).includes("admin")
);

const visible = computed({
  get: () => props.modelValue,
  set: v => emit("update:modelValue", v)
});

const loading = ref(false);
const activeTab = ref("attendance");
const detail = ref<any>(null);
const attRows = ref<any[]>([]);
const evalRows = ref<any[]>([]);
const submitting = ref(false);

const session = computed(() => detail.value?.session || null);
const related = computed(() => detail.value?.related || null);

function statusTagType(status: string): string {
  const map: Record<string, string> = {
    待上课: "info",
    已上课: "success",
    已停课: "danger",
    已挪课: "warning",
    已取消: "info"
  };
  return map[status] || "info";
}

/** 加载课次详情（含名单/课评/课消/关联） */
function load() {
  if (!props.sessionId) return;
  loading.value = true;
  getSessionDetail(props.sessionId)
    .then((res: any) => {
      if (!res.success) return;
      detail.value = res.data;
      attRows.value = (res.data.students || []).map((r: any) => ({
        student_id: r.student_id,
        student_no: r.student_no,
        name: r.name,
        status: r.status || "正常",
        remark: r.remark || ""
      }));
      const evalMap: Record<number, any> = {};
      (res.data.evaluations || []).forEach((e: any) => {
        evalMap[e.student_id] = e;
      });
      evalRows.value = (res.data.students || []).map((r: any) => ({
        student_id: r.student_id,
        student_no: r.student_no,
        name: r.name,
        focus: evalMap[r.student_id]?.focus ?? 3,
        participation: evalMap[r.student_id]?.participation ?? 3,
        mastery: evalMap[r.student_id]?.mastery ?? 3,
        note: evalMap[r.student_id]?.teacher_note || ""
      }));
    })
    .finally(() => (loading.value = false));
}

watch(
  () => [props.modelValue, props.sessionId],
  ([open]) => {
    if (open && props.sessionId) {
      activeTab.value = "attendance";
      load();
    }
  }
);

/** 点名：全部设为正常 */
function setAllNormal() {
  attRows.value.forEach(r => (r.status = "正常"));
}

/** 点名：批量提交（带 session_id → 按课次 upsert + 扣课） */
async function submitAttendance() {
  if (!session.value) return;
  submitting.value = true;
  try {
    const res: any = await saveAttendanceBatch({
      session_id: session.value.id,
      course_id: session.value.course_id,
      date: session.value.session_date,
      records: attRows.value.map(r => ({
        student_id: r.student_id,
        status: r.status,
        remark: r.remark
      }))
    });
    if (res.success) {
      ElMessage.success(`已保存 ${res.data.count} 条考勤记录`);
      emit("changed");
    }
  } finally {
    submitting.value = false;
  }
}

/** 课评：提交（带 session_id） */
async function submitEval() {
  if (!session.value) return;
  submitting.value = true;
  try {
    const res: any = await saveClassEval({
      class_id: session.value.class_id,
      course_id: session.value.course_id,
      eval_date: session.value.session_date,
      session_id: session.value.id,
      items: evalRows.value.map(r => ({
        student_id: r.student_id,
        focus: r.focus,
        participation: r.participation,
        mastery: r.mastery,
        note: r.note
      }))
    });
    if (res.success) {
      ElMessage.success(`已保存 ${res.data.saved} 条课评`);
      load();
    }
  } finally {
    submitting.value = false;
  }
}

/** 停课（二次确认） */
function doStop() {
  ElMessageBox.confirm(
    "停课后本节不再产生考勤与课消，可随时「恢复」。确定停课吗？",
    "停课确认",
    { type: "warning", confirmButtonText: "停课", cancelButtonText: "取消" }
  )
    .then(async () => {
      const res: any = await stopSession(session.value.id);
      if (res.success) {
        ElMessage.success("已停课");
        load();
        emit("changed");
      }
    })
    .catch(() => {});
}

/** 恢复（二次确认） */
function doRestore() {
  ElMessageBox.confirm("确定恢复该课次为「待上课」吗？", "恢复确认", {
    type: "warning",
    confirmButtonText: "恢复",
    cancelButtonText: "取消"
  })
    .then(async () => {
      const res: any = await restoreSession(session.value.id);
      if (res.success) {
        ElMessage.success("已恢复");
        load();
        emit("changed");
      }
    })
    .catch(() => {});
}

/** ---------- 挪课 ---------- */
const rescheduleVisible = ref(false);
const rescheduleForm = ref({ session_date: "", period: 1 });

function openReschedule() {
  rescheduleForm.value = {
    session_date: session.value.session_date,
    period: Number(session.value.period)
  };
  rescheduleVisible.value = true;
}

async function submitReschedule() {
  if (!rescheduleForm.value.session_date) {
    ElMessage.warning("请选择目标日期");
    return;
  }
  try {
    await ElMessageBox.confirm(
      `将把本节调到 ${rescheduleForm.value.session_date} 第 ${rescheduleForm.value.period} 节，原课次标记为「已挪课」并双向关联。`,
      "挪课确认",
      {
        type: "warning",
        confirmButtonText: "确定挪课",
        cancelButtonText: "取消"
      }
    );
  } catch {
    return;
  }
  const res: any = await rescheduleSession(session.value.id, {
    session_date: rescheduleForm.value.session_date,
    period: rescheduleForm.value.period
  });
  if (res.success) {
    ElMessage.success("挪课成功");
    rescheduleVisible.value = false;
    load();
    emit("changed");
  }
}

/** ---------- 代课 ---------- */
const substituteVisible = ref(false);
const substituteForm = ref({ substitute_teacher_id: null as number | null });
const teacherOptions = ref<any[]>([]);

function openSubstitute() {
  substituteForm.value = { substitute_teacher_id: null };
  if (teacherOptions.value.length === 0) {
    getUserList({ role: "teacher", pageSize: 100 }).then((res: any) => {
      if (res.success) teacherOptions.value = res.data.list;
    });
  }
  substituteVisible.value = true;
}

async function submitSubstitute() {
  if (!substituteForm.value.substitute_teacher_id) {
    ElMessage.warning("请选择代课人");
    return;
  }
  try {
    await ElMessageBox.confirm(
      "代课后原授课教师保留，代课人可查看并录入本节考勤 / 课评。确定吗？",
      "代课确认",
      {
        type: "warning",
        confirmButtonText: "确定代课",
        cancelButtonText: "取消"
      }
    );
  } catch {
    return;
  }
  const res: any = await substituteSession(session.value.id, {
    substitute_teacher_id: substituteForm.value.substitute_teacher_id
  });
  if (res.success) {
    ElMessage.success("已安排代课");
    substituteVisible.value = false;
    load();
    emit("changed");
  }
}
</script>

<template>
  <el-drawer
    v-model="visible"
    title="课次详情"
    :size="560"
    :destroy-on-close="true"
  >
    <div v-loading="loading" class="drawer-body">
      <template v-if="session">
        <!-- 头部信息 -->
        <div class="drawer-head">
          <div class="drawer-head__title">
            {{ session.session_date }} ·
            {{ `第${session.period}节` }}
            <span class="drawer-head__time">
              {{ session.start_time }}–{{ session.end_time }}
            </span>
            <el-tag :type="statusTagType(session.status) as any" size="small">
              {{ session.status }}
            </el-tag>
          </div>
          <el-descriptions :column="2" border size="small" class="mt-2">
            <el-descriptions-item label="班级">
              {{ session.class_name }}
            </el-descriptions-item>
            <el-descriptions-item label="课程">
              {{ session.course_name }}
            </el-descriptions-item>
            <el-descriptions-item label="授课教师">
              {{ session.teacher_name || "未指定" }}
            </el-descriptions-item>
            <el-descriptions-item label="代课">
              {{ session.substitute_teacher_name || "—" }}
            </el-descriptions-item>
            <el-descriptions-item label="教室">
              {{ session.room_id ? `教室 ${session.room_id}` : "未指定" }}
            </el-descriptions-item>
            <el-descriptions-item label="来源">
              {{ session.origin }}
            </el-descriptions-item>
          </el-descriptions>
        </div>

        <!-- 四页签 -->
        <el-tabs v-model="activeTab" class="drawer-tabs">
          <!-- 点名 -->
          <el-tab-pane label="点名" name="attendance">
            <div class="tab-toolbar">
              <el-button size="small" @click="setAllNormal"
                >全部设为正常</el-button
              >
              <div class="flex-1" />
              <el-button
                type="success"
                size="small"
                :loading="submitting"
                :disabled="session.status === '已停课'"
                @click="submitAttendance"
              >
                批量提交
              </el-button>
            </div>
            <el-alert
              v-if="session.status === '已停课'"
              type="warning"
              :closable="false"
              title="该课次已停课，不能录入考勤"
              class="mb-2"
            />
            <el-table
              :data="attRows"
              border
              stripe
              size="small"
              max-height="360"
            >
              <el-table-column prop="student_no" label="学号" width="100" />
              <el-table-column prop="name" label="姓名" width="90" />
              <el-table-column label="考勤状态" width="130">
                <template #default="{ row }">
                  <el-select v-model="row.status" size="small">
                    <el-option
                      v-for="s in ATT_STATUS"
                      :key="s"
                      :label="s"
                      :value="s"
                    />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="备注" min-width="140">
                <template #default="{ row }">
                  <el-input
                    v-model="row.remark"
                    size="small"
                    placeholder="选填"
                  />
                </template>
              </el-table-column>
            </el-table>
            <AppEmpty
              v-if="attRows.length === 0 && !loading"
              title="本班暂无在读学员"
              description="请先在「学生管理」为该班添加在读学员"
            />
          </el-tab-pane>

          <!-- 课评 -->
          <el-tab-pane label="课评" name="eval">
            <div class="tab-toolbar">
              <span class="page-hint">三维评分 1–5，全班默认良好（3）</span>
              <div class="flex-1" />
              <el-button
                type="success"
                size="small"
                :loading="submitting"
                :disabled="session.status === '已停课'"
                @click="submitEval"
              >
                批量提交课评
              </el-button>
            </div>
            <el-table
              :data="evalRows"
              border
              stripe
              size="small"
              max-height="360"
            >
              <el-table-column prop="name" label="姓名" width="90" />
              <el-table-column label="专注" width="110">
                <template #default="{ row }">
                  <el-select v-model="row.focus" size="small">
                    <el-option v-for="n in 5" :key="n" :label="n" :value="n" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="参与" width="110">
                <template #default="{ row }">
                  <el-select v-model="row.participation" size="small">
                    <el-option v-for="n in 5" :key="n" :label="n" :value="n" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="掌握" width="110">
                <template #default="{ row }">
                  <el-select v-model="row.mastery" size="small">
                    <el-option v-for="n in 5" :key="n" :label="n" :value="n" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="备注" min-width="140">
                <template #default="{ row }">
                  <el-input
                    v-model="row.note"
                    size="small"
                    placeholder="选填"
                  />
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <!-- 课消 -->
          <el-tab-pane label="课消" name="consumption">
            <el-table
              :data="detail.consumptions || []"
              border
              stripe
              size="small"
              max-height="360"
            >
              <el-table-column
                prop="student_name"
                label="学员"
                min-width="100"
              />
              <el-table-column label="课时" width="80" align="right">
                <template #default="{ row }">
                  <span class="num">{{ row.hours }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="type" label="类型" width="80" />
              <el-table-column prop="date" label="日期" min-width="110" />
            </el-table>
            <AppEmpty
              v-if="(detail.consumptions || []).length === 0"
              title="本节暂无课时流水"
              description="点名提交「正常 / 迟到 / 早退」后会自动扣减课时"
            />
          </el-tab-pane>

          <!-- 挪课记录 -->
          <el-tab-pane label="挪课记录" name="related">
            <template v-if="related">
              <el-alert
                type="info"
                :closable="false"
                :title="`本节与 ${related.session_date} 第${related.period}节（${related.status}）互相关联`"
                class="mb-3"
              />
              <el-descriptions :column="1" border size="small">
                <el-descriptions-item label="关联课次">
                  {{ related.session_date }} · 第 {{ related.period }} 节
                </el-descriptions-item>
                <el-descriptions-item label="关联课次状态">
                  {{ related.status }}
                </el-descriptions-item>
              </el-descriptions>
            </template>
            <AppEmpty
              v-else
              title="本节无挪课记录"
              description="仅「待上课」的课次可发起挪课"
            />
          </el-tab-pane>
        </el-tabs>
      </template>
    </div>

    <!-- 底部危险操作（仅 admin） -->
    <template v-if="isAdmin && session" #footer>
      <div class="drawer-footer">
        <el-button
          v-if="session.status === '待上课'"
          type="danger"
          plain
          @click="doStop"
        >
          停课
        </el-button>
        <el-button
          v-if="session.status === '待上课'"
          type="warning"
          plain
          @click="openReschedule"
        >
          挪课
        </el-button>
        <el-button
          v-if="session.status === '待上课' || session.status === '已上课'"
          type="primary"
          plain
          @click="openSubstitute"
        >
          代课
        </el-button>
        <el-button
          v-if="session.status === '已停课'"
          type="success"
          @click="doRestore"
        >
          恢复
        </el-button>
      </div>
    </template>

    <!-- 挪课子弹窗 -->
    <el-dialog
      v-model="rescheduleVisible"
      title="挪课"
      width="400px"
      append-to-body
    >
      <el-form label-width="80px">
        <el-form-item label="目标日期">
          <el-date-picker
            v-model="rescheduleForm.session_date"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择日期"
            class="!w-full"
            :disabled-date="d => d && dayjs(d).isBefore(dayjs().startOf('day'))"
          />
        </el-form-item>
        <el-form-item label="目标节次">
          <el-select v-model="rescheduleForm.period" class="!w-full">
            <el-option
              v-for="n in 8"
              :key="n"
              :label="`第 ${n} 节`"
              :value="n"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rescheduleVisible = false">取消</el-button>
        <el-button type="primary" @click="submitReschedule">确定</el-button>
      </template>
    </el-dialog>

    <!-- 代课子弹窗 -->
    <el-dialog
      v-model="substituteVisible"
      title="安排代课"
      width="400px"
      append-to-body
    >
      <el-form label-width="80px">
        <el-form-item label="代课人">
          <el-select
            v-model="substituteForm.substitute_teacher_id"
            placeholder="请选择教师"
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
      </el-form>
      <template #footer>
        <el-button @click="substituteVisible = false">取消</el-button>
        <el-button type="primary" @click="submitSubstitute">确定</el-button>
      </template>
    </el-dialog>
  </el-drawer>
</template>

<style lang="scss" scoped>
.drawer-body {
  min-height: 200px;
}

.drawer-head__title {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  color: var(--ink-800);
}

.drawer-head__time {
  font-size: var(--text-sm);
  font-weight: var(--weight-normal);
  color: var(--ink-500);
  font-variant-numeric: tabular-nums;
}

.drawer-tabs {
  margin-top: var(--space-4);
}

.tab-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
  margin-bottom: var(--space-3);
}

.drawer-footer {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}
</style>
