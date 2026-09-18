<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  getCourseList,
  createCourse,
  updateCourse,
  deleteCourse
} from "@/api/attendance";
import { useUserStoreHook } from "@/store/modules/user";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "Courses"
});

const isAdmin = computed(() => useUserStoreHook().roles.includes("admin"));

const loading = ref(false);
const dataList = ref<any[]>([]);
const searchForm = reactive({ keyword: "" });
const pagination = reactive({ page: 1, pageSize: 10, total: 0 });

const dialogVisible = ref(false);
const dialogTitle = ref("新增课程");
const formRef = ref();
const form = reactive({
  id: null as number | null,
  code: "",
  name: "",
  teacher: ""
});
const rules = {
  code: [{ required: true, message: "请输入课程代码", trigger: "blur" }],
  name: [{ required: true, message: "请输入课程名称", trigger: "blur" }]
};

function loadData() {
  loading.value = true;
  getCourseList({
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
  searchForm.keyword = "";
  handleSearch();
}

function openAdd() {
  dialogTitle.value = "新增课程";
  Object.assign(form, { id: null, code: "", name: "", teacher: "" });
  dialogVisible.value = true;
}

function openEdit(row: any) {
  dialogTitle.value = "编辑课程";
  Object.assign(form, {
    id: row.id,
    code: row.code,
    name: row.name,
    teacher: row.teacher
  });
  dialogVisible.value = true;
}

function handleSubmit() {
  formRef.value.validate((valid: boolean) => {
    if (!valid) return;
    const payload = { code: form.code, name: form.name, teacher: form.teacher };
    const api = form.id
      ? updateCourse(form.id, payload)
      : createCourse(payload);
    api.then((res: any) => {
      if (res.success) {
        ElMessage.success(form.id ? "修改成功" : "新增成功");
        dialogVisible.value = false;
        loadData();
      }
    });
  });
}

function handleDelete(row: any) {
  ElMessageBox.confirm(`确定删除课程「${row.name}」吗？`, "提示", {
    type: "warning",
    confirmButtonText: "删除",
    cancelButtonText: "取消"
  })
    .then(() => {
      deleteCourse(row.id).then((res: any) => {
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
    <AppPageHeader title="课程管理" description="课程与课时单价维护" />
    <el-card shadow="never">
      <!-- 搜索 -->
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <el-input
          v-model="searchForm.keyword"
          placeholder="课程名称 / 课程代码"
          clearable
          class="!w-56"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-button type="primary" @click="handleSearch">搜索</el-button>
        <el-button @click="handleReset">重置</el-button>
        <div class="flex-1" />
        <el-button v-if="isAdmin" type="primary" @click="openAdd">
          新增课程
        </el-button>
      </div>

      <!-- 表格 -->
      <el-table v-loading="loading" :data="dataList" border stripe>
        <el-table-column type="index" label="#" width="60" align="center" />
        <el-table-column prop="code" label="课程代码" min-width="120" />
        <el-table-column prop="name" label="课程名称" min-width="160" />
        <el-table-column prop="teacher" label="授课教师" min-width="120" />
        <el-table-column prop="created_at" label="创建时间" min-width="170" />
        <el-table-column
          v-if="isAdmin"
          label="操作"
          width="150"
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

    <!-- 新增/编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="480px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="课程代码" prop="code">
          <el-input v-model="form.code" placeholder="如：SE101" />
        </el-form-item>
        <el-form-item label="课程名称" prop="name">
          <el-input v-model="form.name" placeholder="请输入课程名称" />
        </el-form-item>
        <el-form-item label="授课教师" prop="teacher">
          <el-input v-model="form.teacher" placeholder="请输入授课教师" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>
