<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { ElMessage } from "element-plus";
import { getStudentProfile, getStudentList } from "@/api/attendance";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "StudentProfile"
});

const route = useRoute();
const loading = ref(false);
const profile = ref<any>(null);
const activeTab = ref("orders");

/* 未指定学员时的选择器 */
const searchKw = ref("");
const searching = ref(false);
const candidates = ref<any[]>([]);

const canSeeAmount = computed(() => profile.value?.can_see_amount === true);
const student = computed<any>(() => profile.value?.student || {});
const summary = computed<any>(() => profile.value?.summary || {});
const orders = computed<any[]>(() => profile.value?.orders || []);
const consumptions = computed<any[]>(() => profile.value?.consumptions || []);
const attStats = computed<Record<string, number>>(
  () => profile.value?.attendance_stats || {}
);
const attendances = computed<any[]>(() => profile.value?.attendances || []);
const pendingDeduct = computed(() =>
  Number(profile.value?.pending_deduct_count || 0)
);
const attTotal = computed(() =>
  Object.values(attStats.value).reduce((s, v) => s + Number(v || 0), 0)
);
/** 卡片是「在读」口径；有已结业/退班订单时必须给出对照，否则 0 会被读成「没数据」 */
const closedOrderCount = computed(() =>
  Number(summary.value.closed_order_count || 0)
);

function n(v: any) {
  return Number(v ?? 0);
}

/** 课次文案：手工点名的考勤没有关联课次，必须显式说明而不是留空白格 */
function sessLabel(row: any) {
  if (!row.session_id) return "未关联课次";
  const parts: string[] = [];
  if (row.period) parts.push(`第 ${row.period} 节`);
  if (row.start_time && row.end_time) {
    parts.push(`${row.start_time}-${row.end_time}`);
  }
  return parts.join(" · ") || "已关联课次";
}

/** 考勤状态 → el-tag 配色（与全站既有配色保持一致） */
function attTagType(status: string) {
  if (status === "缺勤") return "danger";
  if (status === "请假") return "warning";
  if (status === "正常") return "success";
  return "info";
}

/** 扣课状态 → el-tag 配色 */
function deductTagType(state: string) {
  if (state === "已扣") return "success";
  if (state === "欠扣") return "danger";
  return "info";
}

function fmtMoney(v: any) {
  if (v === null || v === undefined) return "—";
  return `¥${(Number(v) || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function load(id: number) {
  loading.value = true;
  getStudentProfile(id)
    .then((res: any) => {
      if (res.success) {
        profile.value = res.data;
      } else {
        ElMessage.error(res.message || "加载学员档案失败");
      }
    })
    .catch(() => {
      ElMessage.error("加载学员档案失败");
    })
    .finally(() => (loading.value = false));
}

function doSearch() {
  const kw = searchKw.value.trim();
  if (!kw) {
    ElMessage.warning("请输入学号或姓名");
    return;
  }
  searching.value = true;
  getStudentList({ keyword: kw, page: 1, pageSize: 20 })
    .then((res: any) => {
      candidates.value = res?.data?.list || [];
      if (!candidates.value.length) ElMessage.info("未找到匹配的学员");
    })
    .finally(() => (searching.value = false));
}

function pick(row: any) {
  candidates.value = [];
  load(row.id);
}

function reset() {
  profile.value = null;
  candidates.value = [];
  searchKw.value = "";
}

onMounted(() => {
  const qid = Number(route.query.id);
  if (Number.isFinite(qid) && qid > 0) load(qid);
});
</script>

<template>
  <div class="app-page">
    <AppPageHeader
      title="学员档案"
      description="课时、账户与考勤明细（剩余学费口径见 ADR-003）"
    />

    <!-- 未指定学员：先搜索 -->
    <el-card v-if="!profile" v-loading="loading" shadow="never">
      <div class="flex flex-wrap items-center gap-2">
        <el-input
          v-model="searchKw"
          placeholder="输入学号或姓名"
          class="!w-60"
          clearable
          @keyup.enter="doSearch"
        />
        <el-button type="primary" :loading="searching" @click="doSearch"
          >查询学员</el-button
        >
      </div>
      <el-table
        v-if="candidates.length"
        :data="candidates"
        border
        stripe
        class="mt-4"
      >
        <el-table-column prop="student_no" label="学号" width="130" />
        <el-table-column prop="name" label="姓名" width="120" />
        <el-table-column prop="class_name" label="班级" min-width="140" />
        <el-table-column label="操作" width="110" align="center">
          <template #default="{ row }">
            <el-button type="primary" link @click="pick(row)"
              >查看档案</el-button
            >
          </template>
        </el-table-column>
      </el-table>
      <el-empty
        v-else
        description="请先搜索学员（也可从「学生管理」列表点「档案」直接进入）"
        :image-size="70"
      />
    </el-card>

    <template v-else>
      <!-- 基本信息 -->
      <el-card v-loading="loading" shadow="never" class="mb-4">
        <div class="mb-3 flex items-center gap-2">
          <span class="text-lg font-semibold">{{ student.name }}</span>
          <el-tag size="small" type="info">{{ student.status }}</el-tag>
          <div class="flex-1" />
          <el-button link @click="reset">切换学员</el-button>
        </div>
        <el-descriptions :column="4" border size="small">
          <el-descriptions-item label="学号">{{
            student.student_no || "—"
          }}</el-descriptions-item>
          <el-descriptions-item label="性别">{{
            student.gender || "—"
          }}</el-descriptions-item>
          <el-descriptions-item label="班级">{{
            student.class_name || "—"
          }}</el-descriptions-item>
          <el-descriptions-item label="班主任">{{
            student.head_teacher_name || "—"
          }}</el-descriptions-item>
          <el-descriptions-item label="手机号">{{
            student.phone || "—"
          }}</el-descriptions-item>
          <el-descriptions-item label="家长姓名">{{
            student.parent_name || "—"
          }}</el-descriptions-item>
          <el-descriptions-item label="家长电话">{{
            student.parent_phone || "—"
          }}</el-descriptions-item>
          <el-descriptions-item label="来源渠道">{{
            student.source_channel || "—"
          }}</el-descriptions-item>
        </el-descriptions>
      </el-card>

      <!-- 账户与课时汇总（在读订单口径） -->
      <el-row :gutter="16" :class="closedOrderCount > 0 ? 'mb-2' : 'mb-4'">
        <el-col :xs="12" :sm="6">
          <el-card shadow="never" class="text-center">
            <div class="text-sm text-gray-500">在读总课时</div>
            <div class="mt-1 text-2xl font-bold">
              {{ n(summary.total_hours) }}
            </div>
            <div
              v-if="n(summary.active_order_count) === 0"
              class="mt-1 text-xs text-amber-600"
            >
              无在读订单
            </div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="6">
          <el-card shadow="never" class="text-center">
            <div class="text-sm text-gray-500">已耗课时</div>
            <div class="mt-1 text-2xl font-bold text-amber-600">
              {{ n(summary.consumed_hours) }}
            </div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="6">
          <el-card shadow="never" class="text-center">
            <div class="text-sm text-gray-500">剩余课时</div>
            <div
              class="mt-1 text-2xl font-bold"
              :class="
                n(summary.remain_hours) <= 5 ? 'text-red-500' : 'text-blue-600'
              "
            >
              {{ n(summary.remain_hours) }}
            </div>
          </el-card>
        </el-col>
        <el-col v-if="canSeeAmount" :xs="12" :sm="6">
          <el-card shadow="never" class="text-center">
            <div class="text-sm text-gray-500">剩余学费</div>
            <div class="mt-1 text-2xl font-bold text-green-600">
              {{ fmtMoney(summary.balance_total) }}
            </div>
          </el-card>
        </el-col>
      </el-row>

      <!-- 口径说明条：卡片（在读口径）与下方表格（全部订单）数字不同时必须讲清楚 -->
      <el-alert
        v-if="closedOrderCount > 0"
        type="info"
        :closable="false"
        show-icon
        class="mb-4"
        title="上方课时卡的口径（仅统计「在读」订单）"
      >
        <div>
          当前 <strong>{{ n(summary.active_order_count) }}</strong> 单在读 ·
          <strong>{{ n(summary.closed_order_count) }}</strong> 单已结业或退班。
          <template v-if="n(summary.active_order_count) === 0">
            该学员<strong>没有在读订单</strong>，所以卡内为 0
            <strong>不代表没有记录</strong> —— 明细见下方「报班与账户」。
          </template>
        </div>
        <div class="mt-1">
          含已结业/退班的<strong>全部订单</strong>合计：总课时
          {{ n(summary.total_hours_all) }} · 已耗
          {{ n(summary.consumed_hours_all) }} · 剩余
          {{ n(summary.remain_hours_all) }}
          <template v-if="canSeeAmount">
            · 剩余学费 {{ fmtMoney(summary.balance_total_all) }}
          </template>
          <span class="text-gray-500"
            >（仅参考；ADR-003 的剩余学费只认「在读」订单）</span
          >
        </div>
      </el-alert>

      <el-card shadow="never">
        <el-tabs v-model="activeTab">
          <!-- 报班与账户 -->
          <el-tab-pane label="报班与账户" name="orders">
            <div class="mb-2 text-xs text-gray-500">
              每个课时包独立计算余额，再汇总 —— 避免家长质疑时说不清（ADR-003）
            </div>
            <el-table :data="orders" border stripe>
              <el-table-column
                prop="course_name"
                label="课程"
                min-width="120"
                show-overflow-tooltip
              />
              <el-table-column
                prop="class_name"
                label="班级"
                min-width="120"
                show-overflow-tooltip
              />
              <el-table-column
                prop="enroll_date"
                label="报名日期"
                width="110"
              />
              <el-table-column label="总课时" width="80" align="center">
                <template #default="{ row }">{{ n(row.total_hours) }}</template>
              </el-table-column>
              <el-table-column label="已耗" width="80" align="center">
                <template #default="{ row }">{{
                  n(row.consumed_hours)
                }}</template>
              </el-table-column>
              <el-table-column label="剩余课时" width="90" align="center">
                <template #default="{ row }">
                  <span
                    :class="
                      n(row.remain_hours) <= 5
                        ? 'font-semibold text-red-500'
                        : ''
                    "
                    >{{ n(row.remain_hours) }}</span
                  >
                </template>
              </el-table-column>
              <template v-if="canSeeAmount">
                <el-table-column label="订单金额" width="110" align="right">
                  <template #default="{ row }">{{
                    fmtMoney(row.amount)
                  }}</template>
                </el-table-column>
                <el-table-column label="实缴" width="110" align="right">
                  <template #default="{ row }">{{
                    fmtMoney(row.paid)
                  }}</template>
                </el-table-column>
                <el-table-column label="剩余学费" min-width="180">
                  <template #default="{ row }">
                    <div class="font-semibold text-green-600">
                      {{ fmtMoney(row.balance) }}
                    </div>
                    <div class="text-xs text-gray-400">
                      {{ row.formula }}
                    </div>
                  </template>
                </el-table-column>
              </template>
              <el-table-column prop="status" label="状态" width="80" />
              <template #empty>
                <el-empty description="该学员暂无报班记录" :image-size="60" />
              </template>
            </el-table>
          </el-tab-pane>

          <!-- 课时流水 -->
          <el-tab-pane label="课时流水" name="flow">
            <el-table :data="consumptions" border stripe>
              <el-table-column prop="date" label="日期" width="120" />
              <el-table-column
                prop="course_name"
                label="课程"
                min-width="120"
                show-overflow-tooltip
              />
              <el-table-column prop="type" label="类型" width="90">
                <template #default="{ row }">
                  <el-tag
                    size="small"
                    :type="row.type === '回补' ? 'warning' : 'danger'"
                    >{{ row.type }}</el-tag
                  >
                </template>
              </el-table-column>
              <el-table-column prop="source" label="来源" width="110" />
              <el-table-column label="课时" width="80" align="center">
                <template #default="{ row }">{{ n(row.hours) }}</template>
              </el-table-column>
              <template #empty>
                <el-empty description="暂无课时流水" :image-size="60" />
              </template>
            </el-table>
          </el-tab-pane>

          <!-- 考勤统计 -->
          <el-tab-pane label="考勤统计" name="att">
            <template v-if="attTotal > 0">
              <div class="mb-2 flex flex-wrap items-center gap-3">
                <div class="text-sm text-gray-500">
                  累计考勤 {{ attTotal }} 次
                </div>
                <el-tag
                  v-for="(v, k) in attStats"
                  :key="k"
                  :type="attTagType(String(k))"
                >
                  {{ k }} {{ v }} 次
                </el-tag>
              </div>

              <!-- 静默即缺陷：欠扣必须显式告知并给出下一步 -->
              <el-alert
                v-if="pendingDeduct > 0"
                type="warning"
                :closable="false"
                show-icon
                class="mb-2"
                :title="`有 ${pendingDeduct} 条出勤记录至今未扣课时`"
                description="这些考勤对应的课时没有从课时包里扣掉（旧版扣课只在「状态变化的那一瞬间」执行，错过就永久漏扣）。可在「财务 → 课时对账」中补扣；若对应订单已结业/退班，需先处理订单状态。"
              />

              <el-table :data="attendances" border stripe>
                <el-table-column prop="date" label="日期" width="120" />
                <el-table-column
                  prop="course_name"
                  label="课程"
                  min-width="120"
                  show-overflow-tooltip
                />
                <el-table-column label="课次" min-width="150">
                  <template #default="{ row }">
                    <span :class="row.session_id ? '' : 'text-gray-400'">{{
                      sessLabel(row)
                    }}</span>
                  </template>
                </el-table-column>
                <el-table-column
                  prop="status"
                  label="考勤状态"
                  width="100"
                  align="center"
                >
                  <template #default="{ row }">
                    <el-tag size="small" :type="attTagType(row.status)">{{
                      row.status
                    }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="课时扣减" width="110" align="center">
                  <template #default="{ row }">
                    <el-tag
                      size="small"
                      :type="deductTagType(row.deduct_state)"
                      >{{ row.deduct_state }}</el-tag
                    >
                  </template>
                </el-table-column>
                <template #empty>
                  <el-empty description="该学员暂无考勤记录" :image-size="60" />
                </template>
              </el-table>
            </template>
            <el-empty
              v-else
              description="该学员暂无考勤记录"
              :image-size="60"
            />
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </template>
  </div>
</template>
