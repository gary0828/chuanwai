<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  getTermList,
  createTerm,
  updateTerm,
  setCurrentTerm,
  deleteTerm
} from "@/api/attendance";

defineOptions({
  name: "Terms"
});

const loading = ref(false);
const dataList = ref<any[]>([]);
const searchForm = reactive({ name: "" });
const pagination = reactive({ page: 1, pageSize: 10, total: 0 });

const dialogVisible = ref(false);
const dialogTitle = ref("新增学期");
const formRef = ref();
const form = reactive({
  id: null as number | null,
  name: "",
  start_date: "",
  end_date: "",
  is_current: false
});
const rules = {
  name: [{ required: true, message: "请输入学期名称", trigger: "blur" }],
  start_date: [
    { required: true, message: "请选择开始日期", trigger: "change" }
  ],
  end_date: [{ required: true, message: "请选择结束日期", trigger: "change" }]
};

function loadData() {
  loading.value = true;
  getTermList({
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
  dialogTitle.value = "新增学期";
  Object.assign(form, {
    id: null,
    name: "",
    start_date: "",
    end_date: "",
    is_current: false
  });
  dialogVisible.value = true;
}

function openEdit(row: any) {
  dialogTitle.value = "编辑学期";
  Object.assign(form, {
    id: row.id,
    name: row.name,
    start_date: row.start_date,
    end_date: row.end_date,
    is_current: row.is_current === 1
  });
  dialogVisible.value = true;
}

function handleSubmit() {
  formRef.value.validate((valid: boolean) => {
    if (!valid) return;
    const payload = {
      name: form.name,
      start_date: form.start_date,
      end_date: form.end_date,
      is_current: form.is_current ? 1 : 0
    };
    const api = form.id ? updateTerm(form.id, payload) : createTerm(payload);
    api.then((res: any) => {
      if (res.success) {
        ElMessage.success(form.id ? "修改成功" : "新增成功");
        dialogVisible.value = false;
        loadData();
      }
    });
  });
}

function handleSetCurrent(row: any) {
  ElMessageBox.confirm(`确定将「${row.name}」设为当前学期吗？`, "提示", {
    type: "warning",
    confirmButtonText: "确定",
    cancelButtonText: "取消"
  })
    .then(() => {
      setCurrentTerm(row.id).then((res: any) => {
        if (res.success) {
          ElMessage.success("已设为当前学期");
          loadData();
        }
      });
    })
    .catch(() => {});
}

function handleDelete(row: any) {
  ElMessageBox.confirm(`确定删除学期「${row.name}」吗？`, "提示", {
    type: "warning",
    confirmButtonText: "删除",
    cancelButtonText: "取消"
  })
    .then(() => {
      deleteTerm(row.id).then((res: any) => {
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
  <div class="p-4">
    <el-card shadow="never">
      <!-- 搜索 -->
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <el-input
          v-model="searchForm.name"
          placeholder="学期名称"
          clearable
          class="!w-56"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-button type="primary" @click="handleSearch">搜索</el-button>
        <el-button @click="handleReset">重置</el-button>
        <div class="flex-1" />
        <el-button type="primary" @click="openAdd">新增学期</el-button>
      </div>

      <!-- 表格 -->
      <el-table v-loading="loading" :data="dataList" border stripe>
        <el-table-column type="index" label="#" width="60" align="center" />
        <el-table-column prop="name" label="学期名称" min-width="200" />
        <el-table-column
          prop="start_date"
          label="开始日期"
          min-width="120"
          align="center"
        />
        <el-table-column
          prop="end_date"
          label="结束日期"
          min-width="120"
          align="center"
        />
        <el-table-column label="当前学期" width="100" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.is_current === 1" type="success" size="small"
              >当前</el-tag
            >
            <span v-else class="text-gray-400">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" min-width="170" />
        <el-table-column label="操作" width="230" align="center" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.is_current !== 1"
              link
              type="primary"
              @click="handleSetCurrent(row)"
            >
              设为当前
            </el-button>
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
        <el-form-item label="学期名称" prop="name">
          <el-input
            v-model="form.name"
            placeholder="如：2025-2026学年第二学期"
          />
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
        <el-form-item label="设为当前">
          <el-switch v-model="form.is_current" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>
