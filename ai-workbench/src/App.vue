<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import IconBoard from "~icons/ep/data-board";
import IconChat from "~icons/ep/chat-dot-round";
import IconCheck from "~icons/ep/circle-check";
import IconClock from "~icons/ep/clock";
import IconCollection from "~icons/ep/collection";
import IconEdit from "~icons/ep/edit-pen";
import IconFiles from "~icons/ep/files";
import IconSetting from "~icons/ep/setting";
import IconTickets from "~icons/ep/tickets";
import IconTrend from "~icons/ep/trend-charts";
import { loadConfig } from "@/ai/provider";
import { NAV_GROUPS } from "@/router";
import { crmUrl, currentUser } from "@/session";
import {
  course,
  dataVersion,
  demoFallbackModules,
  initDataSource,
  klass,
  realClasses,
  realError,
  realLoading,
  setSourceMode,
  sourceMode,
  switchClass,
  unit
} from "@/workbench-data";

const route = useRoute();
const router = useRouter();

onMounted(() => {
  initDataSource();
});

function changeSource(mode: string) {
  setSourceMode(mode === "real" ? "real" : "demo");
}

function changeClass(id: number) {
  void switchClass(id);
}

const ICONS: Record<string, unknown> = {
  "/": IconBoard,
  "/course": IconFiles,
  "/lesson": IconEdit,
  "/teaching": IconClock,
  "/homework": IconTickets,
  "/evaluation": IconCheck,
  "/report": IconTrend,
  "/parent": IconChat,
  "/knowledge": IconCollection,
  "/settings": IconSetting
};

const isSso = computed(() => route.path === "/sso");
const user = ref(currentUser());
const cfg = ref(loadConfig());

// 免登换会话发生在 /sso 页面，回到工作台后必须重新读取身份，
// 否则侧边栏仍显示「演示身份」而不是「已免登接入」
watch(
  () => route.path,
  () => {
    user.value = currentUser();
  }
);

const providerLabel = computed(() =>
  cfg.value.mode === "dify" ? "Dify 工作流" : "规则引擎（未启用模型）"
);

const activePath = computed(() => route.path);

function backToCrm() {
  window.location.href = crmUrl();
}
</script>

<template>
  <router-view v-if="isSso" />

  <div v-else class="layout">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">AI</div>
        <div class="brand-text">
          <div class="brand-name">AI 教学助手</div>
          <div class="brand-sub">教师工作台 · 原型</div>
        </div>
      </div>

      <nav class="nav">
        <template v-for="group in NAV_GROUPS" :key="group.group">
          <div class="nav-group">{{ group.group }}</div>
          <button
            v-for="item in group.items"
            :key="item.path"
            class="nav-item"
            :class="{ active: activePath === item.path }"
            type="button"
            @click="router.push(item.path)"
          >
            <span class="nav-icon">
              <component :is="ICONS[item.path]" />
            </span>
            <span class="nav-text">
              <span class="nav-title">{{ item.title }}</span>
              <span class="nav-desc">{{ item.desc }}</span>
            </span>
          </button>
        </template>
      </nav>

      <div class="side-foot">
        <div class="foot-user">
          <div class="avatar">{{ user.name.slice(0, 1) }}</div>
          <div class="foot-info">
            <div class="foot-name">{{ user.name }}</div>
            <div class="foot-role">{{ user.role === "admin" ? "教务/校长" : "教师" }} · {{ user.source === "sso" ? "已免登接入" : "演示身份" }}</div>
          </div>
        </div>
        <div class="foot-provider">
          底座：{{ providerLabel }}
        </div>
      </div>
    </aside>

    <div class="body">
      <header class="topbar">
        <div class="top-left">
          <div class="top-title">
            {{ String(route.meta.title || "教师工作台") }}
          </div>
          <div class="top-sub">
            {{ course.name }} · {{ klass.name }} · {{ klass.studentCount }} 人
            <span class="dot">·</span>
            {{ unit.no }}{{ unit.name }} 第 {{ unit.doneHours }}/{{ unit.totalHours }} 课时
          </div>
        </div>
        <div class="top-right">
          <el-select
            :model-value="sourceMode"
            size="small"
            style="width: 128px"
            @update:model-value="changeSource"
          >
            <el-option label="演示数据" value="demo" />
            <el-option label="真实教务数据" value="real" />
          </el-select>
          <el-select
            v-if="sourceMode === 'real' && realClasses.length"
            :model-value="klass.id"
            size="small"
            style="width: 168px"
            @update:model-value="changeClass"
          >
            <el-option
              v-for="c in realClasses"
              :key="c.id"
              :label="`${c.name}（${c.student_count}）`"
              :value="c.id"
            />
          </el-select>
          <span v-if="realLoading" class="top-hint">读取中…</span>
          <button class="ghost-btn" type="button" @click="router.push('/settings')">
            底座设置
          </button>
          <button class="ghost-btn" type="button" @click="backToCrm">返回教务系统</button>
        </div>
      </header>

      <div class="demo-banner" :class="{ real: sourceMode === 'real' }">
        <template v-if="sourceMode === 'demo'">
          当前为演示数据：学员、成绩、作业等均为虚构内容；所有数值由本地指标引擎计算，AI 仅负责文字表述。
        </template>
        <template v-else-if="realError">
          读取真实数据失败（{{ realError }}），已回落演示数据；请确认教务系统后端可访问。
        </template>
        <template v-else>
          当前为真实教务数据（{{ dataVersion || "版本未知" }}）：学员名单、考勤、成绩、课时来自教务系统只读接口，不含金额。
          <span v-if="demoFallbackModules.length" class="banner-more">
            以下内容真实库尚未启用，仍展示演示内容：{{ demoFallbackModules.join("、") }}。
          </span>
        </template>
      </div>

      <main class="content">
        <router-view v-slot="{ Component }">
          <component :is="Component" />
        </router-view>
      </main>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  height: 100%;
  overflow: hidden;
}

/* 侧边栏 */
.sidebar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 236px;
  background: #fff;
  border-right: 1px solid var(--c-border);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 16px 14px;
  border-bottom: 1px solid var(--c-border);
}

.brand-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: var(--c-primary);
  border-radius: 9px;
}

.brand-name {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
}

.brand-sub {
  font-size: 11px;
  color: var(--c-text-3);
  line-height: 1.5;
}

.nav {
  flex: 1;
  padding: 10px 10px 16px;
  overflow-y: auto;
}

.nav-group {
  padding: 12px 8px 6px;
  font-size: 11px;
  font-weight: 500;
  color: var(--c-text-3);
  letter-spacing: 0.4px;
}

.nav-item {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  width: 100%;
  padding: 8px 10px;
  margin-bottom: 2px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 8px;
  transition: background 0.15s;
}

.nav-item:hover {
  background: #f4f6f9;
}

.nav-item.active {
  background: var(--c-primary-soft);
}

.nav-icon {
  display: flex;
  flex-shrink: 0;
  margin-top: 2px;
  font-size: 15px;
  color: var(--c-text-3);
}

.nav-item.active .nav-icon {
  color: var(--c-primary);
}

.nav-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.nav-title {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  color: var(--c-text);
}

.nav-item.active .nav-title {
  color: var(--c-primary-dark);
}

.nav-desc {
  overflow: hidden;
  font-size: 11px;
  line-height: 1.5;
  color: var(--c-text-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.side-foot {
  padding: 12px;
  border-top: 1px solid var(--c-border);
}

.foot-user {
  display: flex;
  align-items: center;
  gap: 9px;
}

.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  font-size: 13px;
  font-weight: 500;
  color: var(--c-primary-dark);
  background: var(--c-primary-soft);
  border-radius: 8px;
}

.foot-name {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
}

.foot-role {
  font-size: 11px;
  color: var(--c-text-3);
}

.foot-provider {
  margin-top: 8px;
  padding: 6px 8px;
  font-size: 11px;
  color: var(--c-text-2);
  background: #f6f8fa;
  border-radius: 6px;
}

/* 主区域 */
.body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 22px;
  background: #fff;
  border-bottom: 1px solid var(--c-border);
}

.top-title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
}

.top-sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--c-text-3);
}

.dot {
  margin: 0 5px;
}

.top-right {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
}

.ghost-btn {
  height: 28px;
  padding: 0 12px;
  font-family: inherit;
  font-size: 12px;
  color: var(--c-text-2);
  cursor: pointer;
  background: #fff;
  border: 1px solid var(--c-border-strong);
  border-radius: 7px;
  transition: all 0.15s;
}

.ghost-btn:hover {
  color: var(--c-primary-dark);
  border-color: var(--c-primary-line);
  background: var(--c-primary-soft);
}

.demo-banner {
  padding: 7px 22px;
  font-size: 12px;
  color: #b45309;
  background: var(--c-warn-soft);
  border-bottom: 1px solid #fde9c8;
}

.demo-banner.real {
  color: #15803d;
  background: var(--c-success-soft);
  border-bottom-color: #bbf7d0;
}

.banner-more {
  color: var(--c-text-2);
}

.top-hint {
  font-size: 12px;
  color: var(--c-text-3);
}

.content {
  flex: 1;
  padding: 18px 22px 32px;
  overflow-y: auto;
}

@media print {
  .sidebar,
  .topbar,
  .demo-banner {
    display: none !important;
  }

  .layout,
  .body,
  .content {
    display: block;
    height: auto;
    padding: 0;
    overflow: visible;
  }
}
</style>
