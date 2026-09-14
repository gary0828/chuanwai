<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  name: string;
  value: number;
  classValue?: number;
  meta?: string;
}>();

const level = computed(() => {
  if (props.value < 60) return "low";
  if (props.value < 80) return "mid";
  return "high";
});
</script>

<template>
  <div class="kp">
    <div class="kp-top">
      <span class="kp-name" :title="name">{{ name }}</span>
      <span class="kp-val" :class="level">{{ value.toFixed(1) }}%</span>
    </div>
    <div class="kp-track">
      <div class="kp-fill" :class="level" :style="{ width: Math.max(2, value) + '%' }" />
    </div>
    <div v-if="classValue !== undefined || meta" class="kp-meta">
      <span v-if="classValue !== undefined">班级平均 {{ classValue.toFixed(1) }}%</span>
      <span v-if="meta">{{ meta }}</span>
    </div>
  </div>
</template>

<style scoped>
.kp + .kp {
  margin-top: 12px;
}

.kp-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 5px;
}

.kp-name {
  overflow: hidden;
  font-size: 12.5px;
  color: var(--c-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kp-val {
  flex-shrink: 0;
  font-size: 12.5px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.kp-val.low {
  color: var(--c-danger);
}

.kp-val.mid {
  color: var(--c-warn);
}

.kp-val.high {
  color: var(--c-success);
}

.kp-track {
  height: 6px;
  overflow: hidden;
  background: #eef1f4;
  border-radius: 3px;
}

.kp-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s;
}

.kp-fill.low {
  background: #e2685f;
}

.kp-fill.mid {
  background: #e8a33d;
}

.kp-fill.high {
  background: #3fa86a;
}

.kp-meta {
  display: flex;
  gap: 12px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--c-text-3);
}
</style>
