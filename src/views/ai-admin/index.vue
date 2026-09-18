<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { message } from "@/utils/message";
import {
  getAiBalance,
  getAiConfig,
  getAiUsage,
  saveAiConfig,
  type AiBalanceData,
  type AiConfigData,
  type AiUsageData
} from "@/api/ai-admin";
import { AppPageHeader } from "@/components/AppPageHeader";
import RefreshIcon from "~icons/ep/refresh";
import SaveIcon from "~icons/ep/check";
import WalletIcon from "~icons/ep/wallet";
import UsageIcon from "~icons/ep/data-line";
import ShieldIcon from "~icons/ep/lock";

defineOptions({ name: "AiAdmin" });

const loading = ref(false);
const saving = ref(false);
const config = ref<AiConfigData | null>(null);
const balance = ref<AiBalanceData | null>(null);
const balanceError = ref("");
const usage = ref<AiUsageData | null>(null);

/** 表单值：键 -> 字符串。敏感字段从后端拿到的是掩码，未改动时原样回传 */
const form = reactive<Record<string, string>>({});

/** 字段分组（都是后端已定义的键，缺了就不显示，避免前端臆造配置） */
const GROUPS: Array<{ title: string; tip: string; keys: string[] }> = [
  {
    title: "大模型（DeepSeek / OpenAI 兼容）",
    tip: "留空即回退到服务器环境变量；改完点保存立即生效，不用重启。",
    keys: [
      "llmApiKey",
      "llmBaseUrl",
      "llmModel",
      "llmMaxTokens",
      "llmReasoningEffort",
      "llmTimeoutMs"
    ]
  },
  {
    title: "Dify 工作流（暂未启用，先占位）",
    tip: "接 Dify 后，每个场景可对应一条工作流；各场景 Key 用 JSON 填写。",
    keys: ["difyEndpoint", "difyApiKey", "difyWorkflows"]
  },
  {
    title: "工作台接入",
    tip: "必须是浏览器实际能打开的地址；留空则默认跟随访问者所用的主机。",
    keys: ["aiWorkbenchUrl"]
  }
];

const visibleGroups = computed(() =>
  GROUPS.map(g => ({
    ...g,
    fields: g.keys
      .filter(k => config.value?.fields?.[k])
      .map(k => ({ key: k, ...(config.value?.fields?.[k] as never) }))
  })).filter(g => g.fields.length > 0)
);

const sourceTag = (src: string) =>
  src === "db"
    ? { text: "配置中心", type: "success" as const }
    : { text: "环境变量", type: "info" as const };

async function load() {
  loading.value = true;
  try {
    const { data } = await getAiConfig();
    config.value = data;
    for (const [key, field] of Object.entries(data.fields)) {
      form[key] = field.value ?? "";
    }
  } catch (err: any) {
    message(`配置加载失败：${err?.message || err}`, { type: "error" });
  } finally {
    loading.value = false;
  }
}

async function loadBalance() {
  balanceError.value = "";
  try {
    const { data } = await getAiBalance();
    balance.value = data;
  } catch (err: any) {
    balance.value = null;
    balanceError.value = err?.message || "查询失败";
  }
}

async function loadUsage() {
  try {
    const { data } = await getAiUsage();
    usage.value = data;
  } catch {
    usage.value = null;
  }
}

/** 页头「刷新」：与首屏加载同一组调用，顺序与结果完全一致 */
async function reloadAll() {
  await load();
  await Promise.all([loadBalance(), loadUsage()]);
}

async function onSave() {
  saving.value = true;
  try {
    await saveAiConfig({ ...form });
    message("已保存，立即生效", { type: "success" });
    await load();
    await loadBalance();
  } catch (err: any) {
    message(`保存失败：${err?.message || err}`, { type: "error" });
  } finally {
    saving.value = false;
  }
}

onMounted(reloadAll);
</script>

<template>
  <div class="app-page">
    <AppPageHeader
      title="AI 配置中心"
      description="维护大模型与工作台的接入参数；改动保存后立即生效"
    >
      <el-button :icon="RefreshIcon" @click="reloadAll">刷新</el-button>
      <el-button
        type="primary"
        :icon="SaveIcon"
        :loading="saving"
        @click="onSave"
      >
        保存
      </el-button>
    </AppPageHeader>

    <!--
      这是管理者必须知道的两件事（Key 不下发浏览器、本页不进菜单），
      但它属于"说明"而非"异常"，所以不用 Element 的告警黄，改用品牌浅底。
    -->
    <div class="notice">
      <el-icon class="notice__icon"><ShieldIcon /></el-icon>
      <p>
        本页不出现在任何菜单里，只能凭地址 <code>/ai-admin</code> 进入，教师账号访问会被拒绝；
        已保存的 Key 只在服务器数据库中保存，页面仅回显掩码，未修改时原样保留。
      </p>
    </div>

    <!-- 余额与用量：走 .stat-grid，窄屏自动折为单列 -->
    <div class="stat-grid">
      <div class="stat-card stat-card--brand">
        <div class="stat-card__top">
          <span class="stat-card__label">账户可用余额</span>
          <span class="stat-card__icon">
            <WalletIcon />
          </span>
        </div>

        <div v-if="balance?.balances?.length" class="stat-body">
          <div class="stat-lead num">¥ {{ balance.balances[0].total }}</div>
          <div
            v-for="b in balance.balances.slice(1)"
            :key="b.currency"
            class="kv-row"
          >
            <span class="kv-row__k">{{ b.currency }} 可用</span>
            <span class="kv-row__v num">¥ {{ b.total }}</span>
          </div>
          <p class="page-hint">
            含赠送 ¥{{ balance.balances[0].granted }} · 充值 ¥{{
              balance.balances[0].toppedUp
            }}
          </p>
        </div>
        <p v-else class="stat-body page-hint">
          {{ balanceError || "暂未查询到，请确认已配置 Key 且服务器可访问外网" }}
        </p>
      </div>

      <div class="stat-card stat-card--success">
        <div class="stat-card__top">
          <span class="stat-card__label">本月用量</span>
          <span class="stat-card__icon">
            <UsageIcon />
          </span>
        </div>

        <div v-if="usage" class="stat-body">
          <div class="kv-row">
            <span class="kv-row__k">生成次数</span>
            <span class="kv-row__v num">{{ usage.times }}</span>
          </div>
          <div class="kv-row">
            <span class="kv-row__k">输入 / 输出 token</span>
            <span class="kv-row__v num">{{ usage.tin }} / {{ usage.tout }}</span>
          </div>
          <div class="kv-row">
            <span class="kv-row__k">估算成本</span>
            <span class="kv-row__v num">¥ {{ usage.cost.toFixed(4) }}</span>
          </div>
          <p class="page-hint">按高峰价估算，仅供量级参考，不作为对账依据</p>
        </div>
        <p v-else class="stat-body page-hint">本月还没有生成记录</p>
      </div>
    </div>

    <!-- 配置项 -->
    <div v-loading="loading" class="page-card mt-4">
      <header class="card-head">配置项</header>

      <section v-for="g in visibleGroups" :key="g.title" class="group">
        <h3 class="group__title">{{ g.title }}</h3>
        <p class="group__tip">{{ g.tip }}</p>

        <el-form
          label-width="auto"
          label-position="left"
          class="group__form"
          @submit.prevent
        >
          <el-form-item v-for="f in g.fields" :key="f.key">
            <!-- 来源标记放在标签行：输入框因此能独占整行，长 URL / Key 不会被挤窄 -->
            <template #label>
              <span class="field-label">{{ f.label }}</span>
              <el-tag
                :type="sourceTag(f.source).type"
                size="small"
                effect="plain"
                class="field-source"
              >
                {{ sourceTag(f.source).text }}
              </el-tag>
            </template>
            <el-input
              v-model="form[f.key]"
              :type="f.secret ? 'password' : 'text'"
              :show-password="f.secret"
              :placeholder="f.secret ? '未修改则保持原样' : ''"
            />
          </el-form-item>
        </el-form>
      </section>

      <p v-if="config?.updatedAt" class="page-hint">
        最近由 {{ config.updatedBy || "未知" }} 于 {{ config.updatedAt }} 修改
      </p>
    </div>
  </div>
</template>

<style lang="scss" scoped>
/* 说明条：浅品牌底 + 图标，语气是"告知"而不是"报警" */
.notice {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-4);
  background: var(--brand-50);
  border: 1px solid var(--brand-100);
  border-radius: var(--radius-md);
}

.notice__icon {
  flex-shrink: 0;
  margin-top: 2px;
  font-size: 16px;
  color: var(--brand-600);
}

.notice p {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--ink-600);
}

.notice code {
  padding: 1px 5px;
  font-size: var(--text-xs);
  color: var(--brand-700);
  background: var(--brand-100);
  border-radius: var(--radius-xs);
}

/* 卡片内容 */
.stat-body {
  margin-top: var(--space-3);
}

.stat-lead {
  font-size: var(--text-xl);
  font-weight: var(--weight-semibold);
  line-height: var(--leading-tight);
  color: var(--ink-900);
  letter-spacing: -0.015em;
}

.kv-row {
  display: flex;
  gap: var(--space-3);
  align-items: baseline;
  justify-content: space-between;
  padding: var(--space-1) 0;
  font-size: var(--text-sm);
}

.kv-row__k {
  color: var(--ink-500);
}

.kv-row__v {
  font-weight: var(--weight-medium);
  color: var(--ink-800);
}

/* 配置分组：用实线分隔，与全站分隔线语言一致（原为虚线） */
.group {
  padding-bottom: var(--space-4);
  margin-bottom: var(--space-4);
  border-bottom: 1px solid var(--ink-100);
}

.group:last-of-type {
  padding-bottom: 0;
  margin-bottom: var(--space-3);
  border-bottom: none;
}

.group__title {
  margin: 0;
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  color: var(--ink-800);
}

.group__tip {
  margin: var(--space-1) 0 var(--space-4);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
  color: var(--ink-500);
}

.group__form {
  max-width: 760px;
}

.field-label {
  color: var(--ink-600);
}

.field-source {
  margin-left: var(--space-2);
}

/* 平板竖屏及以下：标签移到输入框上方，避免长标签挤压输入区 */
@media (width <= 768px) {
  .group__form :deep(.el-form-item) {
    flex-direction: column;
    align-items: stretch;
  }

  .group__form :deep(.el-form-item__label) {
    justify-content: flex-start;
    margin-bottom: var(--space-1);
  }
}
</style>
