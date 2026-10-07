<script setup lang="ts">
/**
 * 知识点与章节管理。
 *
 * ★ 背景：一期这两棵树只能靠迁移预置（知识点 13 个 / 章节 42 个），
 *   老师无法按自己校区的教学体系调整。本页补上管理入口。
 *
 * ★★ 权限（用户 2026-10-07 拍板）：admin 与 teacher **都可增删改**。
 *   之所以敢放开，是因为老师最清楚自己教的章节该怎么分；
 *   代价是必须有**引用保护**（后端在删除前会检查引用，被引用则 409 拒绝）。
 *
 * ★★ 本页最重要的交互设计：**把"删除风险"提前显示出来**，而不是等用户点了删除才被拒。
 *   ① 每个节点旁显示「被 N 道题引用」；
 *   ② 知识点还多显示「N 条学生测评记录」—— 这是最危险的引用：
 *      `kp_assessments` 是 ON DELETE CASCADE，删知识点会**连带删掉学生的测评记录**
 *      （成长曲线的证据源，不可重建）。
 *   ③ 有引用的节点，删除按钮直接置灰并说明原因。
 */
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { currentUser, isRealUser, request } from "../session";
import { currentSubjectId, withSubject } from "../subject";

interface KpNode {
  id: number;
  parent_id: number | null;
  code: string;
  name: string;
  difficulty: number;
  seq: number;
  is_active: number;
  description: string;
  questionCount: number;
  assessmentCount: number;
}
interface ChapterNode {
  id: number;
  parent_id: number | null;
  name: string;
  sort: number;
  course_id: number | null;
  questionCount: number;
}

const tab = ref<"kp" | "chapter">("kp");
const loading = ref(false);
const knowledge = ref<KpNode[]>([]);
const chapters = ref<ChapterNode[]>([]);

/** 知识点树（章 → 节） */
const kpTree = computed(() => {
  const roots = knowledge.value.filter((k) => k.parent_id == null);
  return roots.map((r) => ({
    ...r,
    children: knowledge.value.filter((c) => c.parent_id === r.id)
  }));
});
/** 章节树（章 → 节） */
const chapterTree = computed(() => {
  const roots = chapters.value.filter((c) => c.parent_id == null);
  return roots.map((r) => ({
    ...r,
    children: chapters.value.filter((c) => c.parent_id === r.id)
  }));
});

async function loadAll() {
  loading.value = true;
  try {
    const qs = new URLSearchParams();
    withSubject(qs);
    const data = await request<{ knowledge: KpNode[]; chapters: ChapterNode[] }>(
      `/api/qbank/taxonomy?${qs.toString()}`
    );
    knowledge.value = data.knowledge || [];
    chapters.value = data.chapters || [];
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "加载失败");
  } finally {
    loading.value = false;
  }
}

// ── 知识点：新增 / 改名 / 删除 ─────────────────────────────
const kpDialog = reactive({
  visible: false,
  isEdit: false,
  id: 0,
  name: "",
  difficulty: 2,
  parent_id: "" as string | number,
  code: "",
  description: ""
});

function openKpCreate(parentId: number | null = null) {
  Object.assign(kpDialog, {
    visible: true, isEdit: false, id: 0, name: "", difficulty: 2,
    parent_id: parentId ?? "", code: "", description: ""
  });
}
function openKpEdit(k: KpNode) {
  Object.assign(kpDialog, {
    visible: true, isEdit: true, id: k.id, name: k.name, difficulty: k.difficulty,
    parent_id: k.parent_id ?? "", code: k.code, description: k.description || ""
  });
}

async function saveKp() {
  if (!kpDialog.name.trim()) {
    ElMessage.error("请填写知识点名称");
    return;
  }
  const body: any = {
    name: kpDialog.name.trim(),
    difficulty: kpDialog.difficulty,
    description: kpDialog.description,
    // ★ 新增知识点必须归属学科（否则管理页切学科后会"消失"）
    course_id: currentSubjectId.value || undefined
  };
  if (kpDialog.parent_id !== "") body.parent_id = kpDialog.parent_id;
  // 编辑时才允许改 code（新增留空会自动生成）
  if (kpDialog.isEdit && kpDialog.code) body.code = kpDialog.code;

  try {
    if (kpDialog.isEdit) {
      await request(`/api/qbank/taxonomy/kp/${kpDialog.id}`, { method: "PUT", body });
      ElMessage.success("已保存");
    } else {
      const r = await request<{ code: string }>("/api/qbank/taxonomy/kp", { method: "POST", body });
      ElMessage.success(`已新增（编码 ${r.code}）`);
    }
    kpDialog.visible = false;
    await loadAll();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "保存失败");
  }
}

/** 删除知识点 —— 前端的"预检"，与后端 kpDeleteBlocker 同口径 */
function kpBlocker(k: KpNode): string | null {
  if (k.questionCount > 0) return `还有 ${k.questionCount} 道题在用`;
  if (k.assessmentCount > 0) return `有 ${k.assessmentCount} 条学生测评记录（删了会丢学生数据）`;
  return null;
}

async function deleteKp(k: KpNode) {
  const blocker = kpBlocker(k);
  if (blocker) {
    ElMessage.warning(`${blocker}，不能删除`);
    return;
  }
  try {
    await ElMessageBox.confirm(`确定删除知识点「${k.name}」吗？`, "删除知识点", {
      type: "warning", confirmButtonText: "删除", cancelButtonText: "取消"
    });
  } catch {
    return;
  }
  try {
    const r = await request<{ message: string }>(`/api/qbank/taxonomy/kp/${k.id}`, { method: "DELETE" });
    ElMessage.success(r.message || "已删除");
    await loadAll();
  } catch (err) {
    // ★ 后端 409 时会给出**具体原因**（哪类引用、多少个），原样展示
    ElMessage.error({ message: err instanceof Error ? err.message : "删除失败", duration: 7000 });
  }
}

// ── 章节：新增 / 改名 / 删除 ─────────────────────────────
const chDialog = reactive({
  visible: false,
  isEdit: false,
  id: 0,
  name: "",
  parent_id: "" as string | number,
  sort: 0
});

function openChCreate(parentId: number | null = null) {
  Object.assign(chDialog, {
    visible: true, isEdit: false, id: 0, name: "", parent_id: parentId ?? "", sort: 0
  });
}
function openChEdit(c: ChapterNode) {
  Object.assign(chDialog, {
    visible: true, isEdit: true, id: c.id, name: c.name,
    parent_id: c.parent_id ?? "", sort: c.sort
  });
}

async function saveCh() {
  if (!chDialog.name.trim()) {
    ElMessage.error("请填写章节名称");
    return;
  }
  const body: any = {
    name: chDialog.name.trim(),
    sort: chDialog.sort,
    course_id: currentSubjectId.value || undefined
  };
  if (chDialog.parent_id !== "") body.parent_id = chDialog.parent_id;

  try {
    if (chDialog.isEdit) {
      await request(`/api/qbank/taxonomy/chapter/${chDialog.id}`, { method: "PUT", body });
      ElMessage.success("已保存");
    } else {
      await request("/api/qbank/taxonomy/chapter", { method: "POST", body });
      ElMessage.success("已新增");
    }
    chDialog.visible = false;
    await loadAll();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "保存失败");
  }
}

async function deleteChapter(c: ChapterNode) {
  if (c.questionCount > 0) {
    ElMessage.warning(`该章节下还有 ${c.questionCount} 道题在用，不能删除`);
    return;
  }
  const kids = (chapters.value.filter((x) => x.parent_id === c.id) || []).filter(
    (x) => x.questionCount > 0
  );
  if (kids.length > 0) {
    ElMessage.warning(`下级章节「${kids[0].name}」还有 ${kids[0].questionCount} 道题在用，不能删除`);
    return;
  }
  const subCount = chapters.value.filter((x) => x.parent_id === c.id).length;
  try {
    await ElMessageBox.confirm(
      subCount > 0
        ? `将删除章节「${c.name}」**及其 ${subCount} 个下级章节**，确定吗？`
        : `确定删除章节「${c.name}」吗？`,
      "删除章节",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" }
    );
  } catch {
    return;
  }
  try {
    const r = await request<{ message: string }>(`/api/qbank/taxonomy/chapter/${c.id}`, {
      method: "DELETE"
    });
    ElMessage.success(r.message || "已删除");
    await loadAll();
  } catch (err) {
    ElMessage.error({ message: err instanceof Error ? err.message : "删除失败", duration: 7000 });
  }
}

onMounted(loadAll);
</script>

<template>
  <div class="qb-toolbar">
    <el-radio-group v-model="tab">
      <el-radio-button label="kp">知识点（{{ knowledge.length }}）</el-radio-button>
      <el-radio-button label="chapter">章节（{{ chapters.length }}）</el-radio-button>
    </el-radio-group>
    <div class="qb-grow"></div>
    <el-button v-if="tab === 'kp'" type="primary" @click="openKpCreate(null)" :disabled="!isRealUser">
      ＋ 新增知识点
    </el-button>
    <el-button v-else type="primary" @click="openChCreate(null)" :disabled="!isRealUser">
      ＋ 新增章节
    </el-button>
  </div>

  <div class="qb-hint" style="margin-bottom: 12px">
    <b>引用保护：</b>被题目或学生测评记录引用的节点不能删除（按钮会置灰并说明原因）。
    知识点若不再使用，建议<b>改名加「（已停用）」前缀</b>而不是删除。
  </div>

  <div v-loading="loading">
    <!-- ── 知识点 ─────────────────────────────────────── -->
    <template v-if="tab === 'kp'">
      <div v-for="root in kpTree" :key="root.id" class="card" style="margin-bottom: 10px">
        <div style="display: flex; align-items: center; gap: 8px">
          <strong style="flex: 1">{{ root.name }}</strong>
          <el-tag size="small" effect="plain" type="info">编码 {{ root.code }}</el-tag>
          <el-tag size="small" effect="plain">难度 {{ root.difficulty }}</el-tag>
          <el-tag size="small" effect="plain" :type="root.questionCount ? 'primary' : 'info'">
            题目 {{ root.questionCount }}
          </el-tag>
          <el-tag
            v-if="root.assessmentCount"
            size="small"
            effect="plain"
            type="warning"
          >
            学生测评 {{ root.assessmentCount }}
          </el-tag>
          <el-tag v-if="!root.is_active" size="small" type="danger" effect="plain">已停用</el-tag>

          <el-button size="small" @click="openKpCreate(root.id)">＋子级</el-button>
          <el-button size="small" @click="openKpEdit(root)">改名</el-button>
          <el-tooltip
            :disabled="!kpBlocker(root)"
            :content="kpBlocker(root) || ''"
            placement="top"
          >
            <span>
              <el-button size="small" type="danger" plain :disabled="!!kpBlocker(root)" @click="deleteKp(root)">
                删除
              </el-button>
            </span>
          </el-tooltip>
        </div>

        <div
          v-for="child in root.children"
          :key="child.id"
          style="display: flex; align-items: center; gap: 8px; margin-top: 8px; padding-left: 24px"
        >
          <span style="flex: 1; color: var(--qb-text-secondary)">└ {{ child.name }}</span>
          <el-tag size="small" effect="plain" type="info">编码 {{ child.code }}</el-tag>
          <el-tag size="small" effect="plain">难度 {{ child.difficulty }}</el-tag>
          <el-tag size="small" effect="plain" :type="child.questionCount ? 'primary' : 'info'">
            题目 {{ child.questionCount }}
          </el-tag>
          <el-tag v-if="child.assessmentCount" size="small" effect="plain" type="warning">
            学生测评 {{ child.assessmentCount }}
          </el-tag>
          <el-tag v-if="!child.is_active" size="small" type="danger" effect="plain">已停用</el-tag>

          <el-button size="small" @click="openKpEdit(child)">改名</el-button>
          <el-tooltip
            :disabled="!kpBlocker(child)"
            :content="kpBlocker(child) || ''"
            placement="top"
          >
            <span>
              <el-button size="small" type="danger" plain :disabled="!!kpBlocker(child)" @click="deleteKp(child)">
                删除
              </el-button>
            </span>
          </el-tooltip>
        </div>
      </div>
    </template>

    <!-- ── 章节 ───────────────────────────────────────── -->
    <template v-else>
      <div v-for="root in chapterTree" :key="root.id" class="card" style="margin-bottom: 10px">
        <div style="display: flex; align-items: center; gap: 8px">
          <strong style="flex: 1">{{ root.name }}</strong>
          <el-tag size="small" effect="plain" :type="root.questionCount ? 'primary' : 'info'">
            题目 {{ root.questionCount }}
          </el-tag>
          <el-tag v-if="root.children.length" size="small" effect="plain" type="info">
            {{ root.children.length }} 节
          </el-tag>

          <el-button size="small" @click="openChCreate(root.id)">＋子级</el-button>
          <el-button size="small" @click="openChEdit(root)">改名</el-button>
          <el-tooltip
            :disabled="root.questionCount === 0 && !root.children.some((c) => c.questionCount > 0)"
            content="该章节或它的下级还有题目在用，不能删除"
            placement="top"
          >
            <span>
              <el-button
                size="small"
                type="danger"
                plain
                :disabled="root.questionCount > 0 || root.children.some((c) => c.questionCount > 0)"
                @click="deleteChapter(root)"
              >
                删除
              </el-button>
            </span>
          </el-tooltip>
        </div>

        <div
          v-for="child in root.children"
          :key="child.id"
          style="display: flex; align-items: center; gap: 8px; margin-top: 8px; padding-left: 24px"
        >
          <span style="flex: 1; color: var(--qb-text-secondary)">└ {{ child.name }}</span>
          <el-tag size="small" effect="plain" :type="child.questionCount ? 'primary' : 'info'">
            题目 {{ child.questionCount }}
          </el-tag>

          <el-button size="small" @click="openChEdit(child)">改名</el-button>
          <el-tooltip :disabled="child.questionCount === 0" content="该章节下还有题目在用，不能删除" placement="top">
            <span>
              <el-button
                size="small"
                type="danger"
                plain
                :disabled="child.questionCount > 0"
                @click="deleteChapter(child)"
              >
                删除
              </el-button>
            </span>
          </el-tooltip>
        </div>
      </div>
    </template>
  </div>

  <!-- 知识点编辑 -->
  <el-dialog
    v-model="kpDialog.visible"
    :title="kpDialog.isEdit ? '编辑知识点' : '新增知识点'"
    width="520px"
    :close-on-click-modal="false"
  >
    <el-form label-width="86px">
      <el-form-item label="名称" required>
        <el-input v-model="kpDialog.name" placeholder="如：全等三角形的判定" maxlength="60" show-word-limit />
      </el-form-item>
      <el-form-item label="上级">
        <el-select v-model="kpDialog.parent_id" clearable placeholder="留空=作为章（顶层）" style="width: 100%">
          <el-option
            v-for="k in knowledge.filter((x) => x.parent_id == null && x.id !== kpDialog.id)"
            :key="k.id"
            :label="k.name"
            :value="k.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="难度">
        <el-select v-model="kpDialog.difficulty" style="width: 120px">
          <el-option v-for="d in [1, 2, 3, 4, 5]" :key="d" :label="`${d} 级`" :value="d" />
        </el-select>
      </el-form-item>
      <el-form-item v-if="kpDialog.isEdit" label="编码">
        <el-input v-model="kpDialog.code" placeholder="用于 Excel 导入时匹配" />
      </el-form-item>
      <el-form-item label="说明">
        <el-input v-model="kpDialog.description" type="textarea" :rows="2" maxlength="300" show-word-limit />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="kpDialog.visible = false">取消</el-button>
      <el-button type="primary" @click="saveKp">保存</el-button>
    </template>
  </el-dialog>

  <!-- 章节编辑 -->
  <el-dialog
    v-model="chDialog.visible"
    :title="chDialog.isEdit ? '编辑章节' : '新增章节'"
    width="480px"
    :close-on-click-modal="false"
  >
    <el-form label-width="86px">
      <el-form-item label="名称" required>
        <el-input v-model="chDialog.name" placeholder="如：第三单元 · 等腰三角形" maxlength="80" show-word-limit />
      </el-form-item>
      <el-form-item label="上级">
        <el-select v-model="chDialog.parent_id" clearable placeholder="留空=作为章（顶层）" style="width: 100%">
          <el-option
            v-for="c in chapters.filter((x) => x.parent_id == null && x.id !== chDialog.id)"
            :key="c.id"
            :label="c.name"
            :value="c.id"
          />
        </el-select>
        <div class="qb-hint" style="margin-top: 4px">章节最多两层（章 → 节）</div>
      </el-form-item>
      <el-form-item label="排序">
        <el-input-number v-model="chDialog.sort" :min="0" :max="9999" controls-position="right" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="chDialog.visible = false">取消</el-button>
      <el-button type="primary" @click="saveCh">保存</el-button>
    </template>
  </el-dialog>
</template>
