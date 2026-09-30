<script setup lang="ts">
// 教室管理（★ 2026-09-30 校区反馈⑤）
//
// 定位：排课用的「教室字典」—— 排课模板 / 加课弹窗 / 课次详情 都从这里选。
// 用字典表而非自由文本，是为了避免「302」「302教室」「三零二」三种写法并存。
//
// 写法对照同组配置页（courses / period-times）：AppPageHeader + el-card + el-table + el-dialog。
// 教室数量少 → 不分页（与后端 GET /api/rooms 返回全量一致）。
import { ref, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { getRoomList, createRoom, updateRoom, deleteRoom } from "@/api/rooms";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "Rooms"
});

const loading = ref(false);
const dataList = ref<any[]>([]);
const searchForm = ref({ keyword: "" });

const dialogVisible = ref(false);
const dialogTitle = ref("新增教室");
const formRef = ref<any>(null);
const submitting = ref(false);
const form = ref({
  id: null as number | null,
  name: "",
  capacity: null as number | null,
  remark: ""
});
const rules = {
  name: [{ required: true, message: "请输入教室名称", trigger: "blur" }]
};

function loadData() {
  loading.value = true;
  getRoomList({ keyword: searchForm.value.keyword })
    .then((res: any) => {
      if (res.success) dataList.value = res.data || [];
    })
    .finally(() => (loading.value = false));
}

function handleSearch() {
  loadData();
}

function handleReset() {
  searchForm.value.keyword = "";
  loadData();
}

function openAdd() {
  dialogTitle.value = "新增教室";
  form.value = { id: null, name: "", capacity: null, remark: "" };
  dialogVisible.value = true;
  formRef.value?.clearValidate();
}

function openEdit(row: any) {
  dialogTitle.value = "编辑教室";
  form.value = {
    id: row.id,
    name: row.name,
    capacity: row.capacity ?? null,
    remark: row.remark || ""
  };
  dialogVisible.value = true;
  formRef.value?.clearValidate();
}

async function submit() {
  const passed = await formRef.value?.validate().catch(() => false);
  if (!passed) return;
  submitting.value = true;
  const payload = {
    name: form.value.name,
    capacity: form.value.capacity,
    remark: form.value.remark
  };
  try {
    const res: any = form.value.id
      ? await updateRoom(form.value.id, payload)
      : await createRoom(payload);
    if (res.success) {
      ElMessage.success(form.value.id ? "已保存" : "教室已新增");
      dialogVisible.value = false;
      loadData();
    }
  } finally {
    submitting.value = false;
  }
}

function handleDelete(row: any) {
  ElMessageBox.confirm(
    `确定删除教室「${row.name}」吗？若它已被排课模板或课次使用，系统会拒绝并告诉你在哪儿用了。`,
    "删除确认",
    { type: "warning", confirmButtonText: "确认删除", cancelButtonText: "取消" }
  )
    .then(() => {
      deleteRoom(row.id).then((res: any) => {
        if (res.success) {
          ElMessage.success("已删除");
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
    <AppPageHeader
      title="教室管理"
      description="排课时可选的教室；排课模板与课次都从这里选，避免同一个教室出现多种写法"
    />
    <el-card shadow="never">
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <el-input
          v-model="searchForm.keyword"
          placeholder="教室名称 / 备注"
          clearable
          class="!w-56"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-button type="primary" @click="handleSearch">搜索</el-button>
        <el-button @click="handleReset">重置</el-button>
        <div class="flex-1" />
        <el-button type="primary" @click="openAdd">新增教室</el-button>
      </div>

      <el-table v-loading="loading" :data="dataList" border stripe>
        <el-table-column type="index" label="#" width="60" align="center" />
        <el-table-column prop="name" label="教室名称" min-width="160" />
        <el-table-column label="容量（人）" width="110" align="center">
          <template #default="{ row }">{{ row.capacity ?? "—" }}</template>
        </el-table-column>
        <el-table-column label="备注" min-width="220">
          <template #default="{ row }">{{ row.remark || "—" }}</template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="170" />
        <el-table-column label="操作" width="140" align="center" fixed="right">
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
            description="还没有教室，点右上角「新增教室」添加"
            :image-size="60"
          />
        </template>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="480px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="96px">
        <el-form-item label="教室名称" prop="name">
          <el-input
            v-model="form.name"
            placeholder="如：302教室 / 舞蹈房A"
            maxlength="50"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="容量（人）">
          <el-input-number
            v-model="form.capacity"
            :min="0"
            :max="1000"
            placeholder="可留空"
            class="!w-full"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="form.remark"
            type="textarea"
            :rows="2"
            placeholder="可留空，如：需提前 10 分钟开门"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit"
          >保存</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>
