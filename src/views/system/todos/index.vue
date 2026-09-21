<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  getTodoList,
  createTodo,
  updateTodo,
  deleteTodo,
  getUserList
} from "@/api/attendance";
import { AppPageHeader } from "@/components/AppPageHeader";
import { useUserStoreHook } from "@/store/modules/user";

// 待办（教务端 = 校区负责人视角）。
// ★ 权限：非 admin 的人在数据层就只看得到自己的（后端强制收敛 scope），
//   本页只是把「负责人筛选 / 指派」这类 admin 专属入口藏起来，不是权限边界。

defineOptions({
  name: "SysTodos"
});

const isAdmin = computed(() => useUserStoreHook().roles.includes("admin"));

const PRIORITIES = ["普通", "重要", "紧急"];

const loading = ref(false);
const dataList = ref<any[]>([]);
const searchForm = reactive({
  keyword: "",
  status: "",
  priority: "",
  owner_id: ""
});
const pagination = reactive({ page: 1, pageSize: 20, total: 0 });

/** 被折叠掉的组数（用于向用户说明「为什么行数少于总数」） */
const foldedGroups = computed(
  () => displayList.value.filter((r: any) => r.owners > 1).length
);

/** 员工列表（仅 admin 指派时用） */
const users = ref<any[]>([]);

const dialogVisible = ref(false);
const dialogTitle = ref("新建待办");
const formRef = ref();
const form = reactive({
  id: null as number | null,
  title: "",
  content: "",
  priority: "普通",
  due_date: "",
  owner_id: "" as number | "",
  /** 折叠行编辑时，改动要落到整组（同源的多条） */
  groupIds: [] as number[]
});
const rules = {
  title: [{ required: true, message: "请输入待办标题", trigger: "blur" }]
};

function loadData() {
  loading.value = true;
  getTodoList({
    ...searchForm,
    // admin 默认看全部；非 admin 即使传 all，后端也会收敛为「只看自己」
    scope: isAdmin.value ? "all" : "mine",
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

function loadUsers() {
  if (!isAdmin.value || users.value.length) return;
  getUserList({ page: 1, pageSize: 100 }).then((res: any) => {
    if (res.success) users.value = res.data?.list ?? res.data ?? [];
  });
}

/**
 * ★ 折叠同源（2026-09-21 用户要求）：
 * 一条自动待办可能**同时发给班主任 + admin**（多个 owner，见 `todo-generator.js` 的归属矩阵），
 * 于是在 admin 的「全部」视图里会出现**标题完全相同**的重复行 —— 那不是重复，是同一事件的两个收件人。
 * 按 `(source_type, source_ref_id)` 折叠成一行：
 *   - 负责人列合并显示（「系统管理员、e2e教师」）
 *   - 组内任一未完成 → 该行仍算「待办」
 *   - **完成 / 退回 / 删除 / 编辑 作用于该组全部** —— 因为本就是同一个事件
 * 手工待办（无 `source_type`）不参与折叠。
 */
const displayList = computed(() => {
  const groups = new Map<string, any[]>();
  const order: string[] = [];
  for (const t of dataList.value) {
    const key = t.source_type
      ? `src:${t.source_type}|${t.source_ref_id}`
      : `id:${t.id}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(t);
  }
  return order.map(key => {
    const rows = groups.get(key)!;
    const head: any = { ...rows[0] };
    head.groupIds = rows.map((r: any) => r.id);
    head.ownerNames = [
      ...new Set(rows.map((r: any) => r.owner_name).filter(Boolean))
    ];
    head.ownerText = head.ownerNames.join("、");
    head.owners = rows.length;
    head.status = rows.every((r: any) => r.status === "已完成")
      ? "已完成"
      : "待办";
    return head;
  });
});

function handleSearch() {
  pagination.page = 1;
  loadData();
}

function handleReset() {
  Object.assign(searchForm, {
    keyword: "",
    status: "",
    priority: "",
    owner_id: ""
  });
  handleSearch();
}

function openAdd() {
  dialogTitle.value = "新建待办";
  Object.assign(form, {
    id: null,
    title: "",
    content: "",
    priority: "普通",
    due_date: "",
    owner_id: "",
    groupIds: []
  });
  loadUsers();
  dialogVisible.value = true;
}

function openEdit(row: any) {
  // 折叠行：id 取组内第一条（后端用它定位），但提交时会写入整组
  dialogTitle.value =
    (row.groupIds?.length ?? 0) > 1
      ? "编辑待办（同源多条一并修改）"
      : "编辑待办";
  Object.assign(form, {
    id: row.id,
    title: row.title,
    content: row.content,
    priority: row.priority,
    due_date: row.due_date || "",
    owner_id: row.owner_id,
    groupIds: row.groupIds ?? [row.id]
  });
  loadUsers();
  dialogVisible.value = true;
}

function handleSubmit() {
  formRef.value.validate((valid: boolean) => {
    if (!valid) return;
    const payload: any = {
      title: form.title,
      content: form.content,
      priority: form.priority,
      due_date: form.due_date || null
    };
    // owner_id 只在 admin 明确选了别人才带（避免非 admin 触发 403）
    if (isAdmin.value && form.owner_id)
      payload.owner_id = Number(form.owner_id);

    // 折叠行编辑 → 落到整组；新建/普通行 → 单条
    const ids = form.id && form.groupIds.length ? form.groupIds : null;
    const api = form.id
      ? ids && ids.length > 1
        ? Promise.all(ids.map(id => updateTodo(id, payload)))
        : updateTodo(form.id, payload)
      : createTodo(payload);
    api.then((res: any) => {
      const okRes = Array.isArray(res)
        ? res.every((r: any) => r?.success)
        : res?.success;
      if (okRes) {
        ElMessage.success(form.id ? "修改成功" : "新建成功");
        dialogVisible.value = false;
        loadData();
      }
    });
  });
}

function handleToggleStatus(row: any) {
  const done = row.status === "待办";
  const target = done ? "已完成" : "待办";
  const ids: number[] = row.groupIds?.length ? row.groupIds : [row.id];
  // ★ 同源多条一并处理 —— 它们本是同一个事件的两个收件人
  Promise.all(ids.map(id => updateTodo(id, { status: target }))).then(() => {
    ElMessage.success(
      (done ? "已标记完成" : "已退回待办") +
        (ids.length > 1 ? `（同源 ${ids.length} 条一并处理）` : "")
    );
    loadData();
  });
}

function handleDelete(row: any) {
  const ids: number[] = row.groupIds?.length ? row.groupIds : [row.id];
  const extra = ids.length > 1 ? `（同时删除 ${ids.length} 条同源待办）` : "";
  ElMessageBox.confirm(`确定删除待办「${row.title}」${extra}吗？`, "提示", {
    type: "warning",
    confirmButtonText: "删除",
    cancelButtonText: "取消"
  })
    .then(() => {
      Promise.all(ids.map(id => deleteTodo(id))).then(() => {
        ElMessage.success("删除成功");
        loadData();
      });
    })
    .catch(() => {});
}

const priorityType = (p: string) =>
  p === "紧急" ? "danger" : p === "重要" ? "warning" : "info";

/** 逾期：待办 + 有截止日期 + 已过今天 */
function isOverdue(row: any) {
  if (row.status !== "待办" || !row.due_date) return false;
  const today = new Date();
  const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return row.due_date < t;
}

onMounted(loadData);
</script>

<template>
  <div class="app-page">
    <AppPageHeader
      title="待办"
      description="自己创建的待办，以及管理员指派给你的任务"
    />
    <el-card shadow="never">
      <!-- 筛选 -->
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <el-input
          v-model="searchForm.keyword"
          placeholder="标题 / 内容关键字"
          clearable
          class="!w-52"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-select
          v-model="searchForm.status"
          placeholder="状态"
          clearable
          class="!w-28"
        >
          <el-option label="待办" value="待办" />
          <el-option label="已完成" value="已完成" />
        </el-select>
        <el-select
          v-model="searchForm.priority"
          placeholder="优先级"
          clearable
          class="!w-28"
        >
          <el-option v-for="p in PRIORITIES" :key="p" :label="p" :value="p" />
        </el-select>
        <el-select
          v-if="isAdmin"
          v-model="searchForm.owner_id"
          placeholder="负责人"
          clearable
          class="!w-32"
        >
          <el-option
            v-for="u in users"
            :key="u.id"
            :label="u.name"
            :value="String(u.id)"
          />
        </el-select>
        <el-button type="primary" @click="handleSearch">搜索</el-button>
        <el-button @click="handleReset">重置</el-button>
        <div class="flex-1" />
        <el-button type="primary" @click="openAdd">新建待办</el-button>
      </div>

      <!-- 表格 -->
      <el-table v-loading="loading" :data="displayList" border stripe>
        <el-table-column type="index" label="#" width="60" align="center" />
        <el-table-column prop="title" label="标题" min-width="200">
          <template #default="{ row }">
            <el-tag
              v-if="row.priority !== '普通'"
              :type="priorityType(row.priority)"
              size="small"
              class="mr-1"
            >
              {{ row.priority }}
            </el-tag>
            {{ row.title }}
          </template>
        </el-table-column>
        <el-table-column label="负责人" min-width="150" align="center">
          <template #default="{ row }">
            <span>{{ row.ownerText }}</span>
            <!-- ★ 折叠行：标注这条同源待办实际发给了几个人 -->
            <el-tag v-if="row.owners > 1" type="info" size="small" class="ml-1">
              {{ row.owners }} 人
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="90" align="center">
          <template #default="{ row }">
            <el-tag
              :type="row.source === 'auto' ? 'warning' : 'info'"
              size="small"
            >
              {{ row.source === "auto" ? "系统" : "手工" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="截止" width="130" align="center">
          <template #default="{ row }">
            <span v-if="!row.due_date">—</span>
            <el-tag v-else-if="isOverdue(row)" type="danger" size="small">
              逾期 {{ row.due_date }}
            </el-tag>
            <span v-else>{{ row.due_date }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag
              :type="row.status === '已完成' ? 'success' : 'primary'"
              size="small"
            >
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="210" align="center" fixed="right">
          <template #default="{ row }">
            <el-button
              link
              :type="row.status === '待办' ? 'success' : 'info'"
              @click="handleToggleStatus(row)"
            >
              {{ row.status === "待办" ? "完成" : "退回" }}
            </el-button>
            <el-button link type="primary" @click="openEdit(row)"
              >编辑</el-button
            >
            <el-button link type="danger" @click="handleDelete(row)"
              >删除</el-button
            >
          </template>
        </el-table-column>
        <template #empty>
          <div class="py-8 text-center">
            <div class="mb-1">暂无待办</div>
            <div class="text-xs">点右上角「新建待办」开始</div>
          </div>
        </template>
      </el-table>

      <div class="mt-4 flex flex-wrap items-center justify-end gap-3">
        <!-- ★ 折叠是前端做的，所以「行数」与后端 total 会不一致，必须说清楚 -->
        <span class="text-xs">
          本页 {{ displayList.length }} 行<template v-if="foldedGroups"
            >（同源已折叠 {{ foldedGroups }} 组）</template
          >
          · 共 {{ pagination.total }} 条
        </span>
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :total="pagination.total"
          :page-sizes="[20, 50, 100]"
          layout="sizes, prev, pager, next"
          background
          @size-change="loadData"
          @current-change="loadData"
        />
      </div>
    </el-card>

    <!-- 新建 / 编辑 -->
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="520px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="标题" prop="title">
          <el-input
            v-model="form.title"
            placeholder="要做什么"
            maxlength="100"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="内容">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="3"
            placeholder="补充说明（可选）"
            maxlength="500"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="优先级">
          <el-radio-group v-model="form.priority">
            <el-radio v-for="p in PRIORITIES" :key="p" :value="p">
              {{ p }}
            </el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="截止日期">
          <el-date-picker
            v-model="form.due_date"
            type="date"
            placeholder="可不填"
            value-format="YYYY-MM-DD"
            class="!w-full"
          />
        </el-form-item>
        <el-form-item v-if="isAdmin" label="负责人">
          <el-select
            v-model="form.owner_id"
            placeholder="默认自己；可选他人指派"
            clearable
            class="!w-full"
          >
            <el-option
              v-for="u in users"
              :key="u.id"
              :label="`${u.name}（${u.role === 'admin' ? '管理员' : '教师'}）`"
              :value="u.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>
