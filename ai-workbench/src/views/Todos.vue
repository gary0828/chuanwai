<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import IconPlus from "~icons/ep/plus";
import IconInfo from "~icons/ep/info-filled";
import {
  loadMyTodos,
  setTodoStatus,
  createMyTodo,
  removeTodo,
  sourceMode,
  type WorkbenchTodo
} from "@/workbench-data";

// 我的待办（工作台 = 一线老师视角）。
//
// ★ 写法约定（照抄本目录的 `Settings.vue`，勿自创）：
//   - 控件一律用 **Element Plus**（`el-input` / `el-select` / `el-date-picker` /
//     `el-radio-group` / `el-button`）—— 全工作台都这么写；用原生 `<input>/<select>`
//     会与全站观感割裂（2026-09-21 踩过，整页像"没样式的白板"）。
//   - 颜色/边框只用工作台的 CSS 变量：`--c-text-2` `--c-text-3` `--c-border`
//     `--c-primary` `--c-danger` `--c-warn` `--c-success` `--c-info-soft`。
//     ⚠️ 写成 `--brand`/`--line` 之类**不存在的变量会导致样式静默失效**（同 2026-09-21 踩过）。
//   - 外壳用全局 `.card / .card-head / .card-title / .card-sub / .card-body / .sec-title /
//     .empty / .tip / .tag`（定义在 `styles.css`），表单行用 `.form-row`，列表用 `.rec-head/.rec-row`。
//
// ★ 与教务端是同一张表（`todos`），后端强制只看自己；
// ★ demo 模式下只读演示数据、写操作全部 no-op，并在界面明确标注。

const loading = ref(false);
const err = ref("");
const todos = ref<WorkbenchTodo[]>([]);
const tab = ref<"待办" | "已完成">("待办");

const showForm = ref(false);
const saving = ref(false);
const form = ref({
  title: "",
  content: "",
  priority: "普通",
  due_date: ""
});

const isDemo = computed(() => sourceMode.value !== "real");

const pendings = computed(() => todos.value.filter(t => t.status === "待办"));
const dones = computed(() => todos.value.filter(t => t.status === "已完成"));
const shown = computed(() => (tab.value === "待办" ? pendings.value : dones.value));

async function load() {
  loading.value = true;
  err.value = "";
  try {
    todos.value = await loadMyTodos();
  } catch (e: any) {
    err.value = e?.message || "加载待办失败";
  } finally {
    loading.value = false;
  }
}

function openForm() {
  showForm.value = true;
}

function resetForm() {
  form.value = { title: "", content: "", priority: "普通", due_date: "" };
  showForm.value = false;
}

async function toggle(t: WorkbenchTodo) {
  if (isDemo.value) return;
  err.value = "";
  try {
    await setTodoStatus(t.id, t.status === "待办" ? "已完成" : "待办");
    await load();
  } catch (e: any) {
    err.value = e?.message || "操作失败";
  }
}

async function submit() {
  const title = form.value.title.trim();
  if (!title) {
    err.value = "请填写待办标题";
    return;
  }
  if (isDemo.value) return;
  saving.value = true;
  err.value = "";
  try {
    await createMyTodo({
      title,
      content: form.value.content,
      priority: form.value.priority,
      due_date: form.value.due_date || null
    });
    resetForm();
    await load();
  } catch (e: any) {
    err.value = e?.message || "新建失败";
  } finally {
    saving.value = false;
  }
}

async function del(t: WorkbenchTodo) {
  if (isDemo.value) return;
  err.value = "";
  try {
    await removeTodo(t.id);
    await load();
  } catch (e: any) {
    err.value = e?.message || "删除失败";
  }
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function isOverdue(t: WorkbenchTodo): boolean {
  return t.status === "待办" && !!t.due_date && String(t.due_date) < todayStr();
}

function priorityTagClass(t: WorkbenchTodo): string {
  return t.priority === "紧急"
    ? "tag tag-red"
    : t.priority === "重要"
      ? "tag tag-amber"
      : "tag tag-gray";
}

onMounted(load);
</script>

<template>
  <div class="page">
    <!-- 演示模式说明：写操作不会落到真实库，必须显式告知 -->
    <div v-if="isDemo" class="tip">
      <IconInfo class="tip-icon" />
      当前为演示数据，<b>不会写入真实库</b>。切到顶栏「真实教务数据」后可管理自己的待办。
    </div>

    <!-- 新建表单 -->
    <section v-if="showForm" class="card">
      <div class="card-head">
        <div class="card-title">新建待办</div>
        <span class="card-sub">默认记给自己</span>
      </div>
      <div class="card-body">
        <div class="form-row">
          <label>标题</label>
          <el-input
            v-model="form.title"
            maxlength="100"
            show-word-limit
            placeholder="要做什么"
          />
        </div>
        <div class="form-row">
          <label>内容</label>
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="补充说明（可选）"
          />
        </div>
        <div class="form-row">
          <label>优先级</label>
          <el-radio-group v-model="form.priority">
            <el-radio-button value="普通">普通</el-radio-button>
            <el-radio-button value="重要">重要</el-radio-button>
            <el-radio-button value="紧急">紧急</el-radio-button>
          </el-radio-group>
        </div>
        <div class="form-row">
          <label>截止日期</label>
          <el-date-picker
            v-model="form.due_date"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="可不填"
            style="width: 200px"
          />
        </div>
        <div class="save-row">
          <el-button
            type="primary"
            :loading="saving"
            :disabled="isDemo"
            @click="submit"
          >
            保存
          </el-button>
          <el-button @click="resetForm">取消</el-button>
          <span v-if="isDemo" class="card-sub" style="margin-left: 8px">
            演示模式下不可保存，切到「真实教务数据」后可用
          </span>
        </div>
      </div>
    </section>

    <!-- 清单 -->
    <section class="card">
      <div class="card-head">
        <div class="card-title">待办清单</div>
        <div class="head-tools">
          <el-radio-group v-model="tab" size="small">
            <el-radio-button value="待办">待办 {{ pendings.length }}</el-radio-button>
            <el-radio-button value="已完成"
              >已完成 {{ dones.length }}</el-radio-button
            >
          </el-radio-group>
          <el-button
            type="primary"
            size="small"
            @click="openForm"
          >
            <template #icon><IconPlus /></template>
            新建待办
          </el-button>
        </div>
      </div>

      <div class="card-body">
        <div v-if="err" class="tip tip-err">{{ err }}</div>

        <p v-if="loading" class="card-sub">加载中…</p>

        <div v-else-if="!shown.length" class="empty">
          {{ tab === "待办" ? "暂无待办" : "还没有已完成的事项" }}
          <template v-if="tab === '待办'">
            —— 系统会在学员余额不足、连续缺勤等情况下自动生成，也可点右上角自己建
          </template>
        </div>

        <template v-else>
          <div class="rec-head">
            <span>标题</span>
            <span>优先级</span>
            <span>来源</span>
            <span>截止</span>
            <span>创建</span>
            <span>操作</span>
          </div>
          <div
            v-for="t in shown"
            :key="t.id"
            class="rec-row"
            :class="{ done: t.status === '已完成' }"
          >
            <span class="rec-title">{{ t.title }}</span>
            <span><span :class="priorityTagClass(t)">{{ t.priority }}</span></span>
            <span>
              <span class="tag" :class="t.source === 'auto' ? 'tag-blue' : 'tag-gray'">
                {{ t.source === "auto" ? "系统" : "手工" }}
              </span>
            </span>
            <span :class="{ overdue: isOverdue(t) }">
              <template v-if="t.due_date">
                {{ t.due_date }}<b v-if="isOverdue(t)">（逾期）</b>
              </template>
              <template v-else>—</template>
            </span>
            <span class="rec-time">{{ String(t.created_at).slice(0, 10) }}</span>
            <span class="ops">
              <el-button
                size="small"
                :disabled="isDemo"
                @click="toggle(t)"
              >
                {{ t.status === "待办" ? "完成" : "退回" }}
              </el-button>
              <el-button
                size="small"
                type="danger"
                link
                :disabled="isDemo"
                @click="del(t)"
              >
                删除
              </el-button>
            </span>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-row {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: 12px;
  align-items: start;
  margin-bottom: 12px;
}

.form-row label {
  padding-top: 6px;
  font-size: 12.5px;
  color: var(--c-text-2);
}

.save-row {
  margin-top: 16px;
}

.head-tools {
  display: flex;
  align-items: center;
  gap: 12px;
}

.rec-head,
.rec-row {
  display: grid;
  grid-template-columns: 2.2fr 0.7fr 0.7fr 1.1fr 0.9fr 1.1fr;
  gap: 12px;
  align-items: center;
}

.rec-head {
  padding-bottom: 8px;
  font-size: 12px;
  color: var(--c-text-3);
  border-bottom: 1px solid var(--c-border);
}

.rec-row {
  padding: 10px 0;
  font-size: 12.5px;
  border-bottom: 1px dashed var(--c-border);
}

.rec-row:last-child {
  border-bottom: none;
}

.rec-row.done .rec-title {
  color: var(--c-text-3);
  text-decoration: line-through;
}

.rec-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rec-time {
  color: var(--c-text-3);
}

.overdue {
  color: var(--c-danger);
}

.ops {
  display: flex;
  align-items: center;
}

.tip-err {
  color: var(--c-danger);
  background: var(--c-danger-soft);
}

@media (max-width: 1200px) {
  .rec-head {
    display: none;
  }

  .rec-row {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
