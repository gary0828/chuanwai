<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  getNoticeList,
  createNotice,
  updateNotice,
  deleteNotice
} from "@/api/attendance";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "SysNotices"
});

const loading = ref(false);
const dataList = ref<any[]>([]);
const searchForm = reactive({ keyword: "" });
const pagination = reactive({ page: 1, pageSize: 10, total: 0 });

const dialogVisible = ref(false);
const dialogTitle = ref("新增公告");
const formRef = ref();
const form = reactive({
  id: null as number | null,
  title: "",
  content: "",
  is_top: false,
  status: "发布"
});
const rules = {
  title: [{ required: true, message: "请输入公告标题", trigger: "blur" }],
  content: [{ required: true, message: "请输入公告内容", trigger: "blur" }]
};

function loadData() {
  loading.value = true;
  getNoticeList({
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
  dialogTitle.value = "新增公告";
  Object.assign(form, {
    id: null,
    title: "",
    content: "",
    is_top: false,
    status: "发布"
  });
  dialogVisible.value = true;
}

function openEdit(row: any) {
  dialogTitle.value = "编辑公告";
  Object.assign(form, {
    id: row.id,
    title: row.title,
    content: row.content,
    is_top: row.is_top === 1,
    status: row.status
  });
  dialogVisible.value = true;
}

function handleSubmit() {
  formRef.value.validate((valid: boolean) => {
    if (!valid) return;
    const payload = {
      title: form.title,
      content: form.content,
      is_top: form.is_top ? 1 : 0,
      status: form.status
    };
    const api = form.id
      ? updateNotice(form.id, payload)
      : createNotice(payload);
    api.then((res: any) => {
      if (res.success) {
        ElMessage.success(form.id ? "修改成功" : "新增成功");
        dialogVisible.value = false;
        loadData();
      }
    });
  });
}

function handleToggleStatus(row: any) {
  const target = row.status === "发布" ? "下架" : "发布";
  ElMessageBox.confirm(
    `确定${target === "发布" ? "恢复发布" : "下架"}公告「${row.title}」吗？`,
    "提示",
    {
      type: "warning",
      confirmButtonText: "确定",
      cancelButtonText: "取消"
    }
  )
    .then(() => {
      updateNotice(row.id, {
        title: row.title,
        content: row.content,
        is_top: row.is_top,
        status: target
      }).then((res: any) => {
        if (res.success) {
          ElMessage.success(target === "发布" ? "已发布" : "已下架");
          loadData();
        }
      });
    })
    .catch(() => {});
}

function handleDelete(row: any) {
  ElMessageBox.confirm(`确定删除公告「${row.title}」吗？`, "提示", {
    type: "warning",
    confirmButtonText: "删除",
    cancelButtonText: "取消"
  })
    .then(() => {
      deleteNotice(row.id).then((res: any) => {
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
    <AppPageHeader title="通知公告" description="面向员工的通知发布与置顶" />
    <el-card shadow="never">
      <!-- 搜索 -->
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <el-input
          v-model="searchForm.keyword"
          placeholder="公告标题关键字"
          clearable
          class="!w-56"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-button type="primary" @click="handleSearch">搜索</el-button>
        <el-button @click="handleReset">重置</el-button>
        <div class="flex-1" />
        <el-button type="primary" @click="openAdd">新增公告</el-button>
      </div>

      <!-- 表格 -->
      <el-table v-loading="loading" :data="dataList" border stripe>
        <el-table-column type="index" label="#" width="60" align="center" />
        <el-table-column prop="title" label="标题" min-width="220">
          <template #default="{ row }">
            <el-tag
              v-if="row.is_top === 1"
              type="danger"
              size="small"
              class="mr-1"
              >置顶</el-tag
            >
            {{ row.title }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag
              :type="row.status === '发布' ? 'success' : 'info'"
              size="small"
            >
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          prop="creator_name"
          label="发布人"
          width="120"
          align="center"
        />
        <el-table-column prop="created_at" label="发布时间" min-width="170" />
        <el-table-column label="操作" width="220" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)"
              >编辑</el-button
            >
            <el-button
              link
              :type="row.status === '发布' ? 'warning' : 'success'"
              @click="handleToggleStatus(row)"
            >
              {{ row.status === "发布" ? "下架" : "发布" }}
            </el-button>
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
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="560px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="标题" prop="title">
          <el-input
            v-model="form.title"
            placeholder="请输入公告标题"
            maxlength="50"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="内容" prop="content">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="4"
            placeholder="请输入公告内容"
            maxlength="500"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="置顶">
          <el-switch v-model="form.is_top" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio value="发布">发布</el-radio>
            <el-radio value="下架">下架</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>
