<script setup lang="ts">
defineOptions({
  name: "AppPageHeader"
});

defineProps({
  /** 页面标题 */
  title: {
    type: String,
    required: true
  },
  /**
   * 一句话说明这个页面解决什么问题。
   * 只写用户看不出来的信息；如果标题已经说清了，就不要传。
   */
  description: {
    type: String,
    default: ""
  }
});
</script>

<template>
  <header class="app-page-header">
    <div class="app-page-header__main">
      <div class="app-page-header__title-row">
        <h1 class="app-page-header__title">{{ title }}</h1>
        <!-- 统计口径、状态徽标等放在标题右侧，让"这页有多少东西"一眼可见 -->
        <slot name="meta" />
      </div>
      <p
        v-if="description || $slots.description"
        class="app-page-header__desc"
      >
        <slot name="description">{{ description }}</slot>
      </p>
    </div>

    <!-- 主操作区：整页最重要的一个动作放最右 -->
    <div v-if="$slots.default" class="app-page-header__actions">
      <slot />
    </div>
  </header>
</template>

<style lang="scss" scoped>
.app-page-header {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: var(--space-5);
}

.app-page-header__main {
  min-width: 0;
}

.app-page-header__title-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
}

.app-page-header__title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  line-height: var(--leading-tight);
  color: var(--ink-900);
  letter-spacing: -0.01em;
}

.app-page-header__desc {
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  color: var(--ink-500);
}

.app-page-header__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

/* 窄屏：操作区独占一行，避免与标题挤在一起 */
@media (width <= 640px) {
  .app-page-header__actions {
    width: 100%;
  }
}
</style>
