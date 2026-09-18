<script setup lang="ts">
import EpPlus from "~icons/ep/plus";
import { ref, reactive, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  getMakeupList,
  createMakeup,
  updateMakeupStatus,
  deleteMakeup,
  getStudentList,
  getAllClasses,
  getAllCourses
} from "@/api/attendance";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "Makeups"
});

const loading = ref(false);
const list = ref<any[]>([]);
const total = ref(0);
const classOptions = ref<any[]>([]);
const courseOptions = ref<any[]>([]);
const searchForm = reactive({
  status: "",
  class_id: "",
  date_start: "",
  date_end: "",
  page: 1,
  pageSize: 10
});

const statusMap: Record<string, any> = { 待安排: "warning", 已完成: "success" };

/* ---------- 登记弹窗 ---------- */
const dialogVisible = ref(false);
const formRef = ref();
const form = reactive({
  student_id: null as number | null,
  class_id: null as number | null,
  course_id: null as number | null,
  original_date: "",
  makeup_date: "",
  remark: ""
});
const studentOptions = ref<any[]>([]);
const studentLoading = ref(false);
const rules = {
  student_id: [{ required: true, message: "请选择学员", trigger: "change" }],
  class_id: [{ required: true, message: "请选择班级", trigger: "change" }],
  original_date: [
    { required: true, message: "请选择原始日期", trigger: "change" }
  ],
  makeup_date: [
    { required: true, message: "请选择补课日期", trigger: "change" }
  ]
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
  const params: any = { page: searchForm.page, pageSize: searchForm.pageSize };
  if (searchForm.status) params.status = searchForm.status;
  if (searchForm.class_id) params.class_id = searchForm.class_id;
  if (searchForm.date_start) params.date_start = searchForm.date_start;
  if (searchForm.date_end) params.date_end = searchForm.date_end;
  getMakeupList(params)
    .then((res: any) => {
      if (res.success) {
        list.value = res.data.list;
        total.value = res.data.total;
      }
    })
    .finally(() => (loading.value = false));
}

function handleSearch() {
  searchForm.page = 1;
  loadData();
}

function handleReset() {
  Object.assign(searchForm, {
    status: "",
    class_id: "",
    date_start: "",
    date_end: "",
    page: 1
  });
  loadData();
}

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

function openAdd() {
  Object.assign(form, {
    student_id: null,
    class_id: null,
    course_id: null,
    original_date: "",
    makeup_date: "",
    remark: ""
  });
  studentOptions.value = [];
  dialogVisible.value = true;
}

function handleSubmit() {
  formRef.value.validate((valid: boolean) => {
    if (!valid) return;
    createMakeup({ ...form }).then((res: any) => {
      if (res.success) {
        ElMessage.success("补课登记成功");
        dialogVisible.value = false;
        loadData();
      }
    });
  });
}

function handleStatus(row: any) {
  const toComplete = row.status === "待安排";
  ElMessageBox.confirm(
    toComplete
      ? "标记完成后将从该学员课时包扣减 1 课时（缺勤/请假日本未扣，补课完成补扣一次），确定吗？"
      : "恢复为待安排后将回补该补课已扣减的 1 课时，确定吗？",
    "提示",
    { type: "warning", confirmButtonText: "确定", cancelButtonText: "取消" }
  )
    .then(() => {
      updateMakeupStatus(row.id, {
        status: toComplete ? "已完成" : "待安排"
      }).then((res: any) => {
        if (res.success) {
          ElMessage.success(
            toComplete ? "已标记完成并扣减课时" : "已恢复待安排并回补课时"
          );
          loadData();
        }
      });
    })
    .catch(() => {});
}

function handleDelete(row: any) {
  ElMessageBox.confirm("确定删除该补课记录吗？", "提示", {
    type: "warning",
    confirmButtonText: "删除",
    cancelButtonText: "取消"
  })
    .then(() => {
      deleteMakeup(row.id).then((res: any) => {
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
    <AppPageHeader title="补课管理" description="缺课的补课安排与销课" />
    <el-card shadow="never">
      <!-- 筛选 -->
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <el-select
          v-model="searchForm.status"
          placeholder="状态"
          clearable
          class="!w-28"
          @change="handleSearch"
        >
          <el-option
            v-for="s in ['待安排', '已完成']"
            :key="s"
            :label="s"
            :value="s"
          />
        </el-select>
        <el-select
          v-model="searchForm.class_id"
          placeholder="班级"
          clearable
          class="!w-40"
          @change="handleSearch"
        >
          <el-option
            v-for="item in classOptions"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
        <el-date-picker
          v-model="searchForm.date_start"
          type="date"
          placeholder="补课开始日期"
          value-format="YYYY-MM-DD"
          class="!w-40"
          @change="handleSearch"
        />
        <el-date-picker
          v-model="searchForm.date_end"
          type="date"
          placeholder="补课结束日期"
          value-format="YYYY-MM-DD"
          class="!w-40"
          @change="handleSearch"
        />
        <el-button type="primary" @click="handleSearch">查询</el-button>
        <el-button @click="handleReset">重置</el-button>
        <div class="flex-1" />
        <el-button type="primary" @click="openAdd">
          <el-icon class="mr-1"><EpPlus /></el-icon>
          登记补课
        </el-button>
      </div>

      <el-table v-loading="loading" :data="list" border stripe>
        <el-table-column prop="id" label="ID" width="70" align="center" />
        <el-table-column prop="student_no" label="学号" width="110" />
        <el-table-column prop="student_name" label="学员" width="110" />
        <el-table-column prop="class_name" label="班级" width="140" />
        <el-table-column prop="course_name" label="课程" min-width="110" />
        <el-table-column
          prop="original_date"
          label="原始日期"
          width="110"
          align="center"
        />
        <el-table-column
          prop="makeup_date"
          label="补课日期"
          width="110"
          align="center"
        />
        <el-table-column
          prop="remark"
          label="备注"
          min-width="110"
          show-overflow-tooltip
        />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="statusMap[row.status]" size="small">{{
              row.status
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="center" fixed="right">
          <template #default="{ row }">
            <el-button
              :type="row.status === '待安排' ? 'success' : 'warning'"
              link
              @click="handleStatus(row)"
            >
              {{ row.status === "待安排" ? "完成" : "恢复待安排" }}
            </el-button>
            <el-button link type="danger" @click="handleDelete(row)"
              >删除</el-button
            >
          </template>
        </el-table-column>
      </el-table>

      <div class="mt-4 flex justify-end">
        <el-pagination
          v-model:current-page="searchForm.page"
          v-model:page-size="searchForm.pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @change="loadData"
        />
      </div>
    </el-card>

    <!-- 登记补课弹窗 -->
    <el-dialog v-model="dialogVisible" title="登记补课" width="520px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="学员" prop="student_id">
          <el-select
            v-model="form.student_id"
            filterable
            remote
            clearable
            reserve-keyword
            :remote-method="remoteSearch"
            :loading="studentLoading"
            placeholder="输入姓名 / 学号搜索学员"
            class="!w-full"
          >
            <el-option
              v-for="s in studentOptions"
              :key="s.id"
              :label="`${s.name}（${s.student_no}）${s.class_name ? '· ' + s.class_name : ''}`"
              :value="s.id"
            />
          </el-select>
        </el-form-item>
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
        <el-form-item label="课程">
          <el-select
            v-model="form.course_id"
            placeholder="请选择课程（选填）"
            clearable
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
        <el-form-item label="原始日期" prop="original_date">
          <el-date-picker
            v-model="form.original_date"
            type="date"
            placeholder="缺勤 / 请假日期"
            value-format="YYYY-MM-DD"
            class="!w-full"
          />
        </el-form-item>
        <el-form-item label="补课日期" prop="makeup_date">
          <el-date-picker
            v-model="form.makeup_date"
            type="date"
            placeholder="补课日期"
            value-format="YYYY-MM-DD"
            class="!w-full"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="form.remark"
            type="textarea"
            :rows="2"
            placeholder="备注（选填）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>
