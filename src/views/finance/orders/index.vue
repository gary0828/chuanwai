<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  getFinanceOrders,
  getFinanceOrderDetail,
  createFinanceOrder,
  updateFinanceOrder,
  updateFinanceOrderStatus,
  deleteFinanceOrder,
  createFinancePayment,
  createFinanceRefund,
  getStudentList,
  getAllClasses,
  getAllCourses
} from "@/api/attendance";
import { useUserStoreHook } from "@/store/modules/user";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "FinanceOrders"
});

const isAdmin = computed(() => useUserStoreHook().roles.includes("admin"));
const loading = ref(false);
const dataList = ref<any[]>([]);
const searchForm = reactive({ status: "", keyword: "", class_id: "" });
const pagination = reactive({ page: 1, pageSize: 10, total: 0 });

// 下拉数据
const classOptions = ref<any[]>([]);
const courseOptions = ref<any[]>([]);

const STATUS_OPTIONS = [
  { label: "在读", value: "在读" },
  { label: "结业", value: "结业" },
  { label: "退班", value: "退班" }
];
const STATUS_TAG = { 在读: "success", 结业: "info", 退班: "danger" } as Record<
  string,
  string
>;

// 新增订单弹窗
const createVisible = ref(false);
const createForm = reactive({
  student_id: 0,
  class_id: "",
  course_id: "",
  enroll_date: "",
  amount: 0,
  total_hours: 0,
  remark: ""
});
const studentOptions = ref<any[]>([]);
const studentLoading = ref(false);
const submitting = ref(false);

// 编辑弹窗
const editVisible = ref(false);
const editForm = reactive({
  id: 0,
  class_id: "",
  course_id: "",
  amount: 0,
  total_hours: 0,
  remain_hours: 0,
  remark: ""
});

// 详情弹窗（含缴费明细与退费记录）
const detailVisible = ref(false);
const detail = ref<any>(null);

// 登记缴费 / 提交退费弹窗
const payVisible = ref(false);
const payForm = reactive({
  amount: 0,
  pay_method: "转账",
  pay_time: "",
  remark: ""
});
const refundVisible = ref(false);
const refundForm = reactive({ amount: 0, reason: "", remark: "" });

function fmtMoney(v: any) {
  return `¥${(Number(v) || 0).toFixed(2)}`;
}

function loadData() {
  loading.value = true;
  const params: Record<string, any> = {
    ...searchForm,
    page: pagination.page,
    pageSize: pagination.pageSize
  };
  getFinanceOrders(params)
    .then((res: any) => {
      if (res.success) {
        dataList.value = res.data.list;
        pagination.total = res.data.total;
      }
    })
    .finally(() => (loading.value = false));
}

function handleSearch() {
  pagination.page = 1;
  loadData();
}

function handleReset() {
  searchForm.status = "";
  searchForm.keyword = "";
  searchForm.class_id = "";
  handleSearch();
}

function loadOptions() {
  getAllClasses().then((res: any) => {
    if (res.success) classOptions.value = res.data || [];
  });
  getAllCourses().then((res: any) => {
    if (res.success) courseOptions.value = res.data || [];
  });
}

/** 学员远程搜索 */
function searchStudents(keyword: string) {
  studentLoading.value = true;
  getStudentList({ name: keyword, page: 1, pageSize: 20 })
    .then((res: any) => {
      if (res.success) studentOptions.value = res.data.list || [];
    })
    .finally(() => (studentLoading.value = false));
}

function openCreate() {
  Object.assign(createForm, {
    student_id: 0,
    class_id: "",
    course_id: "",
    enroll_date: "",
    amount: 0,
    total_hours: 0,
    remark: ""
  });
  studentOptions.value = [];
  createVisible.value = true;
}

function handleCreate() {
  if (!createForm.student_id) {
    ElMessage.warning("请选择学员");
    return;
  }
  submitting.value = true;
  createFinanceOrder({
    ...createForm,
    student_id: Number(createForm.student_id),
    class_id: createForm.class_id ? Number(createForm.class_id) : null,
    course_id: createForm.course_id ? Number(createForm.course_id) : null,
    amount: Number(createForm.amount),
    total_hours: Number(createForm.total_hours) || 0
  })
    .then((res: any) => {
      if (res.success) {
        ElMessage.success("报班成功");
        createVisible.value = false;
        handleSearch();
      }
    })
    .finally(() => (submitting.value = false));
}

function openEdit(row: any) {
  Object.assign(editForm, {
    id: row.id,
    class_id: row.class_id ?? "",
    course_id: row.course_id ?? "",
    amount: row.amount,
    total_hours: row.total_hours ?? 0,
    remain_hours: row.remain_hours ?? 0,
    remark: row.remark
  });
  editVisible.value = true;
}

function handleEdit() {
  submitting.value = true;
  updateFinanceOrder(editForm.id, {
    class_id: editForm.class_id ? Number(editForm.class_id) : null,
    course_id: editForm.course_id ? Number(editForm.course_id) : null,
    amount: Number(editForm.amount),
    total_hours: Number(editForm.total_hours) || 0,
    remain_hours: Number(editForm.remain_hours) || 0,
    remark: editForm.remark
  })
    .then((res: any) => {
      if (res.success) {
        ElMessage.success("修改成功");
        editVisible.value = false;
        loadData();
      }
    })
    .finally(() => (submitting.value = false));
}

function handleStatus(row: any, status: string) {
  ElMessageBox.confirm(`确定将该订单标记为「${status}」吗？`, "提示", {
    type: "warning",
    confirmButtonText: "确认",
    cancelButtonText: "取消"
  })
    .then(() => {
      updateFinanceOrderStatus(row.id, { status }).then((res: any) => {
        if (res.success) {
          ElMessage.success("操作成功");
          loadData();
        }
      });
    })
    .catch(() => {});
}

function handleDelete(row: any) {
  ElMessageBox.confirm(
    `确定删除订单#${row.id}（${row.student_name}）吗？仅删除该报班订单及其缴费/退费记录，不影响学员档案，删除后不可恢复！`,
    "危险操作",
    { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" }
  )
    .then(() => {
      deleteFinanceOrder(row.id).then((res: any) => {
        if (res.success) {
          ElMessage.success("删除成功");
          loadData();
        }
      });
    })
    .catch(() => {});
}

function openDetail(row: any) {
  detail.value = null;
  detailVisible.value = true;
  getFinanceOrderDetail(row.id).then((res: any) => {
    if (res.success) detail.value = res.data;
  });
}

function openPay() {
  Object.assign(payForm, {
    amount: 0,
    pay_method: "转账",
    pay_time: "",
    remark: ""
  });
  payVisible.value = true;
}

function handlePay() {
  const amount = Number(payForm.amount);
  if (!(amount > 0)) {
    ElMessage.warning("请输入有效缴费金额");
    return;
  }
  submitting.value = true;
  createFinancePayment({
    order_id: detail.value.id,
    student_id: detail.value.student_id,
    amount,
    pay_method: payForm.pay_method,
    pay_time: payForm.pay_time,
    remark: payForm.remark
  })
    .then((res: any) => {
      if (res.success) {
        ElMessage.success("缴费登记成功");
        payVisible.value = false;
        openDetail({ id: detail.value.id });
      }
    })
    .finally(() => (submitting.value = false));
}

function openRefund() {
  Object.assign(refundForm, { amount: 0, reason: "", remark: "" });
  refundVisible.value = true;
}

function handleRefund() {
  const amount = Number(refundForm.amount);
  if (!(amount > 0)) {
    ElMessage.warning("请输入有效退费金额");
    return;
  }
  submitting.value = true;
  createFinanceRefund({
    order_id: detail.value.id,
    student_id: detail.value.student_id,
    amount,
    reason: refundForm.reason,
    remark: refundForm.remark
  })
    .then((res: any) => {
      if (res.success) {
        ElMessage.success("退费申请已提交");
        refundVisible.value = false;
        openDetail({ id: detail.value.id });
      }
    })
    .finally(() => (submitting.value = false));
}

onMounted(() => {
  loadData();
  loadOptions();
});
</script>

<template>
  <div class="app-page">
    <AppPageHeader title="报班管理" description="报名订单与学员账户余额" />
    <el-card shadow="never">
      <!-- 筛选 -->
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <el-input
          v-model="searchForm.keyword"
          placeholder="学员姓名 / 学号"
          clearable
          class="!w-44"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-select
          v-model="searchForm.status"
          placeholder="订单状态"
          clearable
          class="!w-32"
        >
          <el-option
            v-for="o in STATUS_OPTIONS"
            :key="o.value"
            :label="o.label"
            :value="o.value"
          />
        </el-select>
        <el-select
          v-model="searchForm.class_id"
          placeholder="班级"
          clearable
          filterable
          class="!w-40"
        >
          <el-option
            v-for="o in classOptions"
            :key="o.id"
            :label="o.name"
            :value="String(o.id)"
          />
        </el-select>
        <el-button type="primary" @click="handleSearch">搜索</el-button>
        <el-button @click="handleReset">重置</el-button>
        <div class="flex-1" />
        <el-button type="primary" @click="openCreate">新增报班</el-button>
      </div>

      <!-- 表格 -->
      <el-table v-loading="loading" :data="dataList" border stripe>
        <el-table-column type="index" label="#" width="55" align="center" />
        <el-table-column prop="student_no" label="学号" width="110" />
        <el-table-column prop="student_name" label="学员" width="100" />
        <el-table-column prop="class_name" label="班级" min-width="110" />
        <el-table-column prop="course_name" label="课程" min-width="110">
          <template #default="{ row }">{{ row.course_name || "—" }}</template>
        </el-table-column>
        <el-table-column prop="enroll_date" label="报名日期" width="110" />
        <el-table-column label="订单金额" width="100" align="right">
          <template #default="{ row }">{{ fmtMoney(row.amount) }}</template>
        </el-table-column>
        <el-table-column label="课时(剩/总)" width="105" align="center">
          <template #default="{ row }">
            <template v-if="row.total_hours > 0">
              <span
                :class="
                  row.remain_hours <= 5 ? 'font-semibold text-red-500' : ''
                "
                >{{ row.remain_hours }}</span
              >
              <span class="text-gray-400">/{{ row.total_hours }}</span>
            </template>
            <span v-else class="text-gray-400">—</span>
          </template>
        </el-table-column>
        <el-table-column label="已缴" width="100" align="right">
          <template #default="{ row }">
            <span class="text-green-600">{{ fmtMoney(row.paid) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="欠费" width="100" align="right">
          <template #default="{ row }">
            <span
              :class="row.paid < row.amount ? 'text-red-500' : 'text-gray-400'"
            >
              {{ fmtMoney(Math.max(0, row.amount - row.paid)) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="STATUS_TAG[row.status] || 'info'" size="small">{{
              row.status
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column
          prop="enroll_user_name"
          label="报名老师"
          width="100"
          align="center"
        >
          <template #default="{ row }">{{
            row.enroll_user_name || "—"
          }}</template>
        </el-table-column>
        <el-table-column label="操作" width="220" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)"
              >详情</el-button
            >
            <el-button
              v-if="row.status === '在读'"
              link
              type="success"
              @click="handleStatus(row, '结业')"
              >结业</el-button
            >
            <el-button
              v-if="row.status === '在读'"
              link
              type="warning"
              @click="handleStatus(row, '退班')"
              >退班</el-button
            >
            <el-button
              v-if="row.status !== '退班'"
              link
              type="primary"
              @click="openEdit(row)"
              >编辑</el-button
            >
            <el-button
              v-if="isAdmin"
              link
              type="danger"
              @click="handleDelete(row)"
              >删除</el-button
            >
          </template>
        </el-table-column>
        <template #empty>
          <el-empty
            description="暂无报班订单，点击右上角「新增报班」创建"
            :image-size="60"
          />
        </template>
      </el-table>

      <!-- 分页 -->
      <div class="mt-4 flex justify-end">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :total="pagination.total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next, jumper"
          background
          @size-change="loadData"
          @current-change="loadData"
        />
      </div>
    </el-card>

    <!-- 新增报班 -->
    <el-dialog
      v-model="createVisible"
      title="新增报班"
      width="520px"
      destroy-on-close
    >
      <el-form label-width="90px">
        <el-form-item label="学员" required>
          <el-select
            v-model="createForm.student_id"
            placeholder="输入姓名/学号搜索"
            filterable
            remote
            :remote-method="searchStudents"
            :loading="studentLoading"
            class="w-full"
          >
            <el-option
              v-for="s in studentOptions"
              :key="s.id"
              :label="`${s.name}（${s.student_no}）`"
              :value="s.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="班级">
          <el-select
            v-model="createForm.class_id"
            placeholder="选择班级"
            clearable
            filterable
            class="w-full"
          >
            <el-option
              v-for="o in classOptions"
              :key="o.id"
              :label="o.name"
              :value="String(o.id)"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="课程">
          <el-select
            v-model="createForm.course_id"
            placeholder="选择课程"
            clearable
            filterable
            class="w-full"
          >
            <el-option
              v-for="o in courseOptions"
              :key="o.id"
              :label="o.name"
              :value="String(o.id)"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="报名日期">
          <el-date-picker
            v-model="createForm.enroll_date"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="默认今天"
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="订单金额">
          <el-input-number
            v-model="createForm.amount"
            :min="0"
            :precision="2"
            :step="100"
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="总课时">
          <el-input-number
            v-model="createForm.total_hours"
            :min="0"
            :precision="0"
            :step="10"
            class="w-full"
          />
          <span class="ml-2 text-xs text-gray-400"
            >考勤正常/迟到/早退自动扣 1 课时</span
          >
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="createForm.remark"
            type="textarea"
            :rows="2"
            placeholder="选填"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleCreate"
          >确认报班</el-button
        >
      </template>
    </el-dialog>

    <!-- 编辑订单 -->
    <el-dialog
      v-model="editVisible"
      title="编辑订单"
      width="480px"
      destroy-on-close
    >
      <el-form label-width="90px">
        <el-form-item label="班级">
          <el-select
            v-model="editForm.class_id"
            placeholder="选择班级"
            clearable
            filterable
            class="w-full"
          >
            <el-option
              v-for="o in classOptions"
              :key="o.id"
              :label="o.name"
              :value="String(o.id)"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="课程">
          <el-select
            v-model="editForm.course_id"
            placeholder="选择课程"
            clearable
            filterable
            class="w-full"
          >
            <el-option
              v-for="o in courseOptions"
              :key="o.id"
              :label="o.name"
              :value="String(o.id)"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="订单金额">
          <el-input-number
            v-model="editForm.amount"
            :min="0"
            :precision="2"
            :step="100"
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="总课时">
          <el-input-number
            v-model="editForm.total_hours"
            :min="0"
            :precision="0"
            :step="10"
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="剩余课时">
          <el-input-number
            v-model="editForm.remain_hours"
            :min="0"
            :precision="0"
            :step="1"
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="editForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleEdit"
          >保存</el-button
        >
      </template>
    </el-dialog>

    <!-- 订单详情 -->
    <el-dialog
      v-model="detailVisible"
      title="订单详情"
      width="760px"
      destroy-on-close
    >
      <template v-if="detail">
        <el-descriptions :column="3" border size="small" class="mb-4">
          <el-descriptions-item label="学号">{{
            detail.student_no
          }}</el-descriptions-item>
          <el-descriptions-item label="学员">{{
            detail.student_name
          }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="STATUS_TAG[detail.status] || 'info'" size="small">{{
              detail.status
            }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="班级">{{
            detail.class_name || "—"
          }}</el-descriptions-item>
          <el-descriptions-item label="课程">{{
            detail.course_name || "—"
          }}</el-descriptions-item>
          <el-descriptions-item label="报名日期">{{
            detail.enroll_date
          }}</el-descriptions-item>
          <el-descriptions-item label="课时(剩/总)">
            <span
              :class="
                detail.total_hours > 0 && detail.remain_hours <= 5
                  ? 'font-semibold text-red-500'
                  : ''
              "
            >
              {{
                detail.total_hours > 0
                  ? `${detail.remain_hours} / ${detail.total_hours}`
                  : "未设置"
              }}
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="订单金额">{{
            fmtMoney(detail.amount)
          }}</el-descriptions-item>
          <el-descriptions-item label="已缴合计">
            <span class="text-green-600">{{
              fmtMoney(
                detail.payments.reduce((s: number, p: any) => s + p.amount, 0)
              )
            }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="报名老师">{{
            detail.enroll_user_name || "—"
          }}</el-descriptions-item>
          <el-descriptions-item label="备注" :span="3">{{
            detail.remark || "—"
          }}</el-descriptions-item>
        </el-descriptions>

        <div class="mb-2 flex items-center justify-between">
          <span class="font-medium">缴费明细</span>
          <el-button
            v-if="detail.status === '在读'"
            size="small"
            type="primary"
            @click="openPay"
            >登记缴费</el-button
          >
        </div>
        <el-table :data="detail.payments" border size="small" class="mb-4">
          <el-table-column type="index" label="#" width="50" align="center" />
          <el-table-column prop="pay_time" label="收费时间" min-width="150" />
          <el-table-column label="金额" width="100" align="right">
            <template #default="{ row }">{{ fmtMoney(row.amount) }}</template>
          </el-table-column>
          <el-table-column
            prop="pay_method"
            label="支付方式"
            width="90"
            align="center"
          />
          <el-table-column
            prop="pay_user_name"
            label="收款人"
            width="100"
            align="center"
          />
          <el-table-column
            prop="remark"
            label="备注"
            min-width="120"
            show-overflow-tooltip
          />
          <template #empty>
            <el-empty description="暂无缴费记录" :image-size="50" />
          </template>
        </el-table>

        <div class="mb-2 flex items-center justify-between">
          <span class="font-medium">退费记录</span>
          <el-button
            v-if="detail.status === '在读'"
            size="small"
            type="warning"
            @click="openRefund"
            >提交退费</el-button
          >
        </div>
        <el-table :data="detail.refunds" border size="small">
          <el-table-column type="index" label="#" width="50" align="center" />
          <el-table-column prop="apply_time" label="申请时间" min-width="150" />
          <el-table-column label="金额" width="100" align="right">
            <template #default="{ row }">{{ fmtMoney(row.amount) }}</template>
          </el-table-column>
          <el-table-column
            prop="reason"
            label="原因"
            min-width="120"
            show-overflow-tooltip
          />
          <el-table-column
            prop="status"
            label="状态"
            width="80"
            align="center"
          />
          <el-table-column
            prop="approved_name"
            label="审批人"
            width="90"
            align="center"
          >
            <template #default="{ row }">{{
              row.approved_name || "—"
            }}</template>
          </el-table-column>
          <template #empty>
            <el-empty description="暂无退费记录" :image-size="50" />
          </template>
        </el-table>
      </template>
    </el-dialog>

    <!-- 登记缴费 -->
    <el-dialog
      v-model="payVisible"
      title="登记缴费"
      width="440px"
      destroy-on-close
    >
      <el-form label-width="90px">
        <el-form-item label="学员">{{ detail?.student_name }}</el-form-item>
        <el-form-item label="订单金额">{{
          fmtMoney(detail?.amount)
        }}</el-form-item>
        <el-form-item label="缴费金额" required>
          <el-input-number
            v-model="payForm.amount"
            :min="0.01"
            :precision="2"
            :step="100"
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="支付方式">
          <el-select v-model="payForm.pay_method" class="w-full">
            <el-option label="现金" value="现金" />
            <el-option label="转账" value="转账" />
            <el-option label="扫码" value="扫码" />
          </el-select>
        </el-form-item>
        <el-form-item label="收费时间">
          <el-date-picker
            v-model="payForm.pay_time"
            type="datetime"
            value-format="YYYY-MM-DD HH:mm:ss"
            placeholder="默认当前时间"
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="payForm.remark"
            type="textarea"
            :rows="2"
            placeholder="选填"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="payVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handlePay"
          >确认收费</el-button
        >
      </template>
    </el-dialog>

    <!-- 提交退费 -->
    <el-dialog
      v-model="refundVisible"
      title="提交退费申请"
      width="440px"
      destroy-on-close
    >
      <el-form label-width="90px">
        <el-form-item label="学员">{{ detail?.student_name }}</el-form-item>
        <el-form-item label="退费金额" required>
          <el-input-number
            v-model="refundForm.amount"
            :min="0.01"
            :precision="2"
            :step="100"
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="退费原因" required>
          <el-input
            v-model="refundForm.reason"
            type="textarea"
            :rows="2"
            placeholder="请填写退费原因"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="refundForm.remark"
            type="textarea"
            :rows="2"
            placeholder="选填"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="refundVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleRefund"
          >提交申请</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>
