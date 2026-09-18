<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  getFinancePayments,
  createFinancePayment,
  updateFinancePayment,
  deleteFinancePayment,
  getFinanceOrders,
  getStudentList
} from "@/api/attendance";
import { useUserStoreHook } from "@/store/modules/user";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "FinancePayments"
});

const isAdmin = computed(() => useUserStoreHook().roles.includes("admin"));
const loading = ref(false);
const dataList = ref<any[]>([]);
const searchForm = reactive({ keyword: "", pay_method: "" });
const dateRange = ref<[string, string] | null>(null);
const pagination = reactive({ page: 1, pageSize: 10, total: 0 });
const totalAmount = ref(0);

const METHOD_OPTIONS = [
  { label: "现金", value: "现金" },
  { label: "转账", value: "转账" },
  { label: "扫码", value: "扫码" }
];
const METHOD_TAG = {
  现金: "success",
  转账: "primary",
  扫码: "warning"
} as Record<string, string>;

// 新增缴费
const createVisible = ref(false);
const studentOptions = ref<any[]>([]);
const studentLoading = ref(false);
const orderOptions = ref<any[]>([]);
const createForm = reactive({
  student_id: 0,
  order_id: 0,
  amount: 0,
  pay_method: "转账",
  pay_time: "",
  remark: ""
});
const submitting = ref(false);

// 编辑缴费
const editVisible = ref(false);
const editForm = reactive({
  id: 0,
  amount: 0,
  pay_method: "转账",
  pay_time: "",
  remark: ""
});

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
  if (dateRange.value && dateRange.value.length === 2) {
    params.start = dateRange.value[0];
    params.end = dateRange.value[1];
  }
  getFinancePayments(params)
    .then((res: any) => {
      if (res.success) {
        dataList.value = res.data.list;
        pagination.total = res.data.total;
        totalAmount.value = res.data.totalAmount || 0;
      }
    })
    .finally(() => (loading.value = false));
}

function handleSearch() {
  pagination.page = 1;
  loadData();
}

function handleReset() {
  searchForm.keyword = "";
  searchForm.pay_method = "";
  dateRange.value = null;
  handleSearch();
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

/** 选中学员后加载其在读订单 */
function loadStudentOrders(studentId: number) {
  const stu = studentOptions.value.find((s: any) => s.id === studentId);
  if (!stu) return;
  getFinanceOrders({
    keyword: stu.student_no,
    status: "在读",
    page: 1,
    pageSize: 50
  }).then((res: any) => {
    orderOptions.value = (res.success ? res.data.list : []).filter(
      (o: any) => o.student_id === studentId
    );
  });
}

function openCreate() {
  Object.assign(createForm, {
    student_id: 0,
    order_id: 0,
    amount: 0,
    pay_method: "转账",
    pay_time: "",
    remark: ""
  });
  studentOptions.value = [];
  orderOptions.value = [];
  createVisible.value = true;
}

function handleCreate() {
  if (!createForm.student_id) {
    ElMessage.warning("请选择学员");
    return;
  }
  if (!createForm.order_id) {
    ElMessage.warning("请选择该学员的在读订单");
    return;
  }
  const amount = Number(createForm.amount);
  if (!(amount > 0)) {
    ElMessage.warning("请输入有效缴费金额");
    return;
  }
  submitting.value = true;
  createFinancePayment({
    order_id: createForm.order_id,
    student_id: createForm.student_id,
    amount,
    pay_method: createForm.pay_method,
    pay_time: createForm.pay_time,
    remark: createForm.remark
  })
    .then((res: any) => {
      if (res.success) {
        ElMessage.success("缴费登记成功");
        createVisible.value = false;
        handleSearch();
      }
    })
    .finally(() => (submitting.value = false));
}

function openEdit(row: any) {
  Object.assign(editForm, {
    id: row.id,
    amount: row.amount,
    pay_method: row.pay_method,
    pay_time: row.pay_time,
    remark: row.remark
  });
  editVisible.value = true;
}

function handleEdit() {
  const amount = Number(editForm.amount);
  if (!(amount > 0)) {
    ElMessage.warning("请输入有效缴费金额");
    return;
  }
  submitting.value = true;
  updateFinancePayment(editForm.id, {
    amount,
    pay_method: editForm.pay_method,
    pay_time: editForm.pay_time,
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

function handleDelete(row: any) {
  ElMessageBox.confirm(
    `确定删除缴费记录 ¥${row.amount.toFixed(2)}（${row.student_name}）吗？`,
    "提示",
    {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消"
    }
  )
    .then(() => {
      deleteFinancePayment(row.id).then((res: any) => {
        if (res.success) {
          ElMessage.success("删除成功");
          loadData();
        }
      });
    })
    .catch(() => {});
}

onMounted(loadData);
</script>

<template>
  <div class="app-page">
    <AppPageHeader title="缴费记录" description="收款流水与导出" />
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
          v-model="searchForm.pay_method"
          placeholder="支付方式"
          clearable
          class="!w-32"
        >
          <el-option
            v-for="o in METHOD_OPTIONS"
            :key="o.value"
            :label="o.label"
            :value="o.value"
          />
        </el-select>
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          class="!w-60"
        />
        <el-button type="primary" @click="handleSearch">搜索</el-button>
        <el-button @click="handleReset">重置</el-button>
        <div class="flex-1" />
        <span class="text-sm text-gray-500">
          当前范围实收合计：
          <span class="text-lg font-semibold text-green-600">{{
            fmtMoney(totalAmount)
          }}</span>
        </span>
        <el-button type="primary" @click="openCreate">新增缴费</el-button>
      </div>

      <!-- 表格 -->
      <el-table v-loading="loading" :data="dataList" border stripe>
        <el-table-column type="index" label="#" width="55" align="center" />
        <el-table-column prop="pay_time" label="收费时间" min-width="160" />
        <el-table-column prop="student_no" label="学号" width="110" />
        <el-table-column prop="student_name" label="学员" width="100" />
        <el-table-column prop="class_name" label="班级" min-width="110">
          <template #default="{ row }">{{ row.class_name || "—" }}</template>
        </el-table-column>
        <el-table-column label="金额" width="110" align="right">
          <template #default="{ row }">
            <span class="font-medium text-green-600">{{
              fmtMoney(row.amount)
            }}</span>
          </template>
        </el-table-column>
        <el-table-column label="支付方式" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="METHOD_TAG[row.pay_method] || 'info'" size="small">{{
              row.pay_method
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column
          prop="pay_user_name"
          label="收款人"
          width="100"
          align="center"
        >
          <template #default="{ row }">{{ row.pay_user_name || "—" }}</template>
        </el-table-column>
        <el-table-column label="订单" width="90" align="center">
          <template #default="{ row }">#{{ row.order_id }}</template>
        </el-table-column>
        <el-table-column
          prop="remark"
          label="备注"
          min-width="120"
          show-overflow-tooltip
        >
          <template #default="{ row }">{{ row.remark || "—" }}</template>
        </el-table-column>
        <el-table-column
          v-if="isAdmin"
          label="操作"
          width="130"
          align="center"
          fixed="right"
        >
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)"
              >编辑</el-button
            >
            <el-button link type="danger" @click="handleDelete(row)"
              >删除</el-button
            >
          </template>
        </el-table-column>
        <template #empty>
          <el-empty
            description="暂无缴费记录，点击右上角「新增缴费」登记"
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

    <!-- 新增缴费 -->
    <el-dialog
      v-model="createVisible"
      title="新增缴费"
      width="480px"
      destroy-on-close
    >
      <el-form label-width="90px">
        <el-form-item label="学员" required>
          <el-select
            v-model="createForm.student_id"
            placeholder="输入姓名搜索"
            filterable
            remote
            :remote-method="searchStudents"
            :loading="studentLoading"
            class="w-full"
            @change="loadStudentOrders"
          >
            <el-option
              v-for="s in studentOptions"
              :key="s.id"
              :label="`${s.name}（${s.student_no}）`"
              :value="s.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="在读订单" required>
          <el-select
            v-model="createForm.order_id"
            placeholder="先选择学员"
            filterable
            class="w-full"
          >
            <el-option
              v-for="o in orderOptions"
              :key="o.id"
              :label="`订单#${o.id} ${o.class_name || ''} ${o.course_name || ''}（${fmtMoney(o.amount)}）`"
              :value="o.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="缴费金额" required>
          <el-input-number
            v-model="createForm.amount"
            :min="0.01"
            :precision="2"
            :step="100"
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="支付方式">
          <el-select v-model="createForm.pay_method" class="w-full">
            <el-option
              v-for="o in METHOD_OPTIONS"
              :key="o.value"
              :label="o.label"
              :value="o.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="收费时间">
          <el-date-picker
            v-model="createForm.pay_time"
            type="datetime"
            value-format="YYYY-MM-DD HH:mm:ss"
            placeholder="默认当前时间"
            class="w-full"
          />
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
          >确认收费</el-button
        >
      </template>
    </el-dialog>

    <!-- 编辑缴费 -->
    <el-dialog
      v-model="editVisible"
      title="编辑缴费记录"
      width="440px"
      destroy-on-close
    >
      <el-form label-width="90px">
        <el-form-item label="缴费金额" required>
          <el-input-number
            v-model="editForm.amount"
            :min="0.01"
            :precision="2"
            :step="100"
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="支付方式">
          <el-select v-model="editForm.pay_method" class="w-full">
            <el-option
              v-for="o in METHOD_OPTIONS"
              :key="o.value"
              :label="o.label"
              :value="o.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="收费时间">
          <el-date-picker
            v-model="editForm.pay_time"
            type="datetime"
            value-format="YYYY-MM-DD HH:mm:ss"
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
  </div>
</template>
