<script setup lang="ts">
/**
 * 题库统计
 *
 * 数据源：GET /api/qbank/overview（题型/来源/难度/状态分布 + 三个总数）
 * ★ 口径参照参考系统的「数据统计」页：题库题目数 / 已入卷数 / 题目分布。
 *   本系统一期还没有试卷，故不显示「已入卷」。
 */
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { request } from "../session";
import { withSubject } from "../subject";

const data = ref<any>(null);
const loading = ref(false);

const TYPE_COLORS: Record<string, string> = {
  单选题: "#409eff",
  多选题: "#67c23a",
  填空题: "#e6a23c",
  判断题: "#909399",
  解答题: "#f56c6c",
  简答题: "#9b59b6"
};

/** 简单条形图：用 div 宽度表示占比，避免为几个数字引图表库 */
function barWidth(count: number, total: number): string {
  return total > 0 ? `${Math.max((count / total) * 100, 1)}%` : "0%";
}

async function load() {
  loading.value = true;
  try {
    const qs = new URLSearchParams();
    withSubject(qs);
    data.value = await request(`/api/qbank/overview?${qs.toString()}`);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "统计加载失败");
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div v-loading="loading">
    <div v-if="data" class="qb-stats">
      <div class="qb-stat">
        <div class="n" style="color: #409eff">{{ data.total }}</div>
        <div class="l">题库题目总数</div>
      </div>
      <div class="qb-stat">
        <div class="n" style="color: #e6a23c">{{ data.aiAssisted }}</div>
        <div class="l">AI 辅助录入</div>
      </div>
      <div class="qb-stat">
        <div class="n" style="color: #909399">{{ data.withoutKp }}</div>
        <div class="l">未挂知识点（通用题）</div>
      </div>
      <div class="qb-stat">
        <div class="n" style="color: #67c23a">
          {{ (data.byStatus || []).find((s: any) => s.status === '已启用')?.c || 0 }}
        </div>
        <div class="l">已启用</div>
      </div>
    </div>

    <template v-if="data">
      <div class="card">
        <p class="card-title">题型分布</p>
        <div v-if="!data.byType?.length" class="qb-hint">还没有数据</div>
        <div
          v-for="t in data.byType"
          :key="t.type"
          style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px"
        >
          <span style="width: 64px; font-size: 13px">{{ t.type }}</span>
          <div style="flex: 1; background: #f0f2f5; border-radius: 4px; height: 20px; overflow: hidden">
            <div
              :style="{
                width: barWidth(t.c, data.total),
                height: '100%',
                background: TYPE_COLORS[t.type] || '#409eff'
              }"
            />
          </div>
          <span style="width: 84px; text-align: right; font-size: 12px; color: #909399">
            {{ t.c }} 道 · {{ data.total ? ((t.c / data.total) * 100).toFixed(1) : 0 }}%
          </span>
        </div>
      </div>

      <div style="display: flex; gap: 14px; flex-wrap: wrap">
        <div class="card" style="flex: 1; min-width: 280px">
          <p class="card-title">来源分布（版权口径）</p>
          <div v-if="!data.bySource?.length" class="qb-hint">还没有数据</div>
          <el-table :data="data.bySource" size="small" border>
            <el-table-column prop="source" label="来源" />
            <el-table-column prop="c" label="题数" width="80" align="right" />
            <el-table-column label="占比" width="100" align="right">
              <template #default="{ row }">
                {{ data.total ? ((row.c / data.total) * 100).toFixed(1) : 0 }}%
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="card" style="flex: 1; min-width: 280px">
          <p class="card-title">难度分布</p>
          <div v-if="!data.byDifficulty?.length" class="qb-hint">还没有数据</div>
          <el-table :data="data.byDifficulty" size="small" border>
            <el-table-column label="难度" width="100">
              <template #default="{ row }">
                {{ row.difficulty }} 级
                <span style="color: #909399; font-size: 12px">
                  {{ ["", "极易", "简单", "中等", "较难", "困难"][row.difficulty] }}
                </span>
              </template>
            </el-table-column>
            <el-table-column prop="c" label="题数" width="80" align="right" />
            <el-table-column label="占比" align="right">
              <template #default="{ row }">
                {{ data.total ? ((row.c / data.total) * 100).toFixed(1) : 0 }}%
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>

      <div class="card">
        <p class="card-title">状态分布</p>
        <div style="display: flex; gap: 10px; flex-wrap: wrap">
          <el-tag
            v-for="s in data.byStatus || []"
            :key="s.status"
            :type="s.status === '已启用' ? 'success' : s.status === '已归档' ? 'info' : 'warning'"
          >
            {{ s.status }} {{ s.c }}
          </el-tag>
        </div>
      </div>
    </template>

    <el-empty v-else-if="!loading" description="加载中或暂无数据" />
  </div>
</template>