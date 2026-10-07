<script setup lang="ts">
/**
 * 免登落地页：#/sso?ticket=xxx
 *
 * 流程：拿票据 → POST /api/ai/sso/verify → 存会话 → 跳回题目库。
 * ★ 失败必须**显式停在页面上**并给出可执行提示（K-050）——
 *   不能静默跳回首页，那会让用户以为「题库是空的」。
 */
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { saveSession, type CurrentUser } from "../session";

const router = useRouter();
const state = ref<"loading" | "ok" | "fail">("loading");
const message = ref("正在登录题库…");

onMounted(async () => {
  const ticket = new URLSearchParams(location.hash.split("?")[1] || "").get("ticket");
  if (!ticket) {
    state.value = "fail";
    message.value = "链接里没有登录票据。请从教务系统点「题库」入口重新进入。";
    return;
  }
  try {
    const res = await fetch("/api/ai/sso/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket, origin: location.origin })
    });
    const json = await res.json();
    if (!json.success) {
      state.value = "fail";
      message.value = json?.message || "票据无效或已过期，请返回教务系统重新进入";
      return;
    }
    const d = json.data;
    const user: CurrentUser = {
      id: d.id,
      name: d.name,
      role: d.role,
      loginAt: d.loginAt,
      qbToken: d.qbAgentToken
    };
    if (!user.qbToken) {
      state.value = "fail";
      message.value = "后端没有返回题库凭证（可能是版本不一致），请联系管理员。";
      return;
    }
    saveSession(user);
    state.value = "ok";
    ElMessage.success(`欢迎，${user.name}`);
    // 用 replace 而非 push：免登是一次性跳转，不该留在历史里
    router.replace("/");
  } catch (err) {
    state.value = "fail";
    message.value = err instanceof Error ? err.message : "登录失败，请返回教务系统重试";
  }
});
</script>

<template>
  <div class="qb-empty" style="padding-top: 90px">
    <template v-if="state === 'loading'">
      <el-icon class="is-loading" size="26"><Loading /></el-icon>
      <div class="qb-empty-title" style="margin-top: 12px">{{ message }}</div>
    </template>
    <template v-else-if="state === 'fail'">
      <el-icon size="30" color="#f56c6c"><WarningFilled /></el-icon>
      <div class="qb-empty-title" style="margin-top: 12px">无法进入题库</div>
      <div style="max-width: 420px; margin: 0 auto 16px">{{ message }}</div>
      <el-button type="primary" @click="() => (location.href = '/')">
        返回题库首页
      </el-button>
    </template>
  </div>
</template>