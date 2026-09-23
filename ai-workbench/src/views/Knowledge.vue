<script setup lang="ts">
import { computed, ref } from "vue";
import KpBar from "@/components/KpBar.vue";
import * as engine from "@/ai/engine";
import { knowledgeStats } from "@/ai/generators";
import { allKp, knowledgeTree, materials, unit } from "@/workbench-data";
import { questions } from "@/workbench-data";

const stats = knowledgeStats();
const tab = ref("kp");

const kpMastery = computed(() => {
  const map: Record<string, number> = {};
  for (const k of engine.kpMasteryRanking()) map[k.id] = k.value;
  return map;
});

const kpFilter = ref("全部");
const kpOptions = [{ id: "全部", name: "全部知识点" }, ...allKp.value.map(k => ({ id: k.id, name: k.name }))];

const filtered = computed(() =>
  kpFilter.value === "全部" ? questions.value : questions.value.filter(q => q.kp === kpFilter.value)
);

const cards = computed(() => [
  { label: "知识点", value: String(stats.kpCount), sub: `${unit.value.no}${unit.value.name} 覆盖` },
  { label: "题目", value: String(stats.questionCount), sub: `已启用 ${stats.questionEnabled} · 待审 ${stats.questionPending}` },
  { label: "教材与资料", value: String(stats.materialCount), sub: `待解析 ${stats.materialPending}` },
  { label: "最薄弱", value: `${stats.weakest?.value.toFixed(1)}%`, sub: stats.weakest?.name }
]);
</script>

<template>
  <div class="page">
    <div class="stat-row">
      <div v-for="c in cards" :key="c.label" class="metric">
        <div class="metric-label">{{ c.label }}</div>
        <div class="metric-value">{{ c.value }}</div>
        <div class="metric-sub">{{ c.sub }}</div>
      </div>
    </div>

    <el-tabs v-model="tab" class="kd-tabs">
      <el-tab-pane label="知识点" name="kp">
        <section class="card">
          <div class="card-head">
            <div class="card-title">知识点树与班级掌握度</div>
            <span class="card-sub">掌握度由本地指标引擎计算</span>
          </div>
          <div class="card-body">
            <div v-for="g in knowledgeTree" :key="g.id" class="group">
              <div class="group-head">
                <span class="group-name">{{ g.name }}</span>
                <span class="group-count">{{ g.children?.length || 0 }} 个知识点</span>
              </div>
              <div class="group-body">
                <KpBar
                  v-for="c in g.children"
                  :key="c.id"
                  :name="c.name"
                  :value="kpMastery[c.id] ?? 0"
                />
              </div>
            </div>
          </div>
        </section>
      </el-tab-pane>

      <el-tab-pane label="题库" name="q">
        <section class="card">
          <div class="card-head">
            <div class="card-title">题库</div>
            <el-select v-model="kpFilter" size="small" style="width: 200px">
              <el-option v-for="k in kpOptions" :key="k.id" :label="k.name" :value="k.id" />
            </el-select>
          </div>
          <div class="card-body">
            <div class="tbl-head">
              <span>题干</span>
              <span>知识点</span>
              <span>难度</span>
              <span>状态</span>
            </div>
            <div v-for="q in filtered" :key="q.id" class="tbl-row">
              <div class="q-stem" :title="q.stem">{{ q.stem }}</div>
              <div class="q-kp">{{ q.kpName }}</div>
              <div class="q-diff">{{ "★".repeat(q.difficulty) }}</div>
              <div>
                <span class="tag" :class="q.status === '已启用' ? 'tag-green' : 'tag-amber'">
                  {{ q.status }}
                </span>
              </div>
            </div>
          </div>
        </section>
      </el-tab-pane>

      <el-tab-pane label="教材与资料" name="m">
        <section class="card">
          <div class="card-head">
            <div class="card-title">教材与资料</div>
            <span class="card-sub">仅收录自编、授权或 AI 原创内容</span>
          </div>
          <div class="card-body">
            <div v-for="m in materials" :key="m.id" class="mat">
              <div class="mat-icon">{{ m.type }}</div>
              <div class="mat-main">
                <div class="mat-title">{{ m.title }}</div>
                <div class="mat-sub">
                  {{ m.size }} · {{ m.uploadedBy }} 上传于 {{ m.uploadedAt }} · 关联
                  {{ m.kps.length }} 个知识点
                </div>
              </div>
              <span class="tag" :class="m.status === '已入库' ? 'tag-green' : 'tag-amber'">
                {{ m.status }}
              </span>
            </div>
          </div>
        </section>
      </el-tab-pane>
    </el-tabs>

    <section class="card">
      <div class="card-head">
        <div class="card-title">版权口径</div>
      </div>
      <div class="card-body">
        <div class="policy">
          <div class="policy-item ok">
            <span class="tag tag-green">允许</span>
            教师自编题、AI 原创题、已获授权的教材电子版（需保留授权凭证）
          </div>
          <div class="policy-item no">
            <span class="tag tag-red">禁止</span>
            网络抓取题目、扫描教辅入库、整册复制教材原文
          </div>
          <div class="policy-item note">
            <span class="tag tag-blue">说明</span>
            原型阶段数据为演示内容，不涉及任何真实教辅；正式使用时由教研组确认来源后再入库。
          </div>
        </div>
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

.stat-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.metric-sub {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--c-text-3);
}

.kd-tabs :deep(.el-tabs__header) {
  margin-bottom: 12px;
}

.group + .group {
  padding-top: 14px;
  margin-top: 14px;
  border-top: 1px dashed var(--c-border);
}

.group-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
}

.group-name {
  font-size: 13.5px;
  font-weight: 600;
}

.group-count {
  font-size: 11.5px;
  color: var(--c-text-3);
}

.group-body {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px 26px;
}

.tbl-head,
.tbl-row {
  display: grid;
  grid-template-columns: 1.8fr 1fr 90px 80px;
  gap: 12px;
  align-items: center;
}

.tbl-head {
  padding-bottom: 8px;
  font-size: 12px;
  color: var(--c-text-3);
  border-bottom: 1px solid var(--c-border);
}

.tbl-row {
  padding: 9px 0;
  font-size: 12.5px;
  border-bottom: 1px dashed var(--c-border);
}

.tbl-row:last-child {
  border-bottom: none;
}

.q-stem {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.q-kp {
  color: var(--c-text-2);
}

.q-diff {
  font-size: 11px;
  color: var(--c-warn);
  letter-spacing: 1px;
}

.mat {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--c-border);
}

.mat:last-child {
  border-bottom: none;
}

.mat-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 42px;
  height: 28px;
  font-size: 10px;
  font-weight: 600;
  color: var(--c-primary-dark);
  background: var(--c-primary-soft);
  border-radius: 6px;
}

.mat-main {
  flex: 1;
  min-width: 0;
}

.mat-title {
  font-size: 13px;
  font-weight: 500;
}

.mat-sub {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--c-text-3);
}

.policy {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.policy-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--c-text-2);
}

@media (max-width: 1200px) {
  .stat-row,
  .group-body {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
