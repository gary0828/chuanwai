<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { apiBase, exchangeTicket } from "@/session";

const router = useRouter();
const status = ref<"pending" | "ok" | "fail">("pending");
const message = ref("正在校验免登票据…");

function readTicket(): string {
  const fromSearch = new URLSearchParams(location.search).get("ticket");
  if (fromSearch) return fromSearch;
  const hashQuery = location.hash.split("?")[1] || "";
  return new URLSearchParams(hashQuery).get("ticket") || "";
}

onMounted(async () => {
  const ticket = readTicket();
  if (!ticket) {
    status.value = "fail";
    message.value =
      "未收到免登票据。若你是直接打开本工作台，说明当前处于演示模式，服务端票据端点尚未接入。";
    return;
  }
  try {
    const user = await exchangeTicket(ticket);
    status.value = "ok";
    message.value = `已通过教务系统免登进入：${user.name}（${user.role === "admin" ? "教务/校长" : "教师"}）`;
    window.setTimeout(() => router.replace("/"), 900);
  } catch (err) {
    status.value = "fail";
    message.value = err instanceof Error ? err.message : "票据校验失败";
  }
});
</script>

<template>
  <div class="sso">
    <div class="box">
      <div class="mark">AI</div>
      <div class="title">AI 教学助手</div>
      <div class="status" :class="status">
        <span v-if="status === 'pending'" class="dot pending" />
        <span v-else-if="status === 'ok'" class="dot ok" />
        <span v-else class="dot fail" />
        {{ message }}
      </div>
      <div class="api">教务系统地址：{{ apiBase() }}</div>
      <div class="actions">
        <button class="btn" type="button" @click="router.replace('/')">
          直接进入工作台（演示模式）
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sso {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  background: var(--c-bg);
}

.box {
  width: 420px;
  padding: 32px 28px;
  text-align: center;
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
}

.mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin: 0 auto 12px;
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  background: var(--c-primary);
  border-radius: 11px;
}

.title {
  font-size: 16px;
  font-weight: 600;
}

.status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-top: 14px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--c-text-2);
}

.dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.dot.pending {
  background: var(--c-warn);
}

.dot.ok {
  background: var(--c-success);
}

.dot.fail {
  background: var(--c-danger);
}

.api {
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--c-text-3);
}

.actions {
  margin-top: 20px;
}

.btn {
  height: 32px;
  padding: 0 16px;
  font-family: inherit;
  font-size: 13px;
  color: var(--c-text-2);
  cursor: pointer;
  background: #fff;
  border: 1px solid var(--c-border-strong);
  border-radius: 8px;
}

.btn:hover {
  color: var(--c-primary-dark);
  border-color: var(--c-primary-line);
  background: var(--c-primary-soft);
}
</style>
