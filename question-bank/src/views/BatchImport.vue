<script setup lang="ts">
/**
 * 批量导入导出页
 *
 * ★ 导入的核心口径：**逐行校验、逐行回报**——
 *   老师导 100 道题，第 3 行写错不该让前 97 道白导。
 *   所以后端返回 { imported, failed, errors[] }，本页把「第几行错、错在什么」列出来。
 */
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { apiBase, currentUser, isRealUser, request } from "../session";
import { currentSubjectId } from "../subject";

const fileInput = ref<HTMLInputElement | null>(null);
const parsing = ref(false);
const importing = ref(false);
const result = ref<any>(null);
const rows = ref<any[]>([]);
const fileName = ref("");

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  fileName.value = file.name;
  parsing.value = true;
  result.value = null;
  try {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error("这个 Excel 里没有可读的工作表");
    const json = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
    rows.value = json;
    if (!json.length) {
      throw new Error("没有读到数据行。请确认用的是「题目导入模板」，且第一行是表头");
    }
    ElMessage.success(`已读到 ${json.length} 行，确认无误后点「开始导入」`);
  } catch (err) {
    rows.value = [];
    ElMessage.error(err instanceof Error ? err.message : "Excel 解析失败");
  } finally {
    parsing.value = false;
  }
}

async function doImport() {
  if (!rows.value.length) {
    ElMessage.error("请先选择 Excel 文件");
    return;
  }
  importing.value = true;
  try {
    const data = await request<any>("/api/qbank/questions/import", {
      method: "POST",
      // ★ 导入的学科从**请求**带（不让老师在 Excel 里每行填学科，啰嗦且易错）
      body: { rows: rows.value, course_id: currentSubjectId.value || undefined }
    });
    result.value = data;
    if (data.failed === 0) {
      ElMessage.success(`全部 ${data.imported} 道题导入成功`);
    } else {
      // ★ 部分失败必须**明确说清**，不能让老师以为全导进去了
      ElMessage.warning(`成功 ${data.imported} 道，失败 ${data.failed} 道，详见下方明细`);
    }
    rows.value = [];
    if (fileInput.value) fileInput.value.value = "";
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "导入失败");
  } finally {
    importing.value = false;
  }
}

/**
 * 下载导入模板。
 *
 * ★ 必须走 fetch + Blob，不能用 `<a href>` 直接指过去（2026-10-07 修复）：
 *   模板接口在 `auth` 中间件后面，`<a href>` **不带 Authorization 头**，
 *   实测点击直接 401，页面会跳出一个 JSON 报错、用户完全看不懂。
 *   与列表页的 exportXlsx() 用同一套「fetch 拿 blob → 触发下载」写法。
 *
 * 模板由后端生成，保证与导入解析口径完全一致（避免前后端各写一份列名）。
 */
async function downloadTemplate() {
  try {
    const res = await fetch(`${apiBase()}/api/qbank/questions/template.xlsx`, {
      headers: currentUser().qbToken
        ? { Authorization: `Bearer ${currentUser().qbToken}` }
        : {}
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "题目导入模板.xlsx";
    a.click();
    // ★ 必须 revoke，否则 blob 会一直驻留内存（导出文件几 MB）
    URL.revokeObjectURL(url);
    ElMessage.success("模板已下载");
  } catch (err) {
    ElMessage.error(
      isRealUser.value
        ? `模板下载失败：${err instanceof Error ? err.message : "未知错误"}`
        : "请从教务系统进入后再下载模板"
    );
  }
}

const previewCols = computed(() =>
  rows.value.length ? Object.keys(rows.value[0]).slice(0, 10) : []
);

function downloadErrors() {
  if (!result.value?.errors?.length) return;
  const lines = ["行号,错误原因"];
  for (const e of result.value.errors) lines.push(`${e.row},${e.message}`);
  const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "导入失败明细.csv";
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="card">
    <p class="card-title">
      Excel 批量导入
      <el-button size="small" @click="downloadTemplate">下载导入模板</el-button>
    </p>

    <div class="qb-hint" style="margin-bottom: 12px">
      <b>步骤：</b>① 下载模板 →② 用 Excel 填好 → ③ 选文件上传 → ④ 确认后导入。<br />
      ★ 单行出错**不影响其它行**，导入后会把「第几行、错在什么」逐条列出来。
    </div>

    <input
      ref="fileInput"
      type="file"
      accept=".xlsx,.xls"
      style="display: none"
      @change="onFile"
    />
    <div class="qb-toolbar">
      <el-button type="primary" @click="fileInput?.click()">选择 Excel 文件</el-button>
      <el-button
        type="success"
        :loading="importing"
        :disabled="!rows.length || !isRealUser"
        @click="doImport"
      >
        开始导入（{{ rows.length }} 行）
      </el-button>
      <span v-if="fileName" class="qb-hint">已选：{{ fileName }}</span>
    </div>

    <div v-if="parsing" style="margin-top: 12px">
      <el-skeleton :rows="3" animated />
    </div>
  </div>

  <!-- 待导入数据预览 -->
  <div v-if="rows.length" class="card">
    <p class="card-title">
      待导入预览（前 10 行）
      <span class="qb-hint">共 {{ rows.length }} 行</span>
    </p>
    <el-table :data="rows.slice(0, 10)" size="small" border max-height="380">
      <el-table-column prop="type" label="题型" width="86" />
      <el-table-column prop="stem" label="题干" min-width="240" show-overflow-tooltip />
      <el-table-column prop="answer" label="答案" width="90" />
      <el-table-column prop="difficulty" label="难度" width="60" />
      <el-table-column prop="source" label="来源" width="90" />
      <el-table-column prop="year" label="年份" width="70" />
    </el-table>
    <div v-if="rows.length > 10" class="qb-hint" style="margin-top: 6px">
      只预览前 10 行，导入时会处理全部 {{ rows.length }} 行
    </div>
  </div>

  <!-- 导入结果 -->
  <div v-if="result" class="card">
    <p class="card-title">导入结果</p>
    <el-descriptions :column="3" border>
      <el-descriptions-item label="总行数">{{ result.total }}</el-descriptions-item>
      <el-descriptions-item label="成功">
        <span style="color: #67c23a">{{ result.imported }}</span>
      </el-descriptions-item>
      <el-descriptions-item label="失败">
        <span :style="{ color: result.failed ? '#f56c6c' : '#909399' }">{{ result.failed }}</span>
      </el-descriptions-item>
    </el-descriptions>

    <template v-if="result.errors?.length">
      <div class="qb-toolbar" style="margin-top: 12px">
        <strong style="color: #f56c6c">失败明细</strong>
        <div class="qb-grow"></div>
        <el-button size="small" @click="downloadErrors">导出失败明细</el-button>
      </div>
      <el-table :data="result.errors" size="small" border max-height="300">
        <el-table-column prop="row" label="Excel 行号" width="100">
          <template #default="{ row }">第 {{ row.row }} 行</template>
        </el-table-column>
        <el-table-column prop="message" label="错误原因" min-width="360" />
      </el-table>
      <div class="qb-hint" style="margin-top: 6px">
        行号按 Excel 计（第 1 行是表头，所以数据从第 2 行开始）
      </div>
    </template>
    <div v-else class="qb-hint" style="margin-top: 12px; color: #67c23a">
      ✅ 全部导入成功，没有失败行
    </div>
  </div>
</template>