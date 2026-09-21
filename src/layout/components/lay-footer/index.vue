<script setup lang="ts">
import { computed } from "vue";
import { useSiteStore } from "@/store/modules/site";

const site = useSiteStore();

const orgName = computed(() => site.orgName);
const years = computed(() => site.copyrightYears);
const icp = computed(() => site.icp);
const policeNo = computed(() => site.policeNo);
const contact = computed(() => site.contact);
const address = computed(() => site.address);
const extra = computed(() => site.copyrightExtra);
</script>

<template>
  <footer class="layout-footer">
    <div class="layout-footer__line">
      <span>Copyright © {{ years }}</span>
      <span v-if="orgName" class="layout-footer__org">{{ orgName }}</span>
      <template v-if="extra">
        <span class="layout-footer__sep">·</span>
        <span>{{ extra }}</span>
      </template>
    </div>
    <div
      v-if="icp || policeNo || contact || address"
      class="layout-footer__line layout-footer__line--sub"
    >
      <span v-if="contact">电话 {{ contact }}</span>
      <span v-if="address">{{ address }}</span>
      <span v-if="icp">ICP 备案号 {{ icp }}</span>
      <span v-if="policeNo">公安备案号 {{ policeNo }}</span>
    </div>
  </footer>
</template>

<style lang="scss" scoped>
.layout-footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  padding: 0 16px 8px;
  color: var(--ink-500);
  font-size: 13px;
  line-height: 1.6;
  text-align: center;
}

.layout-footer__line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.layout-footer__line--sub {
  font-size: 12px;
  color: var(--ink-400);
}

.layout-footer__org {
  font-weight: 500;
}

.layout-footer__sep {
  color: var(--ink-400);
}
</style>
