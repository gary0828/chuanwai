<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  getClassList,
  createClass,
  updateClass,
  deleteClass,
  getClassStudents,
  getUserList
} from "@/api/attendance";
import { useUserStoreHook } from "@/store/modules/user";

defineOptions({
  name: "Classes"
});

const canManage = computed(() => {
  const roles = useUserStoreHook().roles;
  return roles.includes("admin") || roles.includes("teacher");
});
const isAdmin = computed(() => useUserStoreHook().roles.includes("admin"));

const loading = ref(false);
const dataList = ref<any[]>([]);
const teacherOptions = ref<any[]>([]);
const searchForm = reactive({ name: "" });
const pagination = reactive({ page: 1, pageSize: 10, total: 0 });

const dialogVisible = ref(false);
const dialogTitle = ref("新增班级");
const formRef = ref();
const form = reactive({
  id: null as number | null,
  name: "",
  grade: "",
  head_teacher: "",
  head_teacher_id: null as number | null
});
const rules = {
  name: [{ required: true, message: "请输入班级名称", trigger: "blur" }]
};

// 班级名单/出勤概况弹窗
const detailVisible = ref(false);
const detailLoading = ref(false);
const detail = ref<any>(null);

function loadTeachers() {
  if (!isAdmin.value) return;
  getUserList({ role: "teacher", pageSize: 100 }).then((res: any) => {
    if (res.success) teacherOptions.value = res.data.list;
  });
}

function loadData() {
  loading.value = true;
  getClassList({
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
  searchForm.name = "";
  handleSearch();
}

function openAdd() {
  dialogTitle.value = "新增班级";
  Object.assign(form, {
    id: null,
    name: "",
    grade: "",
    head_teacher: "",
    head_teacher_id: null
  });
  dialogVisible.value = true;
}

function openEdit(row: any) {
  dialogTitle.value = "编辑班级";
  Object.assign(form, {
    id: row.id,
    name: row.name,
    grade: row.grade,
    head_teacher: row.head_teacher,
    head_teacher_id: row.head_teacher_id || null
  });
  dialogVisible.value = true;
}

function handleSubmit() {
  formRef.value.validate((valid: boolean) => {
    if (!valid) return;
    const payload: any = {
      name: form.name,
      grade: form.grade,
      head_teacher: form.head_teacher
    };
    // 仅管理员可指定班主任账号（教师创建/编辑时后端自动绑定自己）
    if (isAdmin.value) payload.head_teacher_id = form.head_teacher_id;
    const api = form.id ? updateClass(form.id, payload) : createClass(payload);
    api.then((res: any) => {
      if (res.success) {
        ElMessage.success(form.id ? "修改成功" : "新增成功");
        dialogVisible.value = false;
        loadData();
      }
    });
  });
}

function openDetail(row: any) {
  detailLoading.value = true;
  detailVisible.value = true;
  getClassStudents(row.id)
    .then((res: any) => {
      if (res.success) {
        detail.value = res.data;
      } else {
        detailVisible.value = false;
      }
    })
    .finally(() => (detailLoading.value = false));
}

function handleDelete(row: any) {
  ElMessageBox.confirm(`确定删除班级「${row.name}」吗？`, "提示", {
    type: "warning",
    confirmButtonText: "删除",
    cancelButtonText: "取消"
  })
    .then(() => {
      deleteClass(row.id)
        .then((res: any) => {
          if (res.success) {
            ElMessage.success("删除成功");
            loadData();
          } else {
            ElMessage.error(res.message || "删除失败");
          }
        })
        .catch((err: any) => {
          ElMessage.error(
            err?.response?.data?.message || err?.message || "删除失败"
          );
        });
    })
    .catch(() => {});
}

onMounted(() => {
  loadTeachers();
  loadData();
});
</script>

<template>
  <div class="p-4">
    <el-card shadow="never">
      <!-- 搜索 -->
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <el-input
          v-model="searchForm.name"
          placeholder="请输入班级名称"
          clearable
          class="!w-56"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-button type="primary" @click="handleSearch">搜索</el-button>
        <el-button @click="handleReset">重置</el-button>
        <div class="flex-1" />
        <el-button v-if="canManage" type="primary" @click="openAdd">
          新增班级
        </el-button>
      </div>

      <!-- 表格 -->
      <el-table v-loading="loading" :data="dataList" border stripe>
        <el-table-column type="index" label="#" width="60" align="center" />
        <el-table-column prop="name" label="班级名称" min-width="160" />
        <el-table-column prop="grade" label="年级" min-width="120" />
        <el-table-column label="班主任" min-width="130">
          <template #default="{ row }">
            {{ row.head_teacher_name || row.head_teacher || "未指定" }}
          </template>
        </el-table-column>
        <el-table-column
          prop="student_count"
          label="在读人数"
          width="100"
          align="center"
        />
        <el-table-column prop="created_at" label="创建时间" min-width="170" />
        <el-table-column
          v-if="canManage"
          label="操作"
          width="200"
          align="center"
          fixed="right"
        >
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)"
              >名单</el-button
            >
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
        <el-form-item label="班级名称" prop="name">
          <el-input v-model="form.name" placeholder="请输入班级名称" />
        </el-form-item>
        <el-form-item label="年级" prop="grade">
          <el-input v-model="form.grade" placeholder="如：2023级" />
        </el-form-item>
        <el-form-item label="班主任" prop="head_teacher">
          <el-input
            v-model="form.head_teacher"
            placeholder="请输入班主任姓名"
          />
        </el-form-item>
        <el-form-item v-if="isAdmin" label="班主任账号" prop="head_teacher_id">
          <el-select
            v-model="form.head_teacher_id"
            placeholder="选择教师账号（数据权限绑定）"
            clearable
            class="!w-full"
          >
            <el-option
              v-for="t in teacherOptions"
              :key="t.id"
              :label="`${t.name}（${t.username}）`"
              :value="t.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 班级名单/出勤概况弹窗 -->
    <el-dialog
      v-model="detailVisible"
      :title="detail ? `班级名单：${detail.class.name}` : '班级名单'"
      width="720px"
    >
      <div v-loading="detailLoading">
        <template v-if="detail">
          <el-descriptions :column="4" border class="mb-3">
            <el-descriptions-item label="年级">
              {{ detail.class.grade || "-" }}
            </el-descriptions-item>
            <el-descriptions-item label="班主任">
              {{ detail.class.head_teacher || "未指定" }}
            </el-descriptions-item>
            <el-descriptions-item label="在读人数">
              {{ detail.student_total }}
            </el-descriptions-item>
            <el-descriptions-item label="今日实到">
              {{ detail.today.present }} / 缺勤 {{ detail.today.absent }} / 请假
              {{ detail.today.leave_count }}
            </el-descriptions-item>
          </el-descriptions>
          <el-table :data="detail.students" border stripe max-height="420">
            <el-table-column type="index" label="#" width="55" align="center" />
            <el-table-column prop="student_no" label="学号" min-width="110" />
            <el-table-column prop="name" label="姓名" min-width="90" />
            <el-table-column
              prop="gender"
              label="性别"
              width="70"
              align="center"
            />
            <el-table-column prop="phone" label="手机号" min-width="130" />
            <el-table-column
              prop="email"
              label="邮箱"
              min-width="170"
              show-overflow-tooltip
            />
          </el-table>
        </template>
      </div>
    </el-dialog>
  </div>
</template>
