<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useUserStore } from "@/store/modules/user";
import { message } from "@/utils/message";
import {
  getFeedbackList,
  getFeedbackOptions,
  getFeedbackSummary,
  getMyFeedback,
  submitFeedback,
  updateFeedback,
  type FeedbackItem
} from "@/api/feedback";

defineOptions({ name: "FeedbackPanel" });

const userStore = useUserStore();
const isAdmin = computed(() => userStore.roles.includes("admin"));

const categories = ref<string[]>([
  "功能异常",
  "操作不便",
  "数据不准",
  "性能问题",
  "功能建议",
  "其他"
]);
const statuses = ref<string[]>(["待处理", "处理中", "已处理", "已忽略"]);

const form = reactive({ category: "功能异常", content: "" });
const submitting = ref(false);
const loading = ref(false);
const tab = ref("mine");
const statusFilter = ref("");

const mine = ref<FeedbackItem[]>([]);
const all = ref<FeedbackItem[]>([]);
const summary = ref<Record<string, number>>({ total: 0 });
const replyDraft = reactive<Record<number, string>>({});
const savingId = ref(0);

/** 标签颜色：待处理红、处理中橙、已处理绿、已忽略灰 */
function statusTag(s: string): any {
  if (s === "待处理") return "danger";
  if (s === "处理中") return "warning";
  if (s === "已处理") return "success";
  return "info";
}

async function loadOptions() {
  try {
    const res = await getFeedbackOptions();
    if (res?.success) {
      if (res.data.categories?.length) categories.value = res.data.categories;
      if (res.data.statuses?.length) statuses.value = res.data.statuses;
    }
  } catch {
    /* 字典拉取失败时沿用内置默认值 */
  }
}

async function loadMine() {
  const res = await getMyFeedback();
  if (res?.success) mine.value = res.data.list;
}

async function loadAll() {
  const res = await getFeedbackList({
    page: 1,
    pageSize: 50,
    status: statusFilter.value || undefined
  });
  if (res?.success) {
    all.value = res.data.list;
    for (const item of all.value) {
      if (replyDraft[item.id] === undefined) replyDraft[item.id] = item.admin_reply || "";
    }
  }
}

async function loadSummary() {
  const res = await getFeedbackSummary();
  if (res?.success) summary.value = res.data;
}

async function refresh() {
  loading.value = true;
  try {
    await loadMine();
    if (isAdmin.value) {
      await Promise.all([loadAll(), loadSummary()]);
    }
  } finally {
    loading.value = false;
  }
}

async function submit() {
  const text = form.content.trim();
  if (text.length < 5) {
    message("问题描述至少 5 个字", { type: "warning" });
    return;
  }
  submitting.value = true;
  try {
    const res = await submitFeedback({
      category: form.category,
      content: text,
      page_path: window.location.hash.replace(/^#/, "") || "/"
    });
    if (res?.success) {
      message("已提交，管理员会尽快查看", { type: "success" });
      form.content = "";
      await refresh();
    } else {
      message("提交失败，请稍后重试", { type: "error" });
    }
  } catch {
    message("提交失败，请检查网络后重试", { type: "error" });
  } finally {
    submitting.value = false;
  }
}

async function handle(item: FeedbackItem, status: string) {
  savingId.value = item.id;
  try {
    const res = await updateFeedback(item.id, {
      status,
      admin_reply: replyDraft[item.id] ?? item.admin_reply
    });
    if (res?.success) {
      message("已更新", { type: "success" });
      await refresh();
    } else {
      message("更新失败", { type: "error" });
    }
  } catch {
    message("更新失败，请稍后重试", { type: "error" });
  } finally {
    savingId.value = 0;
  }
}

onMounted(async () => {
  await loadOptions();
  await refresh();
});
</script>

<template>
  <el-card v-loading="loading" shadow="hover" class="mb-4">
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span>使用反馈</span>
        <div class="flex items-center gap-2">
          <el-tag
            v-if="isAdmin && (summary['待处理'] || 0) > 0"
            type="danger"
            size="small"
          >
            待处理 {{ summary["待处理"] }}
          </el-tag>
          <span class="text-xs text-gray-400">
            使用中遇到问题或有改进建议，写在这里由管理员统一跟进
          </span>
        </div>
      </div>
    </template>

    <el-form :model="form" label-width="76px">
      <el-form-item label="问题类型">
        <el-select v-model="form.category" style="width: 200px">
          <el-option v-for="c in categories" :key="c" :label="c" :value="c" />
        </el-select>
      </el-form-item>
      <el-form-item label="问题描述">
        <el-input
          v-model="form.content"
          type="textarea"
          :rows="3"
          maxlength="2000"
          show-word-limit
          placeholder="例如：学生批量导入时第 3 行日期格式报错，但提示里看不出是哪一行出的问题"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="submitting" @click="submit">
          提交反馈
        </el-button>
        <span class="ml-3 text-xs text-gray-400">
          只记录你的账号与问题描述，不会带上任何学员信息
        </span>
      </el-form-item>
    </el-form>

    <el-divider />

    <el-tabs v-if="isAdmin" v-model="tab">
      <el-tab-pane label="我的提交" name="mine" />
      <el-tab-pane :label="`全部反馈（${summary.total || 0}）`" name="all" />
    </el-tabs>

    <!-- 我的提交 / 教师视图 -->
    <div v-if="!isAdmin || tab === 'mine'">
      <div v-if="mine.length === 0" class="py-5 text-center text-[13px] text-gray-400">
        还没有提交过反馈
      </div>
      <div
        v-for="item in mine"
        :key="item.id"
        class="border-b border-gray-100 py-3 last:border-0"
      >
        <div class="flex flex-wrap items-center gap-2">
          <el-tag size="small" type="info">{{ item.category }}</el-tag>
          <el-tag size="small" :type="statusTag(item.status)">
            {{ item.status }}
          </el-tag>
          <span class="text-xs text-gray-400">{{ item.created_at }}</span>
        </div>
        <div class="mt-2 text-[13px] leading-relaxed whitespace-pre-wrap">
          {{ item.content }}
        </div>
        <div
          v-if="item.admin_reply"
          class="mt-2 rounded bg-blue-50 px-3 py-2 text-[13px] leading-relaxed"
        >
          <span class="text-xs text-blue-500">管理员回复 · {{ item.handled_at }}</span>
          <div class="mt-1 whitespace-pre-wrap">{{ item.admin_reply }}</div>
        </div>
      </div>
    </div>

    <!-- 全部反馈（admin） -->
    <div v-else>
      <div class="mb-3 flex items-center gap-2">
        <span class="text-xs text-gray-500">状态筛选</span>
        <el-select
          v-model="statusFilter"
          size="small"
          clearable
          placeholder="全部"
          style="width: 140px"
          @change="loadAll"
        >
          <el-option v-for="s in statuses" :key="s" :label="s" :value="s" />
        </el-select>
      </div>

      <div v-if="all.length === 0" class="py-5 text-center text-[13px] text-gray-400">
        暂无反馈
      </div>
      <div
        v-for="item in all"
        :key="item.id"
        class="border-b border-gray-100 py-3 last:border-0"
      >
        <div class="flex flex-wrap items-center gap-2">
          <el-tag size="small" type="info">{{ item.category }}</el-tag>
          <el-tag size="small" :type="statusTag(item.status)">
            {{ item.status }}
          </el-tag>
          <span class="text-xs text-gray-500">
            {{ item.username }}（{{ item.user_role === "admin" ? "管理员" : "教师" }}）
          </span>
          <span class="text-xs text-gray-400">{{ item.created_at }}</span>
          <span v-if="item.page_path" class="text-xs text-gray-400">
            页面 {{ item.page_path }}
          </span>
        </div>
        <div class="mt-2 text-[13px] leading-relaxed whitespace-pre-wrap">
          {{ item.content }}
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <el-input
            v-model="replyDraft[item.id]"
            size="small"
            type="textarea"
            :rows="2"
            placeholder="回复说明或处理结论（可留空）"
            style="max-width: 520px"
          />
          <el-button
            size="small"
            :loading="savingId === item.id"
            @click="handle(item, '处理中')"
          >
            标记处理中
          </el-button>
          <el-button
            size="small"
            type="primary"
            :loading="savingId === item.id"
            @click="handle(item, '已处理')"
          >
            标记已处理
          </el-button>
          <el-button
            size="small"
            type="info"
            plain
            :loading="savingId === item.id"
            @click="handle(item, '已忽略')"
          >
            忽略
          </el-button>
        </div>
      </div>
    </div>
  </el-card>
</template>
