<script setup lang="ts">
import type { Component } from "vue";
import DocumentIcon from "~icons/ep/document";

defineOptions({
  name: "AppEmpty"
});

withDefaults(
  defineProps<{
    /** 主文案：说清"这里为什么是空的"，不要只写"暂无数据" */
    title?: string;
    /** 补充说明：告诉用户下一步能做什么 */
    description?: string;
    /** 图标组件，传 ~icons/ep/xxx 或任意图标组件；不传使用默认文档图标 */
    icon?: Component;
  }>(),
  {
    title: "暂无数据",
    description: "",
    icon: undefined
  }
);
</script>

<template>
  <div class="app-empty">
    <div class="app-empty__head">
      <span class="app-empty__icon" aria-hidden="true">
        <component :is="icon || DocumentIcon" />
      </span>
      <p class="app-empty__title">{{ title }}</p>
    </div>
    <p v-if="description || $slots.description" class="app-empty__desc">
      <slot name="description">{{ description }}</slot>
    </p>
    <div v-if="$slots.default" class="app-empty__actions">
      <slot />
    </div>
  </div>
</template>

<style lang="scss" scoped>
/* 空状态是信息设计，不是装饰：
   图标与标题同行且只有 18px（不做"大图标 + 圆角底色"的模板化样式），
   重点放在"为什么空"和"下一步做什么"两句话上。 */
.app-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-10) var(--space-5);
  text-align: center;
}

.app-empty__head {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.app-empty__icon {
  display: flex;
  align-items: center;
  font-size: 18px;
  color: var(--ink-400);
}

.app-empty__title {
  margin: 0;
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  color: var(--ink-600);
}

.app-empty__desc {
  max-width: 42ch;
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--ink-500);
}

.app-empty__actions {
  margin-top: var(--space-4);
}
</style>
