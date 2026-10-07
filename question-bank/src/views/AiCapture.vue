<script setup lang="ts">
/**
 * AI 录题页（方法①截图识别 + AI 出题）
 *
 * ★ 核心口径（K-050）：
 *   1. **识别结果不自动入库** —— 返回题卡让老师核对后再存。理由：AI 会认错，
 *      自动入库会污染题库，而「错题进库」比「没录进来」更难清理。
 *   2. **置信度必须显式展示** —— 低置信时页面明确标示，不能把不确定结果当正确答案呈现。
 *   3. **失败必须有可执行提示** —— 超时/格式错/没配 Key，各给不同的下一步。
 */
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { currentUser, isRealUser, request } from "../session";
import { currentSubjectId } from "../subject";

/** 知识点选项（供核对题卡时确认/修改 AI 的建议） */
const kpOptions = ref<{ id: number; label: string }[]>([]);
async function loadKpOptions() {
  try {
    const fc = await request<{ knowledge: { id: number; parent_id: number | null; name: string }[] }>(
      "/api/qbank/facets"
    );
    const rows = fc.knowledge || [];
    const roots = rows.filter((r) => r.parent_id == null);
    const out: { id: number; label: string }[] = [];
    for (const r of roots) {
      out.push({ id: r.id, label: r.name });
      for (const c of rows.filter((x) => x.parent_id === r.id)) {
        out.push({ id: c.id, label: `\u3000${c.name}` });   // 全角空格缩进子节点
      }
    }
    kpOptions.value = out;
  } catch {
    kpOptions.value = [];   // 拿不到知识点不阻塞录题
  }
}
import { renderInline, stemPreview } from "../katex";

const TYPES = ["单选题", "多选题", "填空题", "判断题", "解答题", "简答题"];
const SOURCES = ["自编", "AI 原创", "教材", "授权题库"];
const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];

const tab = ref<"recognize" | "generate">("recognize");

// ── 截图识别 ────────────────────────────────────────────
const fileInput = ref<HTMLInputElement | null>(null);
const preview = ref("");
const recognizing = ref(false);
const result = ref<any>(null);
const confidence = ref<number | null>(null);
const duplicateHint = ref<{ exact: any[]; similar: any[] } | null>(null);

/** 选图：先本地预览并压到 4MB 以内，避免超限被全局拦 */
function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
    ElMessage.error("请上传 PNG / JPEG / WebP / GIF 图片");
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    let dataUrl = String(reader.result || "");
    // 体积压缩：超过 3.5MB 就用 canvas 缩到 1600px 宽
    if (file.size > 3.5 * 1024 * 1024) {
      dataUrl = await shrinkImage(dataUrl, 1600);
    }
    preview.value = dataUrl;
    result.value = null;
    confidence.value = null;
    duplicateHint.value = null;
  };
  reader.readAsDataURL(file);
}

function shrinkImage(dataUrl: string, maxWidth: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function recognize() {
  if (!preview.value) {
    ElMessage.error("请先选择一张题目截图");
    return;
  }
  recognizing.value = true;
  result.value = null;
  duplicateHint.value = null;
  try {
    const data = await request<any>("/api/qbank/ocr/recognize", {
      method: "POST",
      // ★ 学科必填：模型无从知道老师在哪个学科操作，由前端带过去；
      //   知识点的反查也会限定在这个学科内（避免挂到别科的同名知识点上）
      body: { image: preview.value, course_id: currentSubjectId.value || undefined }
    });
    result.value = data.card;
    confidence.value = data.confidence;
    duplicateHint.value = data.duplicate || { exact: [], similar: [] };
    if (data.card) {
      ElMessage.success("识别完成，请核对题干与答案后再保存");
    }
  } catch (err) {
    // ★ 错误信息直接展示：后端已把「没配 Key / 超时 / 格式错」翻译成不同文案
    ElMessage.error({
      message: err instanceof Error ? err.message : "识别失败",
      duration: 7000
    });
  } finally {
    recognizing.value = false;
  }
}

const confidenceClass = computed(() => {
  const c = confidence.value;
  if (c == null) return "";
  if (c >= 0.8) return "high";
  if (c >= 0.5) return "mid";
  return "low";
});

const confidenceText = computed(() => {
  const c = confidence.value;
  if (c == null) return "模型未给出置信度";
  if (c >= 0.8) return `识别置信度 ${(c * 100).toFixed(0)}% · 结果较可靠，仍请核对公式与选项`;
  if (c >= 0.5) return `识别置信度 ${(c * 100).toFixed(0)}% · **请仔细核对**，公式尤其容易认错`;
  return `识别置信度仅 ${(c * 100).toFixed(0)}% · **建议手工录入这道题**，AI 识别很可能出错`;
});

/** 保存识别结果到题库 */
const savingCard = ref(false);
const cardForm = ref<any>(null);

function startEdit() {
  cardForm.value = {
    type: result.value.type || "单选题",
    stem: result.value.stem || "",
    options: Array.isArray(result.value.options) ? [...result.value.options] : [],
    answer: result.value.answer || "",
    analysis: result.value.analysis || "",
    difficulty: result.value.difficulty || 3,
    source: "AI 原创",
    solve_method: "",
    status: "待审",
    // ★★ 接上 AI 建议的知识点（2026-10-07 修）：
    //   后端已把模型给的名称反查成了 id，但一期前端这里**没接**，
    //   于是"AI 帮你挂好知识点"这个能力被整条丢弃 —— 白做。
    //   现在带进表单，老师在核对框里确认或修改后才入库。
    kp_ids: Array.isArray(result.value.kpIds) ? [...result.value.kpIds] : []
  };
}

async function saveRecognized() {
  const f = cardForm.value;
  if (!f) return;
  if (!f.stem.trim()) {
    ElMessage.error("题干不能为空");
    return;
  }
  savingCard.value = true;
  try {
    await request("/api/qbank/questions", {
      method: "POST",
      body: {
        ...f,
        options: f.options.map((o: string) => String(o || "").trim()).filter(Boolean),
        course_id: currentSubjectId.value || undefined,
        parse_status: "confirmed"
      }
    });
    ElMessage.success("已入库，可到「题目库」查看");
    resetRecognize();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "保存失败");
  } finally {
    savingCard.value = false;
  }
}

function resetRecognize() {
  preview.value = "";
  result.value = null;
  confidence.value = null;
  duplicateHint.value = null;
  cardForm.value = null;
  if (fileInput.value) fileInput.value.value = "";
}

// ── AI 出题 ──────────────────────────────────────────────
const genForm = ref({ topic: "", type: "单选题", difficulty: 3, count: 3 });
const generating = ref(false);
const genCards = ref<any[]>([]);

/**
 * 找出"AI 建议了但题库里没有"的知识点名称。
 * ★ 要**显示**出来而不是静默丢弃：老师看到"题库无此知识点"
 *   就知道该去「知识点管理」里补一个，或者接受不挂。
 */
function unusedKpNames(card: any): string[] {
  const all = Array.isArray(card?.knowledgePoints) ? card.knowledgePoints : [];
  const matched = Array.isArray(card?.kpIds) ? card.kpIds.length : 0;
  // 后端返回的 knowledgePoints 顺序与 kpIds 不完全对应（后者是去重后的），
  // 所以保守做法：只显示"建议总数 > 匹配数"的差额提示
  return matched >= all.length ? [] : all.slice(matched);
}

async function generate() {
  if (!genForm.value.topic.trim()) {
    ElMessage.error("请填写题目主题或选择知识点");
    return;
  }
  generating.value = true;
  genCards.value = [];
  try {
    const data = await request<any>("/api/qbank/ocr/generate", {
      method: "POST",
      body: { ...genForm.value, course_id: currentSubjectId.value || undefined }
    });
    genCards.value = data.cards || [];
    if (!genCards.value.length) {
      ElMessage.warning("模型没有生成可用题目，换个主题再试");
    } else {
      ElMessage.success(`生成了 ${genCards.value.length} 道题，挑选后可保存`);
    }
  } catch (err) {
    ElMessage.error({
      message: err instanceof Error ? err.message : "生成失败",
      duration: 7000
    });
  } finally {
    generating.value = false;
  }
}

const selectedCards = ref<Set<number>>(new Set());

function toggleCard(i: number) {
  const s = new Set(selectedCards.value);
  if (s.has(i)) s.delete(i);
  else s.add(i);
  selectedCards.value = s;
}

async function saveSelected() {
  const picked = genCards.value.filter((_, i) => selectedCards.value.has(i));
  if (!picked.length) {
    ElMessage.error("请先勾选要保存的题目");
    return;
  }
  try {
    let saved = 0;
    for (const c of picked) {
      await request("/api/qbank/questions", {
        method: "POST",
        body: {
          ...c,
          // ★ 带上后端已反查好的知识点 id（见 qbank-ocr.js 的 resolveKpNamesToIds）
          kp_ids: Array.isArray(c.kpIds) ? c.kpIds : [],
          // ★ 学科（出题时已按当前学科反查知识点，保存要落到同一学科）
          course_id: currentSubjectId.value || undefined,
          source: "AI 原创",
          status: "待审",
          parse_status: "confirmed"
        }
      });
      saved += 1;
    }
    ElMessage.success(`已保存 ${saved} 道题`);
    genCards.value = [];
    selectedCards.value = new Set();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "保存失败");
  }
}
onMounted(() => {
  // ★ 载入知识点选项：核对题卡时要能显示/修改 AI 建议的知识点。
  //   放在 onMounted 而非 setup 顶层，避免与首屏渲染抢带宽。
  loadKpOptions();
});
</script>

<template>
  <el-tabs v-model="tab">
    <el-tab-pane label="截图识别录题" name="recognize">
      <div class="card">
        <p class="card-title">上传题目截图，AI 识别成可编辑的题卡</p>
        <div class="qb-hint" style="margin-bottom: 12px">
          支持 PNG / JPEG / WebP / GIF，单张上限 4MB。<br />
          ★ 识别结果**不会自动入库** —— 请核对题干、公式与答案后再保存（AI 可能认错）。
        </div>

        <input
          ref="fileInput"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          style="display: none"
          @change="onFileChange"
        />
        <div class="qb-toolbar">
          <el-button type="primary" @click="fileInput?.click()">选择截图</el-button>
          <el-button type="success" :loading="recognizing" @click="recognize" :disabled="!preview">
            开始识别
          </el-button>
          <el-button v-if="preview" @click="resetRecognize">清除</el-button>
          <div class="qb-grow"></div>
          <el-button
            type="primary"
            plain
            @click="$router.push('/')"
          >
            去题目库
          </el-button>
        </div>

        <div v-if="preview" style="margin-top: 12px">
          <img
            :src="preview"
            alt="题目截图预览"
            style="max-width: 100%; max-height: 320px; border: 1px solid var(--qb-border); border-radius: 6px"
          />
        </div>
      </div>

      <div v-if="recognizing" class="card">
        <el-skeleton :rows="3" animated />
        <div class="qb-hint" style="margin-top: 10px">
          AI 正在识别，图片越复杂耗时越久（最长约 90 秒）…
        </div>
      </div>

      <template v-if="result">
        <div v-if="confidence != null || true" class="qb-confidence" :class="confidenceClass">
          <el-icon v-if="confidenceClass === 'low'" color="#c45656"><WarningFilled /></el-icon>
          <el-icon v-else-if="confidenceClass === 'mid'" color="#b88230"><InfoFilled /></el-icon>
          <el-icon v-else color="#529b2e"><CircleCheckFilled /></el-icon>
          <span>{{ confidenceText }}</span>
        </div>

        <div v-if="duplicateHint && (duplicateHint.exact.length || duplicateHint.similar.length)" class="qb-dup">
          <strong>⚠ 题库里已有相似题目</strong>
          <div v-for="d in duplicateHint.exact" :key="`e${d.id}`" class="qb-dup-item">
            <el-tag size="small" type="danger">完全相同</el-tag>
            <span class="qb-formula" style="margin-left: 6px" v-html="renderInline(stemPreview(d.stem, 70))" />
          </div>
          <div v-for="d in duplicateHint.similar" :key="`s${d.id}`" class="qb-dup-item">
            <el-tag size="small" type="warning">疑似 {{ (d.similarity * 100).toFixed(0) }}% 相似</el-tag>
            <span class="qb-formula" style="margin-left: 6px" v-html="renderInline(stemPreview(d.stem, 70))" />
          </div>
        </div>

        <div class="card">
          <p class="card-title">
            识别结果
            <el-button type="primary" size="small" @click="startEdit">核对并保存</el-button>
          </p>

          <el-form label-width="70px">
            <el-form-item label="题型">
              <el-tag>{{ result.type }}</el-tag>
            </el-form-item>
            <el-form-item label="题干">
              <div class="qb-formula" v-html="renderInline(result.stem)" />
            </el-form-item>
            <el-form-item v-if="result.options?.length" label="选项">
              <div
                v-for="(opt: string, i: number) in result.options"
                :key="i"
                class="qb-formula"
              >
                {{ OPTION_LETTERS[i] }}. {{ opt }}
              </div>
            </el-form-item>
            <el-form-item label="答案">
              <span class="qb-formula" v-html="renderInline(result.answer)" />
            </el-form-item>
            <el-form-item label="解析">
              <span class="qb-formula" v-html="renderInline(result.analysis || '（截图里没有解析）')" />
            </el-form-item>
            <el-form-item v-if="result.hasFigure" label="配图">
              <el-tag type="warning" size="small">
                截图里疑似有配图 —— 系统暂不自动裁图，请手工截图后在题目里上传
              </el-tag>
            </el-form-item>
          </el-form>

          <details>
            <summary class="qb-hint" style="cursor: pointer">查看模型原始输出（识别有疑问时对照排查）</summary>
            <pre
              class="qb-hint"
              style="white-space: pre-wrap; background: #f7f8fa; padding: 10px; border-radius: 6px; max-height: 240px; overflow: auto"
            >{{ result.raw }}</pre>
          </details>
        </div>
      </template>

      <!-- 核对编辑 -->
      <el-dialog
        v-if="cardForm"
        :model-value="true"
        title="核对题卡后保存"
        width="820px"
        top="6vh"
        :close-on-click-modal="false"
        @close="cardForm = null"
      >
        <el-form label-width="70px">
          <el-form-item label="题型">
            <el-select v-model="cardForm.type">
              <el-option v-for="t in TYPES" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
          <el-form-item label="题干">
            <el-input v-model="cardForm.stem" type="textarea" :rows="4" />
          </el-form-item>
          <el-form-item v-if="cardForm.type === '单选题' || cardForm.type === '多选题'" label="选项">
            <div v-for="(_, i) in cardForm.options" :key="i" style="display: flex; gap: 8px; margin-bottom: 6px">
              <el-tag style="width: 28px; justify-content: center">{{ OPTION_LETTERS[i] }}</el-tag>
              <el-input v-model="cardForm.options[i]" />
            </div>
            <el-button size="small" @click="cardForm.options.push('')">+ 加一个选项</el-button>
          </el-form-item>
          <el-form-item label="答案">
            <el-input v-model="cardForm.answer" />
          </el-form-item>
          <el-form-item label="解析">
            <el-input v-model="cardForm.analysis" type="textarea" :rows="3" />
          </el-form-item>
          <el-form-item label="知识点">
            <el-select
              v-model="cardForm.kp_ids"
              multiple
              filterable
              clearable
              collapse-tags
              placeholder="AI 未匹配到知识点，可手动选择"
              style="width: 100%"
            >
              <el-option
                v-for="k in kpOptions"
                :key="k.id"
                :label="k.label"
                :value="k.id"
              />
            </el-select>
            <div class="qb-hint" style="margin-top: 4px">
              这里是 AI 从题库知识点里**精确匹配**到的（匹配不上就为空）——
              请确认后再入库，挂错知识点会污染学情统计
            </div>
          </el-form-item>
          <el-form-item label="难度">
            <el-rate v-model="cardForm.difficulty" :max="5" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="cardForm = null">取消</el-button>
          <el-button type="primary" :loading="savingCard" @click="saveRecognized">
            确认入库
          </el-button>
        </template>
      </el-dialog>
    </el-tab-pane>

    <el-tab-pane label="AI 出题" name="generate">
      <div class="card">
        <p class="card-title">按主题与难度批量生成题目</p>
        <div class="qb-hint" style="margin-bottom: 12px">
          生成的题目会标记来源为「AI 原创」、状态「待审」，<b>需要老师确认质量后才能启用</b>。
        </div>

        <el-form inline>
          <el-form-item label="主题">
            <el-input
              v-model="genForm.topic"
              placeholder="如：三角函数求值"
              style="width: 200px"
              @keyup.enter="generate"
            />
          </el-form-item>
          <el-form-item label="题型">
            <el-select v-model="genForm.type" style="width: 110px">
              <el-option v-for="t in TYPES" :key="t" :label="t" :value="t" />
            </el-select>
          </el-form-item>
          <el-form-item label="难度">
            <el-select v-model="genForm.difficulty" style="width: 100px">
              <el-option v-for="d in [1, 2, 3, 4, 5]" :key="d" :label="`难度 ${d}`" :value="d" />
            </el-select>
          </el-form-item>
          <el-form-item label="数量">
            <el-input-number v-model="genForm.count" :min="1" :max="10" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="generating" @click="generate">生成</el-button>
          </el-form-item>
        </el-form>
      </div>

      <div v-if="generating" class="card">
        <el-skeleton :rows="4" animated />
        <div class="qb-hint" style="margin-top: 10px">正在出题（最长约 90 秒）…</div>
      </div>

      <div v-if="genCards.length" class="card">
        <p class="card-title">
          生成结果（{{ genCards.length }} 道）
          <div>
            <el-button size="small" @click="selectedCards = new Set(genCards.map((_, i) => i))">
              全选
            </el-button>
            <el-button size="small" @click="selectedCards = new Set()">全不选</el-button>
            <el-button
              type="primary"
              size="small"
              :disabled="selectedCards.size === 0"
              @click="saveSelected"
            >
              保存选中的 {{ selectedCards.size }} 道
            </el-button>
          </div>
        </p>

        <div v-for="(c, i) in genCards" :key="i" class="qb-question">
          <el-checkbox
            :model-value="selectedCards.has(i)"
            style="margin-right: 8px"
            @change="toggleCard(i)"
          />
          <div style="flex: 1">
            <div class="qb-q-stem qb-formula" v-html="renderInline(c.stem)" />
            <div v-if="c.options?.length" class="qb-q-options qb-formula">
              <div
                v-for="(opt: string, j: number) in c.options"
                :key="j"
                class="qb-q-opt"
                v-html="renderInline(`${OPTION_LETTERS[j]}. ${opt}`)"
              />
            </div>
            <div v-if="c.analysis" class="qb-q-analysis qb-formula">
              <strong>解析：</strong><span v-html="renderInline(c.analysis)" />
            </div>
            <div class="qb-q-meta">
              <el-tag size="small" effect="plain">{{ c.type }}</el-tag>
              <el-tag size="small" effect="plain">难度 {{ c.difficulty }}</el-tag>
              <!-- 命中题库知识点的显示绿色，没命中的显示灰色名称（让老师看到 AI 的建议） -->
              <el-tag v-for="n in (c.kpIds || []).length" :key="n" size="small" type="success" effect="plain">
                {{ (c.knowledgePoints || [])[n - 1] || "已挂知识点" }}
              </el-tag>
              <el-tag
                v-for="(n, i) in unusedKpNames(c)"
                :key="'u' + i"
                size="small"
                type="info"
                effect="plain"
              >
                {{ n }}（题库无此知识点）
              </el-tag>
            </div>
          </div>
        </div>
      </div>
    </el-tab-pane>
  </el-tabs>
</template>