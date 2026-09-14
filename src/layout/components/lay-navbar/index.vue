<script setup lang="ts">
import { useNav } from "@/layout/hooks/useNav";
import LaySearch from "../lay-search/index.vue";
import LayNotice from "../lay-notice/index.vue";
import LayNavMix from "../lay-sidebar/NavMix.vue";
import LaySidebarFullScreen from "../lay-sidebar/components/SidebarFullScreen.vue";
import LaySidebarBreadCrumb from "../lay-sidebar/components/SidebarBreadCrumb.vue";
import LaySidebarTopCollapse from "../lay-sidebar/components/SidebarTopCollapse.vue";

import LogoutCircleRLine from "~icons/ri/logout-circle-r-line";
import Setting from "~icons/ri/settings-3-line";
import AiIcon from "~icons/ep/magic-stick";

import { ref } from "vue";
import { getAiTicket } from "@/api/ai";
import { message } from "@/utils/message";

const {
  layout,
  device,
  logout,
  onPanel,
  pureApp,
  username,
  userAvatar,
  avatarsStyle,
  toggleSideBar
} = useNav();

const aiLoading = ref(false);

/**
 * 进入 AI 教学工作台：
 * 先向教务系统换取 60 秒一次性票据，再由工作台用票据换取自己的会话，
 * 教师无需二次登录。票据置于 URL hash，不会发往任何服务器。
 */
async function openAiWorkbench() {
  if (aiLoading.value) return;
  aiLoading.value = true;
  try {
    const res = await getAiTicket();
    if (!res?.success || !res?.data?.url) {
      message("获取免登票据失败，请稍后重试", { type: "error" });
      return;
    }
    window.open(res.data.url, "_blank", "noopener,noreferrer");
  } catch {
    message("无法连接 AI 教学工作台，请确认服务已启动", { type: "error" });
  } finally {
    aiLoading.value = false;
  }
}
</script>

<template>
  <div class="navbar bg-[#fff] shadow-xs shadow-[rgba(0,21,41,0.08)]">
    <LaySidebarTopCollapse
      v-if="device === 'mobile'"
      class="hamburger-container"
      :is-active="pureApp.sidebar.opened"
      @toggleClick="toggleSideBar"
    />

    <LaySidebarBreadCrumb
      v-if="layout !== 'mix' && device !== 'mobile'"
      class="breadcrumb-container"
    />

    <LayNavMix v-if="layout === 'mix'" />

    <div v-if="layout === 'vertical'" class="vertical-header-right">
      <!-- 菜单搜索 -->
      <LaySearch id="header-search" />
      <!-- 全屏 -->
      <LaySidebarFullScreen id="full-screen" />
      <!-- 消息通知 -->
      <LayNotice id="header-notice" />
      <!-- AI 教学助手（免登进入独立工作台） -->
      <span
        class="ai-entry navbar-bg-hover"
        :class="{ 'is-loading': aiLoading }"
        title="进入 AI 教学助手"
        @click="openAiWorkbench"
      >
        <IconifyIconOffline :icon="AiIcon" />
        <span class="ai-entry-text">AI 助手</span>
      </span>
      <!-- 退出登录 -->
      <el-dropdown trigger="click">
        <span class="el-dropdown-link navbar-bg-hover select-none">
          <img :src="userAvatar" :style="avatarsStyle" />
          <p v-if="username" class="dark:text-white">{{ username }}</p>
        </span>
        <template #dropdown>
          <el-dropdown-menu class="logout">
            <el-dropdown-item @click="logout">
              <IconifyIconOffline
                :icon="LogoutCircleRLine"
                style="margin: 5px"
              />
              退出系统
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      <span
        class="set-icon navbar-bg-hover"
        title="打开系统配置"
        @click="onPanel"
      >
        <IconifyIconOffline :icon="Setting" />
      </span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.navbar {
  width: 100%;
  height: 48px;
  overflow: hidden;

  .hamburger-container {
    float: left;
    height: 100%;
    line-height: 48px;
    cursor: pointer;
  }

  .vertical-header-right {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    min-width: 280px;
    height: 48px;
    color: #000000d9;

    .el-dropdown-link {
      display: flex;
      align-items: center;
      justify-content: space-around;
      height: 48px;
      padding: 10px;
      color: #000000d9;
      cursor: pointer;

      p {
        font-size: 14px;
      }

      img {
        width: 22px;
        height: 22px;
        border-radius: 50%;
      }
    }

    .ai-entry {
      display: flex;
      align-items: center;
      gap: 4px;
      height: 48px;
      padding: 0 10px;
      font-size: 13px;
      color: #2563eb;
      cursor: pointer;
      user-select: none;

      &.is-loading {
        cursor: wait;
        opacity: 0.6;
      }
    }
  }

  .breadcrumb-container {
    float: left;
    margin-left: 16px;
  }
}

.logout {
  width: 120px;

  ::v-deep(.el-dropdown-menu__item) {
    display: inline-flex;
    flex-wrap: wrap;
    min-width: 100%;
  }
}
</style>
