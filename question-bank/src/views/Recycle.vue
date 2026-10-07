<script setup lang="ts">
/**
 * 回收站。
 *
 * ★ 背景：一期删题是硬删，误删不可恢复。2026-10-07 改为软删
 *   （迁移 027 加 deleted_at），本页提供自助恢复。
 *
 * ★ 权限与删除**完全对称**：能用 canMutate 改的题才能恢复/彻底删除
 *   （否则会出现「删不了别人的题，却能把别人删的题恢复回来」这种怪事）。
 *   admin 还能「清空回收站」（一次抹掉全部回收站内容，最危险的操作）。
 *
 * ★ 与「题目库」页的差异：这里显示的是**已删**的题，且提供两个不同力度的操作 ——
 *      恢复     → 回到正常列表（安全）
 *      彻底删除 → 物理删除 + 清配图文件（不可逆，需二次确认）
 */
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { apiBase, currentUser, isRealUser, request } from "../session";
import { withSubject } from "../subject";
import { renderInline, stemPreview } from "../katex";

interface RecycledQuestion {
  id: number;
  type: string;
  stem: string;
  options: string;
  answer: string;
  analysis: string;
  difficulty: number;
  kp_ids: string;
  source: string;
  status: string;
  deleted_at: string;
  created_by: number | null;
  created_by_name: string;
  deleted_by_name: string;
  figure_path?: string;
}

const list = ref<RecycledQuestion[]>([]);
const total = ref(0);
const loading = ref(false);
const keyword = ref("");
const page = ref(1);
const pageSize = ref(20);
const selectedIds = ref<number[]>([]);

const isAdmin = computed(() => currentUser().role === "admin");
/** 我能操作的（与后端 canMutate 同口径） */
const selectedMutable = computed(() =>
  list.value.filter((q) => selectedIds.value.includes(q.id) && canMutate(q))
);

function canMutate(q: RecycledQuestion): boolean {
  if (currentUser().role === "admin") return true;
  return q.created_by === currentUser().id;
}

function parseOptions(q: RecycledQuestion): string[] {
  try {
    const v = JSON.parse(q.options || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function loadList() {
  loading.value = true;
  try {
    const qs = new URLSearchParams();
    // ★ 回收站也按学科隔离 —— 在物理学科下不该看到数学的回收站题
    withSubject(qs);
    if (keyword.value.trim()) qs.set("keyword", keyword.value.trim());
    qs.set("page", String(page.value));
    qs.set("pageSize", String(pageSize.value));
    const data = await request<{ list: RecycledQuestion[]; total: number }>(
      `/api/qbank/questions/recycle?${qs.toString()}`
    );
    list.value = data.list || [];
    total.value = data.total || 0;
    selectedIds.value = [];
  } catch (err) {
    list.value = [];
    total.value = 0;
    ElMessage.error(err instanceof Error ? err.message : "回收站加载失败");
  } finally {
    loading.value = false;
  }
}

/** 单选一道题（供行内「恢复」「彻底删除」按钮用）
 *  ★ 抽成方法而不是在模板里写 `((selectedIds = [q.id]), fn())` ——
 *    内联逗号表达式可读性差，出问题时也难定位。 */
function selectOnly(id: number) {
  selectedIds.value = [id];
}

function onSelectionChange(v: boolean, id: number) {
  if (v) {
    if (!selectedIds.value.includes(id)) selectedIds.value.push(id);
  } else {
    selectedIds.value = selectedIds.value.filter((i) => i !== id);
  }
}

async function restoreSelected() {
  const targets = selectedMutable.value;
  const blocked = selectedIds.value.length - targets.length;
  if (!targets.length) {
    ElMessage.error("请先勾选要恢复的题目（只能操作自己录入的）");
    return;
  }
  try {
    const data = await request<{ restored: number; skipped: number; message: string }>(
      "/api/qbank/questions/restore",
      { method: "POST", body: { ids: targets.map((q) => q.id) } }
    );
    ElMessage[data.skipped > 0 ? "warning" : "success"](
      data.message || `已恢复 ${data.restored} 道` + (blocked > 0 ? `（${blocked} 道无权跳过）` : "")
    );
    // ★ 恢复后提示去哪找 —— 否则老师不知道题"去哪了"
    if (data.restored > 0) {
      // ★ 必须用**对象形式**（2026-10-07 实测踩到）：
      //   `ElMessage.info("文本", { duration: 5000 })` 的第二个参数在 Element Plus
      //   里是 **Vue appContext**，传普通对象会让它内部 `setPrototypeOf` 失败并抛错 ——
      //   而那个错会被后面的 await 链吞掉，表现为「恢复成功但列表不刷新」。
      //   正确写法是把所有配置放进第一个对象参数。
      ElMessage({ type: "info", message: "已恢复到「题目库」，可在那里查看", duration: 5000 });
    }
    await loadList();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "恢复失败");
  }
}

async function purgeSelected() {
  const targets = selectedMutable.value;
  if (!targets.length) {
    ElMessage.error("请先勾选要彻底删除的题目（只能操作自己录入的）");
    return;
  }
  try {
    await ElMessageBox.confirm(
      `将**永久删除** ${targets.length} 道题（含配图文件），删除后无法恢复。\n\n` +
        `如果只是想暂时不用它们，请改用「恢复」把它们放回题目库。`,
      "彻底删除确认",
      { type: "error", confirmButtonText: "永久删除", cancelButtonText: "取消" }
    );
  } catch {
    return;
  }
  try {
    const data = await request<{ purged: number; skipped: number; message: string }>(
      "/api/qbank/questions/purge",
      { method: "POST", body: { ids: targets.map((q) => q.id) } }
    );
    ElMessage[data.skipped > 0 ? "warning" : "success"](`已彻底删除 ${data.purged} 道`);
    await loadList();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "彻底删除失败");
  }
}

async function purgeAll() {
  if (!isAdmin.value) {
    ElMessage.error("只有管理员可以清空回收站");
    return;
  }
  try {
    await ElMessageBox.confirm(
      `将清空回收站里的**全部 ${total.value} 道题**（含配图），此操作不可恢复。\n\n` +
        `建议先确认回收站里没有误删的题。`,
      "清空回收站",
      { type: "error", confirmButtonText: "清空", cancelButtonText: "取消" }
    );
  } catch {
    return;
  }
  try {
    // ★ 显式传 all:true（后端要求，不能靠 ids 为空隐式触发）
    const data = await request<{ purged: number; message: string }>("/api/qbank/questions/purge", {
      method: "POST",
      body: { all: true }
    });
    ElMessage.success(data.message || `已清空 ${data.purged} 道`);
    await loadList();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "清空失败");
  }
}

function search() {
  page.value = 1;
  loadList();
}

onMounted(loadList);
</script>

<template>
  <div class="qb-toolbar">
    <el-input
      v-model="keyword"
      placeholder="搜索已删除题目的题干"
      clearable
      style="width: 260px"
      @keyup.enter="search"
      @clear="search"
    />
    <el-button @click="search">搜索</el-button>
    <div class="qb-grow"></div>
    <el-button v-if="selectedIds.length" @click="restoreSelected">
      恢复勾选（{{ selectedIds.length }}）
    </el-button>
    <el-button v-if="selectedIds.length" type="danger" plain @click="purgeSelected">
      彻底删除勾选
    </el-button>
    <el-button v-if="isAdmin && total > 0" type="danger" plain @click="purgeAll">
      清空回收站
    </el-button>
  </div>

  <div class="qb-hint" style="margin-bottom: 10px">
    这里是被删除的题目。<b>恢复</b>会把它们放回「题目库」；
    <b>彻底删除</b>会永久抹掉（含配图），不可恢复。
    <template v-if="total > 0">共 {{ total }} 道。</template>
  </div>

  <div v-loading="loading">
    <div v-if="!list.length && !loading" class="qb-empty">
      <el-icon size="30" color="#c0c4cc"><Delete /></el-icon>
      <div class="qb-empty-title" style="margin-top: 10px">回收站是空的</div>
      <div class="qb-hint">被删除的题目会出现在这里，可随时恢复</div>
    </div>

    <div v-for="q in list" :key="q.id" class="qb-question">
      <div class="qb-q-head">
        <el-checkbox
          v-if="canMutate(q)"
          :model-value="selectedIds.includes(q.id)"
          style="margin-right: 4px; flex: 0 0 auto"
          @change="(v: any) => onSelectionChange(!!v, q.id)"
        />
        <el-tooltip v-else content="其他老师录入的题不能操作" placement="top">
          <span style="flex: 0 0 auto; width: 14px"></span>
        </el-tooltip>

        <div class="qb-q-stem qb-formula" v-html="renderInline(q.stem)" />
        <div style="white-space: nowrap">
          <el-tag size="small" effect="plain">{{ q.type }}</el-tag>
          <el-tag size="small" effect="plain" style="margin-left: 4px">
            难度 {{ q.difficulty }}
          </el-tag>
        </div>
      </div>

      <div v-if="parseOptions(q).length" class="qb-q-options qb-formula">
        <div
          v-for="(opt, i) in parseOptions(q)"
          :key="i"
          class="qb-q-opt"
          v-html="renderInline(`${['A', 'B', 'C', 'D', 'E', 'F'][i]}. ${opt}`)"
        />
      </div>

      <div v-if="q.answer" class="qb-q-answer qb-formula">
        <strong>答案：</strong><span v-html="renderInline(q.answer)" />
      </div>

      <div class="qb-q-meta">
        <el-tag size="small" type="danger" effect="plain">
          删除于 {{ q.deleted_at }}
        </el-tag>
        <span>删除人：{{ q.deleted_by_name || '—' }}</span>
        <span>录入：{{ q.created_by_name || '—' }}</span>
        <span>来源：{{ q.source }}</span>

        <div class="qb-grow" style="flex: 1"></div>

        <el-button
          v-if="canMutate(q)"
          link
          type="primary"
          size="small"
          @click="(selectOnly(q.id), restoreSelected())"
        >
          恢复
        </el-button>
        <el-button
          v-if="canMutate(q)"
          link
          type="danger"
          size="small"
          @click="(selectOnly(q.id), purgeSelected())"
        >
          彻底删除
        </el-button>
      </div>
    </div>
  </div>

  <el-pagination
    v-if="total > pageSize"
    v-model:current-page="page"
    v-model:page-size="pageSize"
    :total="total"
    :page-sizes="[10, 20, 50, 100]"
    layout="total, sizes, prev, pager, next"
    style="margin-top: 14px; justify-content: center"
    @current-change="loadList"
    @size-change="loadList"
  />
</template>
