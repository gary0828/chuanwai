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

onMounted(async () => {
  await load();
  await Promise.all([loadBalance(), loadUsage()]);
});
</script>

<template>
  <div class="ai-admin">
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="此处为 AI 配置中心，仅管理员可见"
      description="本页不出现在任何菜单里，只能凭地址 /ai-admin 进入；教师账号访问会被拒绝。Key 只存服务器数据库，永不下发浏览器，页面上也只显示掩码。"
      style="margin-bottom: 16px"
    />

    <div class="stat-row">
      <el-card shadow="never" class="stat-card">
        <template #header>
          <div class="card-head">
            <span>账户余额</span>
            <el-button size="small" text @click="loadBalance">刷新</el-button>
          </div>
        </template>
        <div v-if="balance?.balances?.length">
          <div v-for="b in balance.balances" :key="b.currency" class="stat-line">
            <span class="stat-k">可用余额（{{ b.currency }}）</span>
            <span class="stat-v">¥ {{ b.total }}</span>
          </div>
          <div class="stat-tip">
            含赠送 ¥{{ balance.balances[0].granted }} · 充值 ¥{{
              balance.balances[0].toppedUp
            }}
          </div>
        </div>
        <div v-else class="stat-empty">
          {{ balanceError || "暂未查询到（未配置 Key 或网络不通）" }}
        </div>
      </el-card>

      <el-card shadow="never" class="stat-card">
        <template #header>
          <div class="card-head"><span>本月用量</span></div>
        </template>
        <div v-if="usage">
          <div class="stat-line">
            <span class="stat-k">生成次数</span>
            <span class="stat-v">{{ usage.times }}</span>
          </div>
          <div class="stat-line">
            <span class="stat-k">输入 / 输出 token</span>
            <span class="stat-v">{{ usage.tin }} / {{ usage.tout }}</span>
          </div>
          <div class="stat-line">
            <span class="stat-k">估算成本</span>
            <span class="stat-v">¥ {{ usage.cost.toFixed(4) }}</span>
          </div>
          <div class="stat-tip">
            按高峰价估算，仅供量级参考，不作为对账依据
          </div>
        </div>
        <div v-else class="stat-empty">暂无数据</div>
      </el-card>
    </div>

    <el-card v-loading="loading" shadow="never">
      <template #header>
        <div class="card-head">
          <span>配置</span>
          <el-button type="primary" size="small" :loading="saving" @click="onSave">
            保存
          </el-button>
        </div>
      </template>

      <div v-for="g in visibleGroups" :key="g.title" class="group">
        <div class="group-title">{{ g.title }}</div>
        <div class="group-tip">{{ g.tip }}</div>
        <el-form label-width="170px" class="group-form">
          <el-form-item v-for="f in g.fields" :key="f.key" :label="f.label">
            <div class="field">
              <el-input
                v-model="form[f.key]"
                :type="f.secret ? 'password' : 'text'"
                :show-password="f.secret"
                :placeholder="f.secret ? '未修改则保持原样' : ''"
                size="default"
              />
              <el-tag :type="sourceTag(f.source).type" size="small" effect="plain">
                {{ sourceTag(f.source).text }}
              </el-tag>
            </div>
          </el-form-item>
        </el-form>
      </div>

      <div v-if="config?.updatedAt" class="updated">
        最近由 {{ config.updatedBy || "未知" }} 于 {{ config.updatedAt }} 修改
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.ai-admin {
  padding: 16px;
}
.stat-row {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}
.stat-card {
  flex: 1;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 500;
}
.stat-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 14px;
}
.stat-k {
  color: #606266;
}
.stat-v {
  font-weight: 500;
}
.stat-tip {
  margin-top: 6px;
  font-size: 12px;
  color: #909399;
}
.stat-empty {
  padding: 8px 0;
  font-size: 13px;
  color: #909399;
}
.group {
  padding-bottom: 8px;
  margin-bottom: 12px;
  border-bottom: 1px dashed #ebeef5;
}
.group:last-child {
  border-bottom: none;
}
.group-title {
  font-size: 14px;
  font-weight: 500;
}
.group-tip {
  margin: 4px 0 10px;
  font-size: 12px;
  color: #909399;
}
.group-form {
  max-width: 720px;
}
.field {
  display: flex;
  gap: 10px;
  align-items: center;
  width: 100%;
}
.updated {
  font-size: 12px;
  color: #909399;
}
</style>
