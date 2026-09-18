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
import { AppPageHeader } from "@/components/AppPageHeader";
import { AppEmpty } from "@/components/AppEmpty";
import { useUserStoreHook } from "@/store/modules/user";
import PlusIcon from "~icons/ep/plus";

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
  <div class="app-page">
    <AppPageHeader title="班级管理" description="班级、班主任与在读人数">
      <el-button
        v-if="canManage"
        type="primary"
        :icon="PlusIcon"
        @click="openAdd"
      >
        新增班级
      </el-button>
    </AppPageHeader>

    <div class="page-card page-card--flush">
      <!-- 筛选条独立于表格：不占据表格的横向空间，窄屏可自动换行 -->
      <div class="page-toolbar">
        <el-input
          v-model="searchForm.name"
          placeholder="搜索班级名称"
          clearable
          class="!w-56"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-button type="primary" @click="handleSearch">搜索</el-button>
        <el-button @click="handleReset">重置</el-button>
      </div>

      <el-table v-loading="loading" :data="dataList" border stripe>
        <el-table-column type="index" label="#" width="60" align="center" />
        <el-table-column prop="name" label="班级名称" min-width="160" />
        <el-table-column prop="grade" label="年级" min-width="120" />
        <el-table-column label="班主任" min-width="130">
          <template #default="{ row }">
            {{ row.head_teacher_name || row.head_teacher || "未指定" }}
          </template>
        </el-table-column>
        <!-- 人数右对齐并启用等宽数字：一列数字能逐位对齐，便于纵向核对 -->
        <el-table-column label="在读人数" width="110" align="right">
          <template #default="{ row }">
            <span class="num">{{ row.student_count }}</span>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" min-width="170">
          <template #default="{ row }">
            <span class="num">{{ row.created_at }}</span>
          </template>
        </el-table-column>
        <el-table-column
          v-if="canManage"
          label="操作"
          width="190"
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

        <!-- 空状态说清"为什么空"与"下一步做什么"，而非一句"暂无数据" -->
        <template #empty>
          <AppEmpty
            title="还没有班级"
            description="新增班级后，学生、课表与考勤都会挂在班级下"
          />
        </template>
      </el-table>

      <div class="page-card__footer">
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
    </div>

    <!-- 新增/编辑弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="min(480px, calc(100vw - 32px))"
    >
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
      width="min(720px, calc(100vw - 32px))"
    >
      <div v-loading="detailLoading">
        <template v-if="detail">
          <!-- 概况用无边框键值对，靠留白分区，比嵌套一个描述表格更轻 -->
          <dl class="detail-facts">
            <div>
              <dt>年级</dt>
              <dd>{{ detail.class.grade || "—" }}</dd>
            </div>
            <div>
              <dt>班主任</dt>
              <dd>{{ detail.class.head_teacher || "未指定" }}</dd>
            </div>
            <div>
              <dt>在读人数</dt>
              <dd class="num">{{ detail.student_total }}</dd>
            </div>
            <div>
              <dt>今日出勤</dt>
              <dd class="num">
                实到 {{ detail.today.present }} · 缺勤
                {{ detail.today.absent }} · 请假 {{ detail.today.leave_count }}
              </dd>
            </div>
          </dl>

          <el-table :data="detail.students" border stripe max-height="420">
            <el-table-column type="index" label="#" width="55" align="center" />
            <el-table-column prop="student_no" label="学号" min-width="110">
              <template #default="{ row }">
                <span class="num">{{ row.student_no }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="name" label="姓名" min-width="90" />
            <el-table-column
              prop="gender"
              label="性别"
              width="70"
              align="center"
            />
            <el-table-column prop="phone" label="手机号" min-width="130">
              <template #default="{ row }">
                <span class="num">{{ row.phone }}</span>
              </template>
            </el-table-column>
            <el-table-column
              prop="email"
              label="邮箱"
              min-width="170"
              show-overflow-tooltip
            />
            <template #empty>
              <AppEmpty
                title="这个班还没有学生"
                description="在「学生管理」里把学生分配到该班级"
              />
            </template>
          </el-table>
        </template>
      </div>
    </el-dialog>
  </div>
</template>

<style lang="scss" scoped>
/* 班级概况：自适应键值对栅格，窄屏自动折行 */
.detail-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: var(--space-4);
  padding: 0 0 var(--space-5);
  margin: 0 0 var(--space-4);
  border-bottom: 1px solid var(--ink-100);

  dt {
    font-size: var(--text-xs);
    color: var(--ink-500);
  }

  dd {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
    color: var(--ink-800);
  }
}
</style>
