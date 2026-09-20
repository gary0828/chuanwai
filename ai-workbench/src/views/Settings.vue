<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import IconDelete from "~icons/ep/delete";
import IconInfo from "~icons/ep/info-filled";
import IconRefresh from "~icons/ep/refresh";
import { loadConfig, saveConfig, type ProviderConfig } from "@/ai/provider";
import { clearRecords, listRecords, type GenRecord } from "@/ai/generators";
import { agentToken, apiBase, currentUser, setApiBase } from "@/session";
import { dataVersion, sourceMode } from "@/workbench-data";

const cfg = ref<ProviderConfig>(loadConfig());
const records = ref<GenRecord[]>([]);
const api = ref(apiBase());
const saved = ref(false);
const testing = ref(false);
const testResult = ref("");

const user = currentUser();

/** 服务端模型状态（由后端 /api/ai/llm-status 提供；Key 永远不下发前端） */
const llmStatus = ref<{ configured: boolean; model: string | null }>({
  configured: false,
  model: null
});
const statusLoading = ref(false);

async function loadLlmStatus() {
  statusLoading.value = true;
  try {
    const token = agentToken();
    const res = await fetch(`${apiBase()}/api/ai/llm-status`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
    const json = await res.json().catch(() => ({}));
    if (json?.success) llmStatus.value = json.data;
  } catch {
    /* 拉取失败时按「未配置」展示，不影响其他功能 */
  } finally {
    statusLoading.value = false;
  }
}

const recordsMeta = computed(() => ({
  count: records.value.length,
  cost: records.value.reduce((s, r) => s + r.cost, 0),
  redacted: records.value.reduce((s, r) => s + r.redactedCount, 0)
}));

onMounted(() => {
  refresh();
  void loadLlmStatus();
});

function refresh() {
  records.value = listRecords();
}

function save() {
  saveConfig(cfg.value);
  setApiBase(api.value);
  saved.value = true;
  window.setTimeout(() => (saved.value = false), 1600);
}

/**
 * 真实探活：调一次 `/api/ai/generate` 的最小载荷。
 * 与旧的"Dify 地址探活"不同，这里验证的是**整条服务端通道**（凭证 + 脱敏 + 模型），
 * 也是老师实际会用到的路径，因此探活结果有真实意义。
 */
async function testConnection() {
  testing.value = true;
  testResult.value = "";
  const started = performance.now();
  try {
    const token = agentToken();
    const res = await fetch(`${apiBase()}/api/ai/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        scene: "teaching_flow",
        payload: { probe: true, note: "设置页连通性探针" }
      })
    });
    const json = await res.json().catch(() => ({}));
    const ms = Math.round(performance.now() - started);
    if (res.ok && json?.success) {
      const chars = String(json.data?.text || "").length;
      testResult.value = `已连通（${ms}ms，模型 ${json.data?.model || "未知"}，返回 ${chars} 字）`;
      await loadLlmStatus();
    } else if (res.status === 503) {
      testResult.value = `服务端未配置模型（${json?.code || "LLM_NOT_CONFIGURED"}）：生成会自动回退规则引擎，教学流程不受影响`;
    } else {
      testResult.value = `未连通：HTTP ${res.status} ${json?.message || ""}`.trim();
    }
  } catch (err) {
    testResult.value = `未连通：${err instanceof Error ? err.message : "未知错误"}`;
  } finally {
    testing.value = false;
  }
}

function doClear() {
  clearRecords();
  refresh();
}

const FORBIDDEN = [
  "学生姓名 / 家长姓名",
  "家长电话 / 手机号",
  "金额（元）、缴费与退费",
  "身份证号 / 家庭住址"
];

const ALLOWED = [
  "内部学员编号（S-xxx）",
  "年级、学科、教材版本",
  "结构化指标数值（出勤率、得分率、掌握度等）",
  "知识点名称、题干与解析"
];
</script>

<template>
  <div class="page">
    <section class="card">
      <div class="card-head">
        <div class="card-title">AI 底座</div>
        <span class="card-sub">业务层不随底座变化，切换即刻生效</span>
      </div>
      <div class="card-body">
        <el-radio-group v-model="cfg.mode" size="default">
          <el-radio-button value="server">服务端模型（推荐）</el-radio-button>
          <el-radio-button value="rule">规则引擎（零配置）</el-radio-button>
        </el-radio-group>

        <div class="mode-desc">
          <template v-if="cfg.mode === 'server'">
            当前使用服务端模型：工作台把已脱敏的指标交给教务后端，由后端持有 Key 调用大模型。
            <b>Key 不下发前端，也不存在本机浏览器</b>；后端还会做二次脱敏并记录用量。
            未配置或调用失败会自动回退规则引擎并标注原因。
          </template>
          <template v-else>
            当前使用规则引擎：数字来自本地指标引擎，文案由模板组织。无需任何配置，任何环境都能跑，
            也作为服务端模型不可用时的兜底路径。
          </template>
        </div>

        <div v-if="cfg.mode === 'server'" class="server-form">
          <div class="kv">
            <span>服务端模型</span>
            <span>
              <template v-if="statusLoading">检测中…</template>
              <template v-else-if="llmStatus.configured">
                <span class="dot-on" />{{ llmStatus.model }}
              </template>
              <template v-else>
                <span class="dot-off" />未配置（教务后端 LLM_API_KEY 为空）
              </template>
            </span>
          </div>
          <div class="kv">
            <span>用量归属</span>
            <span>由教务后端写入 <code>ai_usage</code> 表，配置中心可查</span>
          </div>

          <div class="test-row">
            <el-button size="small" :loading="testing" @click="testConnection">
              <template #icon><IconRefresh /></template>
              测试服务端通道
            </el-button>
            <span v-if="testResult" class="test-result">{{ testResult }}</span>
          </div>

          <div class="tip">
            <IconInfo class="tip-icon" />
            在教务后端 <code>server/.env</code> 配置 <code>LLM_API_KEY</code>（可选
            <code>LLM_MODEL</code>、<code>LLM_BASE_URL</code>），重启后端后本页即显示当前模型。
            <b>Key 只存在于服务端，本工作台不提供任何密钥输入入口。</b>
          </div>
        </div>

        <div class="save-row">
          <el-button type="primary" size="default" @click="save">
            {{ saved ? "已保存" : "保存配置" }}
          </el-button>
        </div>
      </div>
    </section>

    <div class="grid-2">
      <section class="card">
        <div class="card-head">
          <div class="card-title">出网脱敏规则</div>
          <span class="tag tag-green">硬编码，不可绕过</span>
        </div>
        <div class="card-body">
          <div class="sec-title">禁止出网</div>
          <ul class="rule-list no">
            <li v-for="f in FORBIDDEN" :key="f">{{ f }}</li>
          </ul>
          <div class="sec-title" style="margin-top: 14px">允许出网</div>
          <ul class="rule-list ok">
            <li v-for="a in ALLOWED" :key="a">{{ a }}</li>
          </ul>
          <div class="tip">
            <IconInfo class="tip-icon" />
            脱敏在教务系统侧完成，不依赖模型自律；学生一律以内部编号送出，真实姓名在本地渲染时回填。
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div class="card-title">接入与身份</div>
        </div>
        <div class="card-body">
          <div class="kv">
            <span>当前身份</span>
            <span>{{ user.name }}（{{ user.role === "admin" ? "教务/校长" : "教师" }}）</span>
          </div>
          <div class="kv">
            <span>接入方式</span>
            <span>{{ user.source === "sso" ? "教务系统免登票据" : "演示身份（未走票据）" }}</span>
          </div>
          <div class="form-row" style="margin-top: 10px">
            <label>教务系统地址</label>
            <el-input v-model="api" size="small" placeholder="留空 = 同源（推荐）" />
          </div>
          <div class="kv">
            <span>数据源</span>
            <span>
              {{
                sourceMode === "real"
                  ? `真实教务数据（${dataVersion || "版本未知"}）`
                  : "演示数据"
              }}
            </span>
          </div>
          <div class="tip" style="margin-top: 12px">
            <IconInfo class="tip-icon" />
            链路：教务系统签发一次性票据 → 本工作台调用 <code>/api/ai/sso/verify</code> 换取会话；
            教学数据经 <code>/api/agent/*</code> 只读获取，不含金额。部署时由 nginx 同源反代 /api，
            因此「教务系统地址」留空即可。
          </div>
        </div>
      </section>
    </div>

    <section class="card">
      <div class="card-head">
        <div class="card-title">生成记录</div>
        <div class="head-tools">
          <span class="card-sub">
            共 {{ recordsMeta.count }} 次 · 累计成本 ¥{{ recordsMeta.cost.toFixed(4) }} · 脱敏 {{ recordsMeta.redacted }} 项
          </span>
          <el-button size="small" :disabled="!records.length" @click="doClear">
            <template #icon><IconDelete /></template>
            清空
          </el-button>
        </div>
      </div>
      <div class="card-body">
        <div v-if="!records.length" class="empty">
          还没有生成记录。到任一模块点一次生成，这里会留下可审计的痕迹。
        </div>
        <template v-else>
          <div class="rec-head">
            <span>场景</span>
            <span>生成人</span>
            <span>方式</span>
            <span>成本</span>
            <span>脱敏项</span>
            <span>时间</span>
          </div>
          <div v-for="(r, i) in records" :key="i" class="rec-row">
            <span>{{ r.sceneLabel }}</span>
            <span>{{ r.operator }}</span>
            <span class="tag" :class="r.mode === '规则引擎' ? 'tag-gray' : 'tag-blue'">{{ r.mode }}</span>
            <span>¥{{ r.cost.toFixed(4) }}</span>
            <span>{{ r.redactedCount }}</span>
            <span class="rec-time">{{ r.generatedAt.replace("T", " ").slice(0, 19) }}</span>
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

.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.mode-desc {
  padding: 10px 12px;
  margin-top: 12px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--c-text-2);
  background: #f8fafc;
  border-radius: 8px;
}

.server-form {
  padding-top: 16px;
  margin-top: 14px;
  border-top: 1px dashed var(--c-border);
}

/* 服务端模型状态点：有模型=绿，无模型=灰（不是错误，是"未配置"） */
.dot-on,
.dot-off {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 6px;
  vertical-align: middle;
  border-radius: 50%;
}

.dot-on {
  background: var(--c-success);
}

.dot-off {
  background: var(--c-text-3);
}

.form-row {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: 12px;
  align-items: center;
  margin-bottom: 10px;
}

.form-row label {
  font-size: 12.5px;
  color: var(--c-text-2);
}

.scene-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 20px;
}

.scene-row {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 10px;
  align-items: center;
}

.scene-name {
  font-size: 12px;
  color: var(--c-text-2);
}

.test-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
}

.test-result {
  font-size: 12px;
  line-height: 1.6;
  color: var(--c-text-2);
}

.save-row {
  margin-top: 16px;
}

.rule-list {
  padding-left: 18px;
  margin: 0;
  font-size: 12.5px;
  line-height: 1.9;
}

.rule-list.no {
  color: var(--c-danger);
}

.rule-list.ok {
  color: var(--c-success);
}

.tip {
  display: flex;
  gap: 7px;
  padding: 9px 11px;
  margin-top: 14px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--c-text-2);
  background: var(--c-info-soft);
  border-radius: 8px;
}

.tip-icon {
  flex-shrink: 0;
  margin-top: 2px;
  color: #0e7490;
}

.tip code {
  padding: 1px 5px;
  font-size: 11.5px;
  background: #fff;
  border-radius: 4px;
}

.kv {
  display: flex;
  gap: 12px;
  padding: 7px 0;
  font-size: 12.5px;
  border-bottom: 1px dashed var(--c-border);
}

.kv > span:first-child {
  flex-shrink: 0;
  width: 88px;
  color: var(--c-text-3);
}

.head-tools {
  display: flex;
  align-items: center;
  gap: 12px;
}

.rec-head,
.rec-row {
  display: grid;
  grid-template-columns: 1.3fr 0.8fr 0.9fr 0.8fr 0.6fr 1.4fr;
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
  padding: 9px 0;
  font-size: 12.5px;
  border-bottom: 1px dashed var(--c-border);
}

.rec-row:last-child {
  border-bottom: none;
}

.rec-time {
  color: var(--c-text-3);
}

@media (max-width: 1200px) {
  .grid-2 {
    grid-template-columns: 1fr;
  }

  .rec-head {
    display: none;
  }

  .rec-row {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
