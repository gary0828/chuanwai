<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  getLeaveList,
  createLeave,
  approveLeave,
  getStudentList
} from "@/api/attendance";

defineOptions({
  name: "Leaves"
});

const loading = ref(false);
const dataList = ref<any[]>([]);
const studentOptions = ref<any[]>([]);
const searchForm = reactive({ status: "" });
const pagination = reactive({ page: 1, pageSize: 10, total: 0 });

const dialogVisible = ref(false);
const formRef = ref();
const form = reactive({
  student_id: null as number | null,
  type: "病假",
  reason: "",
  start_date: "",
  end_date: ""
});
const rules = {
  student_id: [{ required: true, message: "请选择学生", trigger: "change" }],
  type: [{ required: true, message: "请选择请假类型", trigger: "change" }],
  start_date: [
    { required: true, message: "请选择开始日期", trigger: "change" }
  ],
  end_date: [{ required: true, message: "请选择结束日期", trigger: "change" }]
};

const statusTag: Record<string, string> = {
  待审批: "warning",
  通过: "success",
  驳回: "danger"
};

const typeTag: Record<string, string> = {
  病假: "danger",
  事假: "warning",
  其他: "info"
};

function loadStudents() {
  getStudentList({ page: 1, pageSize: 1000, class_id: "" }).then((res: any) => {
    if (res.success) studentOptions.value = res.data.list;
  });
}

function loadData() {
  loading.value = true;
  getLeaveList({
    ...searchForm,
    page: pagination.page,
    pageSize: pagination.pageSize
  })
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
  handleSearch();
}

function openAdd() {
  Object.assign(form, {
    student_id: null,
    type: "病假",
    reason: "",
    start_date: "",
    end_date: ""
  });
  dialogVisible.value = true;
}

function handleSubmit() {
  formRef.value.validate((valid: boolean) => {
    if (!valid) return;
    createLeave({
      student_id: form.student_id,
      type: form.type,
      reason: form.reason,
      start_date: form.start_date,
      end_date: form.end_date
    }).then((res: any) => {
      if (res.success) {
        ElMessage.success("请假申请已提交");
        dialogVisible.value = false;
        loadData();
      }
    });
  });
}

function handleApprove(row: any, status: string) {
  const msg =
    status === "通过"
      ? "审批通过后将自动把该学员请假日期内的已有考勤记为「请假」，确定通过？"
      : "确定驳回该请假申请？";
  ElMessageBox.confirm(msg, "提示", {
    type: "warning",
    confirmButtonText: "确定",
    cancelButtonText: "取消"
  })
    .then(() => {
      approveLeave(row.id, { status }).then((res: any) => {
        if (res.success) {
          ElMessage.success(status === "通过" ? "已通过" : "已驳回");
          loadData();
        }
      });
    })
    .catch(() => {});
}

/** 请假时长（含首尾天，最小 1 天） */
function leaveDays(row: any) {
  if (!row?.start_date || !row?.end_date) return 1;
  const start = new Date(row.start_date).getTime();
  const end = new Date(row.end_date).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 1;
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

onMounted(() => {
  loadStudents();
  loadData();
});
</script>

<template>
  <div class="p-4">
    <el-card shadow="never">
      <!-- 搜索 -->
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <el-select
          v-model="searchForm.status"
          placeholder="审批状态"
          clearable
          class="!w-40"
          @change="handleSearch"
        >
          <el-option label="待审批" value="待审批" />
          <el-option label="通过" value="通过" />
          <el-option label="驳回" value="驳回" />
        </el-select>
        <el-button type="primary" @click="handleSearch">搜索</el-button>
        <el-button @click="handleReset">重置</el-button>
        <div class="flex-1" />
        <el-button type="primary" @click="openAdd">提交请假申请</el-button>
      </div>

      <!-- 表格 -->
      <el-table v-loading="loading" :data="dataList" border stripe>
        <el-table-column type="index" label="#" width="60" align="center" />
        <el-table-column label="学生" min-width="160">
          <template #default="{ row }">
            <div>{{ row.student_name }}</div>
            <div class="text-[12px] text-gray-400">
              {{ row.student_no }} · {{ row.class_name }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="typeTag[row.type] as any" size="small">{{
              row.type
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column
          prop="reason"
          label="请假原因"
          min-width="180"
          show-overflow-tooltip
        />
        <el-table-column label="起止日期" min-width="180">
          <template #default="{ row }">
            {{ row.start_date }} ~ {{ row.end_date }}
          </template>
        </el-table-column>
        <el-table-column label="时长" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ leaveDays(row) }} 天</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="apply_time" label="申请时间" min-width="160" />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="statusTag[row.status] as any" size="small">{{
              row.status
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="90" align="center">
          <template #default="{ row }">
            <el-tag
              :type="row.source === '考勤同步' ? 'info' : 'primary'"
              size="small"
              effect="plain"
            >
              {{ row.source === "考勤同步" ? "考勤同步" : "手动" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          prop="approver_name"
          label="审批人"
          width="100"
          align="center"
        />
        <el-table-column label="操作" width="130" align="center" fixed="right">
          <template #default="{ row }">
            <template v-if="row.status === '待审批'">
              <el-button link type="success" @click="handleApprove(row, '通过')"
                >通过</el-button
              >
              <el-button link type="danger" @click="handleApprove(row, '驳回')"
                >驳回</el-button
              >
            </template>
            <span v-else class="text-gray-400">已处理</span>
          </template>
        </el-table-column>
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

    <!-- 新增请假弹窗 -->
    <el-dialog v-model="dialogVisible" title="提交请假申请" width="520px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="学生" prop="student_id">
          <el-select
            v-model="form.student_id"
            placeholder="请选择学生"
            filterable
            class="!w-full"
          >
            <el-option
              v-for="item in studentOptions"
              :key="item.id"
              :label="`${item.student_no} - ${item.name}（${item.class_name}）`"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="请假类型" prop="type">
          <el-radio-group v-model="form.type">
            <el-radio value="病假">病假</el-radio>
            <el-radio value="事假">事假</el-radio>
            <el-radio value="其他">其他</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="开始日期" prop="start_date">
          <el-date-picker
            v-model="form.start_date"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择开始日期"
            class="!w-full"
          />
        </el-form-item>
        <el-form-item label="结束日期" prop="end_date">
          <el-date-picker
            v-model="form.end_date"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择结束日期"
            class="!w-full"
          />
        </el-form-item>
        <el-form-item label="请假原因" prop="reason">
          <el-input
            v-model="form.reason"
            type="textarea"
            :rows="3"
            placeholder="请输入请假原因"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>
