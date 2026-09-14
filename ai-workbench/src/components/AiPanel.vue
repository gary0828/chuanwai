<script setup lang="ts">
import { computed, ref } from "vue";
import IconCopy from "~icons/ep/copy-document";
import IconInfo from "~icons/ep/info-filled";
import IconMagic from "~icons/ep/magic-stick";
import IconPrinter from "~icons/ep/printer";
import type { AiOutput } from "@/ai/generators";

const props = defineProps<{
  title: string;
  sub?: string;
  output: AiOutput | null;
  loading?: boolean;
  actionText?: string;
  hint?: string;
}>();

const emit = defineEmits<{ (e: "generate"): void }>();

const showMeta = ref(false);
const copied = ref(false);

const modeTag = computed(() => {
  const m = props.output?.meta.mode;
  if (!m) return { text: "", cls: "tag-gray" };
  if (m === "规则引擎") return { text: "规则引擎生成", cls: "tag-gray" };
  if (m === "服务端模型") return { text: "服务端模型生成", cls: "tag-green" };
  return { text: "Dify 生成", cls: "tag-blue" };
});

async function copyAll() {
  if (!props.output) return;
  try {
    await navigator.clipboard.writeText(props.output.text);
    copied.value = true;
    window.setTimeout(() => (copied.value = false), 1600);
  } catch {
    copied.value = false;
  }
}

function printIt() {
  window.print();
}
</script>

<template>
  <section class="card ai-panel">
    <div class="card-head">
      <div>
        <div class="card-title">
          <IconMagic class="ai-icon" />
          {{ title }}
        </div>
        <div v-if="sub" class="card-sub" style="margin-top: 2px">{{ sub }}</div>
      </div>
      <div class="head-actions no-print">
        <button v-if="output" class="ghost-btn" type="button" @click="copyAll">
          <IconCopy />
          {{ copied ? "已复制" : "复制全文" }}
        </button>
        <button v-if="output" class="ghost-btn" type="button" @click="printIt">
          <IconPrinter />
          打印
        </button>
        <el-button
          type="primary"
          size="default"
          :loading="loading"
          @click="emit('generate')"
        >
          {{ actionText || (output ? "重新生成" : "生成") }}
        </el-button>
      </div>
    </div>

    <div class="card-body">
      <div v-if="!output && !loading" class="empty">
        <div class="empty-title">尚未生成</div>
        <div class="empty-hint">
          {{ hint || "点击右上角生成，系统会先用本地指标算出结论，再组织成文字。" }}
        </div>
      </div>

      <div v-else-if="loading" class="empty">
        <div class="empty-title">正在生成…</div>
        <div class="empty-hint">本地指标计算中，随后交由底座组织文字。</div>
      </div>

      <template v-else>
        <div class="ai-badge" style="margin-bottom: 12px">
          <IconInfo />
          AI 生成，请核对后使用
        </div>

        <div class="sections">
          <div v-for="(s, i) in output!.sections" :key="i" class="sec">
            <div class="sec-title">{{ s.title }}</div>
            <div class="sec-body">{{ s.body }}</div>
          </div>
        </div>

        <div class="meta-toggle no-print" @click="showMeta = !showMeta">
          {{ showMeta ? "收起生成说明" : "查看生成说明（模式 / 脱敏 / 依据）" }}
        </div>

        <div v-if="showMeta && output" class="meta no-print">
          <div class="meta-row">
            <span class="meta-k">生成方式</span>
            <span class="tag" :class="modeTag.cls">{{ modeTag.text }}</span>
            <span class="meta-v">{{ output.meta.model }}</span>
          </div>
          <div class="meta-row">
            <span class="meta-k">耗时</span>
            <span class="meta-v">{{ output.meta.elapsedMs }} ms</span>
            <span class="meta-k" style="margin-left: 16px">Token</span>
            <span class="meta-v">输入 {{ output.meta.tokensIn }} / 输出 {{ output.meta.tokensOut }}</span>
            <span class="meta-k" style="margin-left: 16px">成本</span>
            <span class="meta-v">¥{{ output.meta.cost.toFixed(4) }}</span>
          </div>
          <div class="meta-row">
            <span class="meta-k">数据依据</span>
            <span class="meta-v">{{ output.meta.sourceRows }}（库版本 {{ output.meta.dataVersion }}）</span>
          </div>
          <div class="meta-row">
            <span class="meta-k">生成人</span>
            <span class="meta-v">{{ output.meta.operator }} · {{ output.meta.generatedAt.replace("T", " ").slice(0, 19) }}</span>
          </div>
          <div class="meta-row">
            <span class="meta-k">出网脱敏</span>
            <span v-if="output.meta.redacted.length === 0" class="meta-v">
              本次无可剔除项
            </span>
            <span v-else class="meta-v">
              已剔除 {{ output.meta.redacted.length }} 项：{{ output.meta.redacted.join("、") }}
            </span>
          </div>
          <div v-if="output.meta.fallbackReason" class="meta-row">
            <span class="meta-k">降级原因</span>
            <span class="meta-v warn">{{ output.meta.fallbackReason }}</span>
          </div>
          <div class="meta-row">
            <span class="meta-k">出网载荷</span>
            <pre class="payload">{{ JSON.stringify(output.payloadPreview, null, 2) }}</pre>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.ai-icon {
  color: var(--c-primary);
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ghost-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 11px;
  font-family: inherit;
  font-size: 12px;
  color: var(--c-text-2);
  cursor: pointer;
  background: #fff;
  border: 1px solid var(--c-border-strong);
  border-radius: 7px;
}

.ghost-btn:hover {
  color: var(--c-primary-dark);
  background: var(--c-primary-soft);
  border-color: var(--c-primary-line);
}

.empty-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--c-text-2);
}

.empty-hint {
  margin-top: 4px;
  font-size: 12px;
}

.sections {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.sec-body {
  font-size: 13px;
  line-height: 1.85;
  color: var(--c-text);
  white-space: pre-wrap;
}

.meta-toggle {
  margin-top: 14px;
  font-size: 12px;
  color: var(--c-primary);
  cursor: pointer;
}

.meta {
  padding: 12px 14px;
  margin-top: 8px;
  font-size: 12px;
  background: #f8fafc;
  border: 1px solid var(--c-border);
  border-radius: 8px;
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 7px;
}

.meta-row:last-child {
  margin-bottom: 0;
}

.meta-k {
  color: var(--c-text-3);
}

.meta-v {
  color: var(--c-text-2);
}

.meta-v.warn {
  color: #b45309;
}

.payload {
  width: 100%;
  max-height: 200px;
  padding: 8px 10px;
  margin: 4px 0 0;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 1.6;
  color: var(--c-text-2);
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: 6px;
}
</style>
