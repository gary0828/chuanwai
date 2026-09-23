<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  getUserList,
  createUser,
  updateUser,
  resetUserPassword,
  deleteUser
} from "@/api/attendance";
import { useUserStoreHook } from "@/store/modules/user";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "Users"
});

const myUsername = useUserStoreHook().username;
// 员工账号页：仅管理员可见，管理内部员工（admin / teacher）
const roleOptions = [
  { label: "管理员", value: "admin" },
  { label: "教师", value: "teacher" }
];

const loading = ref(false);
const dataList = ref<any[]>([]);
const searchForm = reactive({ keyword: "", role: "" });
const pagination = reactive({ page: 1, pageSize: 10, total: 0 });

const roleTag: Record<string, string> = {
  admin: "danger",
  teacher: "warning"
};
const roleLabel: Record<string, string> = {
  admin: "管理员",
  teacher: "教师"
};

// 新增/编辑
const dialogVisible = ref(false);
const dialogTitle = ref("新增员工");
const formRef = ref();
const form = reactive({
  id: null as number | null,
  username: "",
  name: "",
  password: "",
  role: "teacher",
  phone: ""
});
const rules = {
  username: [{ required: true, message: "请输入用户名", trigger: "blur" }],
  name: [{ required: true, message: "请输入姓名", trigger: "blur" }],
  password: [{ required: true, message: "请输入初始密码", trigger: "blur" }],
  role: [{ required: true, message: "请选择角色", trigger: "change" }]
};

// 重置密码
const pwdDialogVisible = ref(false);
const pwdFormRef = ref();
const pwdForm = reactive({
  id: null as number | null,
  username: "",
  password: ""
});
const pwdRules = {
  password: [{ required: true, message: "请输入新密码", trigger: "blur" }]
};

function loadData() {
  loading.value = true;
  getUserList({
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
  Object.assign(searchForm, { keyword: "", role: "" });
  handleSearch();
}

function openAdd() {
  dialogTitle.value = "新增员工";
  Object.assign(form, {
    id: null,
    username: "",
    name: "",
    password: "",
    role: "teacher",
    phone: ""
  });
  dialogVisible.value = true;
}

function openEdit(row: any) {
  dialogTitle.value = "编辑员工";
  Object.assign(form, {
    id: row.id,
    username: row.username,
    name: row.name,
    password: "",
    role: row.role,
    phone: row.phone || ""
  });
  dialogVisible.value = true;
}

function handleSubmit() {
  formRef.value.validate((valid: boolean) => {
    if (!valid) return;
    const payload: any = {
      name: form.name,
      role: form.role,
      phone: form.phone
    };
    const api = form.id
      ? updateUser(form.id, payload)
      : createUser({
          username: form.username,
          password: form.password,
          ...payload
        });
    api.then((res: any) => {
      if (res.success) {
        ElMessage.success(form.id ? "修改成功" : "新增成功");
        dialogVisible.value = false;
        loadData();
      }
    });
  });
}

function openResetPwd(row: any) {
  Object.assign(pwdForm, { id: row.id, username: row.username, password: "" });
  pwdDialogVisible.value = true;
}

function handleResetPwd() {
  pwdFormRef.value.validate((valid: boolean) => {
    if (!valid) return;
    resetUserPassword(pwdForm.id, { password: pwdForm.password }).then(
      (res: any) => {
        if (res.success) {
          ElMessage.success("密码重置成功");
          pwdDialogVisible.value = false;
        }
      }
    );
  });
}

function handleDelete(row: any) {
  ElMessageBox.confirm(
    `确定删除员工账号「${row.username}」吗？删除后该账号将无法登录。`,
    "提示",
    { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" }
  )
    .then(() => {
      deleteUser(row.id).then((res: any) => {
        if (res.success) {
          ElMessage.success("删除成功");
          loadData();
        }
      });
    })
    .catch(() => {});
}

onMounted(() => {
  loadData();
});
</script>

<template>
  <div class="app-page">
    <AppPageHeader
      title="员工账号"
      description="教务管理员与任课教师的账号、角色与数据权限"
    />
    <el-card shadow="never">
      <!-- 搜索 -->
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <el-input
          v-model="searchForm.keyword"
          placeholder="用户名 / 姓名 / 手机号"
          clearable
          class="!w-48"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-select
          v-model="searchForm.role"
          placeholder="角色"
          clearable
          class="!w-32"
          @change="handleSearch"
        >
          <el-option
            v-for="opt in roleOptions"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
        <el-button type="primary" @click="handleSearch">搜索</el-button>
        <el-button @click="handleReset">重置</el-button>
        <div class="flex-1" />
        <el-button type="primary" @click="openAdd">新增员工</el-button>
      </div>

      <!-- 表格 -->
      <el-table v-loading="loading" :data="dataList" border stripe>
        <el-table-column type="index" label="#" width="60" align="center" />
        <el-table-column label="头像" width="72" align="center">
          <template #default="{ row }">
            <el-avatar v-if="row.avatar" :size="32" :src="row.avatar" />
            <span v-else class="avatar-fallback">
              {{ (row.name || row.username || "-").slice(0, 1) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="username" label="用户名" min-width="120" />
        <el-table-column prop="name" label="姓名" min-width="100" />
        <el-table-column label="角色" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="roleTag[row.role] as any" size="small">
              {{ roleLabel[row.role] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="phone" label="手机号" min-width="130">
          <template #default="{ row }">{{ row.phone || "-" }}</template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" min-width="170" />
        <el-table-column label="操作" width="200" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)"
              >编辑</el-button
            >
            <el-button link type="warning" @click="openResetPwd(row)"
              >重置密码</el-button
            >
            <el-button
              link
              type="danger"
              :disabled="row.username === myUsername"
              @click="handleDelete(row)"
            >
              删除
            </el-button>
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
        <el-form-item label="用户名" prop="username">
          <el-input
            v-model="form.username"
            placeholder="登录账号"
            :disabled="!!form.id"
          />
        </el-form-item>
        <el-form-item label="姓名" prop="name">
          <el-input v-model="form.name" placeholder="请输入姓名" />
        </el-form-item>
        <el-form-item v-if="!form.id" label="初始密码" prop="password">
          <el-input
            v-model="form.password"
            placeholder="建议：用户名+123456"
            show-password
          />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="form.role" class="!w-full">
            <el-option
              v-for="opt in roleOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="手机号" prop="phone">
          <el-input v-model="form.phone" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 重置密码弹窗 -->
    <el-dialog v-model="pwdDialogVisible" title="重置密码" width="420px">
      <el-form
        ref="pwdFormRef"
        :model="pwdForm"
        :rules="pwdRules"
        label-width="90px"
      >
        <el-form-item label="用户">
          <span>{{ pwdForm.username }}</span>
        </el-form-item>
        <el-form-item label="新密码" prop="password">
          <el-input
            v-model="pwdForm.password"
            placeholder="请输入新密码"
            show-password
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pwdDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleResetPwd">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
/* 未上传头像时回落「姓名首字」，避免一整列空头像 */
.avatar-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  font-size: 13px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  border-radius: 50%;
}
</style>
