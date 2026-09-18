<script setup lang="ts">
import EpPrinter from "~icons/ep/printer";
import { ref, computed } from "vue";
import { ElMessage } from "element-plus";
import { getStudentList } from "@/api/attendance";
import { getStudentReport } from "@/api/teaching";
import { useUserStoreHook } from "@/store/modules/user";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "TeachingReports"
});

/* 金额可见性（2026-09-12 权限收紧）：仅 admin 可见；教师端后端已不返回 amount/paid，
   此处隐藏对应列，避免把缺失字段渲染成误导性的 ¥0.00 */
const isAdmin = computed(() => useUserStoreHook().roles.includes("admin"));

/* ---------- 学员选择 ---------- */
const studentOptions = ref<any[]>([]);
const studentLoading = ref(false);
const studentId = ref<number | null>(null);

function remoteSearch(query: string) {
  const kw = (query || "").trim();
  if (!kw) {
    studentOptions.value = [];
    return;
  }
  studentLoading.value = true;
  getStudentList({ keyword: kw, page: 1, pageSize: 20 })
    .then((res: any) => {
      if (res.success) studentOptions.value = res.data.list;
    })
    .finally(() => (studentLoading.value = false));
}

/* ---------- 学习报告 ---------- */
const reportLoading = ref(false);
const report = ref<any>(null);

const student = computed(() => report.value?.student || {});
const attendance = computed(() => report.value?.attendance || {});
const scores = computed(() => report.value?.scores || []);
const hours = computed(() => report.value?.hours || []);
const orders = computed(() => report.value?.orders || []);

function loadReport() {
  if (!studentId.value) return;
  reportLoading.value = true;
  report.value = null;
  getStudentReport(studentId.value)
    .then((res: any) => {
      if (res.success) {
        report.value = res.data;
      } else {
        ElMessage.error(res.message || "加载学习报告失败");
      }
    })
    .finally(() => (reportLoading.value = false));
}

/* ---------- 展示辅助 ---------- */
function fmtMoney(v: any) {
  return `¥${(Number(v) || 0).toFixed(2)}`;
}

function rateColor(rate: any) {
  const r = Number(rate) || 0;
  return r >= 90 ? "#67C23A" : r >= 60 ? "#E6A23C" : "#F56C6C";
}

function gradeTag(grade: string) {
  const map: Record<string, any> = {
    优: "success",
    良: "",
    中: "warning",
    及格: "warning",
    不及格: "danger"
  };
  return map[grade] || "";
}

function statusTag(status: string) {
  const map: Record<string, any> = {
    在读: "success",
    结业: "info",
    退班: "danger",
    休学: "warning",
    退学: "danger"
  };
  return map[status] || "";
}

function hoursPercent(h: any) {
  const total = Number(h.total_hours) || 0;
  if (!total) return 0;
  const remain = Number(h.remain_hours) || 0;
  const consumed = Number(h.consumed ?? total - remain);
  return Math.max(0, Math.min(100, Math.round((consumed / total) * 100)));
}

function hoursStatus(p: number) {
  if (p >= 90) return "exception";
  if (p >= 70) return "warning";
  return "success";
}

function handlePrint() {
  window.print();
}
</script>

<template>
  <div class="app-page">
    <AppPageHeader title="学习报告" description="按学员生成阶段性学习报告" />
    <!-- 学员选择 -->
    <el-card shadow="never" class="mb-4">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[13px] text-gray-500">选择学员：</span>
        <el-select
          v-model="studentId"
          filterable
          remote
          clearable
          reserve-keyword
          :remote-method="remoteSearch"
          :loading="studentLoading"
          placeholder="输入姓名 / 学号搜索学员"
          class="!w-72"
          @change="loadReport"
          @clear="report = null"
        >
          <el-option
            v-for="s in studentOptions"
            :key="s.id"
            :label="`${s.name}（${s.student_no}）${s.class_name ? '· ' + s.class_name : ''}`"
            :value="s.id"
          />
        </el-select>
        <div class="flex-1" />
        <el-button
          type="primary"
          plain
          :disabled="!report"
          @click="handlePrint"
        >
          <el-icon class="mr-1"><EpPrinter /></el-icon>
          打印 / 导出
        </el-button>
      </div>
    </el-card>

    <div id="printReport" v-loading="reportLoading">
      <template v-if="report">
        <!-- 学员信息卡片 -->
        <el-card shadow="never" class="mb-4">
          <template #header><span class="font-medium">学员信息</span></template>
          <el-descriptions :column="4" border>
            <el-descriptions-item label="姓名">{{
              student.name || "-"
            }}</el-descriptions-item>
            <el-descriptions-item label="学号">{{
              student.student_no || "-"
            }}</el-descriptions-item>
            <el-descriptions-item label="班级">{{
              student.class_name || "-"
            }}</el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag :type="statusTag(student.status)" size="small">{{
                student.status || "-"
              }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="家长姓名">{{
              student.parent_name || "-"
            }}</el-descriptions-item>
            <el-descriptions-item label="家长电话">{{
              student.parent_phone || "-"
            }}</el-descriptions-item>
            <el-descriptions-item label="来源渠道">{{
              student.source_channel || "-"
            }}</el-descriptions-item>
            <el-descriptions-item label="报名日期">{{
              student.enroll_date || "-"
            }}</el-descriptions-item>
          </el-descriptions>
        </el-card>

        <!-- 考勤概况（近30天） -->
        <el-card shadow="never" class="mb-4">
          <template #header
            ><span class="font-medium">考勤概况（近30天）</span></template
          >
          <el-row :gutter="16">
            <el-col
              v-for="item in [
                {
                  label: '总出勤',
                  value: attendance.total ?? 0,
                  color: '#409EFF'
                },
                {
                  label: '正常',
                  value: attendance.normal ?? 0,
                  color: '#67C23A'
                },
                {
                  label: '迟到',
                  value: attendance.late ?? 0,
                  color: '#E6A23C'
                },
                {
                  label: '早退',
                  value: attendance.early ?? 0,
                  color: '#E6A23C'
                },
                {
                  label: '缺勤',
                  value: attendance.absent ?? 0,
                  color: '#F56C6C'
                },
                {
                  label: '请假',
                  value: attendance.leave ?? 0,
                  color: '#909399'
                }
              ]"
              :key="item.label"
              :xs="12"
              :sm="8"
              :md="4"
            >
              <el-card shadow="never" class="text-center">
                <div class="text-[13px] text-gray-500">{{ item.label }}</div>
                <div
                  class="mt-1 text-[22px] font-bold"
                  :style="{ color: item.color }"
                >
                  {{ item.value }}
                </div>
              </el-card>
            </el-col>
          </el-row>
          <div class="mt-3 text-sm text-gray-600">
            出勤率：
            <b :style="{ color: rateColor(attendance.attendance_rate) }"
              >{{ attendance.attendance_rate ?? 0 }}%</b
            >
          </div>
        </el-card>

        <!-- 考试成绩 -->
        <el-card shadow="never" class="mb-4">
          <template #header><span class="font-medium">考试成绩</span></template>
          <el-table :data="scores" border stripe size="small">
            <el-table-column prop="course_name" label="课程" min-width="140" />
            <el-table-column prop="exam_name" label="考试" min-width="140" />
            <el-table-column label="分数" width="90" align="center">
              <template #default="{ row }">{{ row.score ?? "-" }}</template>
            </el-table-column>
            <el-table-column
              prop="full_score"
              label="满分"
              width="80"
              align="center"
            />
            <el-table-column label="等级" width="80" align="center">
              <template #default="{ row }">
                <el-tag
                  v-if="row.grade"
                  :type="gradeTag(row.grade)"
                  size="small"
                  >{{ row.grade }}</el-tag
                >
                <span v-else class="text-gray-300">-</span>
              </template>
            </el-table-column>
            <el-table-column prop="exam_date" label="日期" min-width="110" />
            <template #empty>
              <el-empty description="暂无考试成绩" :image-size="60" />
            </template>
          </el-table>
        </el-card>

        <!-- 课时包进度 -->
        <el-card shadow="never" class="mb-4">
          <template #header
            ><span class="font-medium">课时包进度</span></template
          >
          <el-table :data="hours" border stripe size="small">
            <el-table-column prop="course_name" label="课程" min-width="140" />
            <el-table-column prop="class_name" label="班级" min-width="120" />
            <el-table-column
              prop="total_hours"
              label="总课时"
              width="90"
              align="center"
            />
            <el-table-column
              prop="remain_hours"
              label="剩余课时"
              width="90"
              align="center"
            />
            <el-table-column label="消耗进度" min-width="180">
              <template #default="{ row }">
                <el-progress
                  :percentage="hoursPercent(row)"
                  :stroke-width="14"
                  :text-inside="true"
                  :status="hoursStatus(hoursPercent(row))"
                  :format="(p: number) => `已消耗 ${p}%`"
                />
              </template>
            </el-table-column>
            <template #empty>
              <el-empty description="暂无课时包" :image-size="60" />
            </template>
          </el-table>
        </el-card>

        <!-- 在读订单摘要 -->
        <el-card shadow="never">
          <template #header
            ><span class="font-medium">在读订单摘要</span></template
          >
          <el-table :data="orders" border stripe size="small">
            <el-table-column prop="course_name" label="课程" min-width="140" />
            <el-table-column prop="class_name" label="班级" min-width="120" />
            <el-table-column
              v-if="isAdmin"
              label="报名金额"
              width="110"
              align="right"
            >
              <template #default="{ row }">{{ fmtMoney(row.amount) }}</template>
            </el-table-column>
            <el-table-column
              v-if="isAdmin"
              label="已缴金额"
              width="110"
              align="right"
            >
              <template #default="{ row }">{{ fmtMoney(row.paid) }}</template>
            </el-table-column>
            <el-table-column label="状态" width="90" align="center">
              <template #default="{ row }">
                <el-tag :type="statusTag(row.status)" size="small">{{
                  row.status || "-"
                }}</el-tag>
              </template>
            </el-table-column>
            <template #empty>
              <el-empty description="暂无在读订单" :image-size="60" />
            </template>
          </el-table>
        </el-card>
      </template>

      <el-empty
        v-else-if="!reportLoading"
        description="请先选择学员查看学习报告"
        :image-size="80"
      />
    </div>
  </div>
</template>

<style>
/* 打印：仅输出 #printReport 区域 */
@media print {
  body * {
    visibility: hidden;
  }
  #printReport,
  #printReport * {
    visibility: visible;
  }
  #printReport {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    padding: 0;
  }
}
</style>
