<script setup lang="ts">
/**
 * 题库外壳：学科切换器 + 左侧导航 + 顶栏 + 内容区
 *
 * 与工作台的差异：题库**只有内容页**，没有「知识库」那种多标签页签体系，
 * 所以顶栏更薄（只显示当前页标题 + 用户 + 返回教务系统）。
 *
 * ★ 学科切换器的位置：侧栏**顶部**（导航之上）——
 *   它是**比页面更高一层**的上下文：切了学科，题目库/三视角/统计/回收站
 *   全部跟着变。放在筛选工具栏里会让人误以为只是"筛选条件之一"。
 *
 * ★★ 切换学科如何让页面刷新：给 `<router-view>` 加 `:key="currentSubjectId"`。
 *   学科一变 → key 变 → Vue **重建当前页面组件** → 触发 onMounted 重新拉数据。
 *   这样每个页面**不需要各自监听学科变化**，少写 6 处 watch，
 *   也就不会出现"某个页面忘了监听"的不一致（这正是横向同类问题的典型形态）。
 */
import { computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { NAV_ITEMS } from "./router";
import { currentUser, crmUrl, isRealUser } from "./session";
import { currentSubjectId, loadSubjects, setSubject, subjectList } from "./subject";

const route = useRoute();
const router = useRouter();

const currentTitle = computed(
  () => (route.meta?.title as string) || "题目库"
);
const user = computed(() => currentUser());

/** 切换器绑定值（用 string 便于 el-select） */
const selected = computed({
  get: () => (currentSubjectId.value > 0 ? String(currentSubjectId.value) : ""),
  set: (v: string) => setSubject(Number(v))
});

function go(path: string) {
  if (path !== route.path) router.push(path);
}

/**
 * 返回教务系统。
 *
 * ★★ 2026-10-09 修 bug：这里原来写成 `@click="() => (location.href = crmUrl())"`，
 *   即 `location` 直接写在**模板**里 —— 点击**毫无反应**。
 *   根因：`<script setup>` 的模板编译会给未绑定标识符加 `_ctx.` 前缀，
 *   而 `location` **不在** Vue 的全局白名单里（白名单只有 Math/Date/JSON/console 之类）
 *   ⇒ 编译成 `_ctx.location` = undefined ⇒ `undefined.href = ...` 抛 TypeError 并被吞掉。
 *   （K-050「静默即缺陷」：用户点了没反应，还看不到任何错误。）
 *   ⇒ 结论：**`window` / `location` / `document` 这类宿主对象只能出现在 script 里**。
 *   对照：工作台 `ai-workbench/src/App.vue` 一直写的 `window.location.href`（在 script 中）是正确的。
 */
function goCrm() {
  window.location.href = crmUrl();
}

/**
 * 拉学科清单（**可能会跑两次**：首次挂载 + 会话建立后，第二次才是真正有效的）。
 *
 * ★★ 2026-10-09 修 bug：`loadSubjects()` 原本只在 onMounted 跑一次，而它和
 *   `Sso.vue` 的 `await verify()` 是**并发**的（Vue 子组件 onMounted 先于父组件，
 *   且 verify 是异步的）→ 抢在验票之前发出 → 401 → `subjectList` 永久为空
 *   → 切换器 `:disabled` → **学科下拉框点不动**；且 `currentSubjectId` 停在 0
 *   → 列表请求不带 `course_id` → **把所有学科的题混在一起显示**。
 *   验票成功后只 `router.replace("/")`，App 不会重新挂载，没人补这一次请求。
 *   ⇒ 所以下面用 `watch(isRealUser)` 兜住：**会话一出现就补拉**，
 *     不论会话是由免登链路、还是由任何其它路径建立的。
 *
 * ★ 为什么"没会话时的 401"不弹提示：那是免登链路的**正常中间态**（票据正在验），
 *   弹「未登录或登录已过期」是**假警报**——老师马上就要进去了。
 *   真正无会话的情况（直接敲 /qb/）由侧栏的常驻提示条说明，也不需要飘一条 toast。
 *   只有"本来有会话却失败"才是真故障，必须明确提示（K-050）。
 */
async function ensureSubjects() {
  const hadSession = isRealUser.value;
  try {
    await loadSubjects();
  } catch (err) {
    if (hadSession) {
      ElMessage.error(
        err instanceof Error ? err.message : "学科列表加载失败，请刷新页面重试"
      );
    }
  }
}

// 会话到位 → 立刻补拉学科（见 ensureSubjects 的注释）
watch(isRealUser, (real) => {
  if (real) void ensureSubjects();
});

onMounted(() => {
  void ensureSubjects();
});
</script>

<template>
  <div class="qb-layout">
    <aside class="qb-sidebar">
      <div class="qb-brand">
        智能题库
        <small>校区题目资产</small>
      </div>

      <!--
        ★★ 常驻提示条（2026-10-09 新增）：没有教务系统会话时**必须**在侧栏一直显示。
        原因：此前这种情况只靠一条飘过的 toast，而学科切换器又是**静默禁用**的
        —— 老师看到的结果是「下拉框点不动、什么提示都没有」，只能猜。
        （K-050 静默即缺陷；用户实测反馈①就是这么来的。）

        ★ 排除 /sso：**免登落地页"还没有会话"是正常中间态**（票据正在验），
          此时提示「未从教务系统进入」是**错报**，会闪一下再消失。
          真的验票失败时，那页自己有明确提示 + 自己的「返回教务系统」按钮。
      -->
      <div v-if="!isRealUser && route.path !== '/sso'" class="qb-session-warn">
        <div class="qb-session-warn-title">未从教务系统进入</div>
        <div class="qb-session-warn-desc">
          当前为只读浏览：录题、改题、导入都不可用。请从教务系统点「题库」入口重新进入。
        </div>
        <el-button size="small" type="warning" style="width: 100%" @click="goCrm">
          返回教务系统
        </el-button>
      </div>

      <!-- ★ 学科切换器：比页面更高一层的上下文（切了它，所有页面都跟着变） -->
      <div class="qb-subject-picker">
        <label class="qb-subject-label">当前学科</label>
        <el-select
          v-model="selected"
          placeholder="选择学科"
          size="small"
          style="width: 100%"
          :disabled="subjectList.length === 0"
        >
          <el-option
            v-for="s in subjectList"
            :key="s.id"
            :label="s.questionCount > 0 ? `${s.name}（${s.questionCount}）` : s.name"
            :value="String(s.id)"
          />
        </el-select>
      </div>

      <div class="qb-nav-group">功能</div>
      <div
        v-for="item in NAV_ITEMS"
        :key="item.path"
        class="qb-nav-item"
        :class="{ active: route.path === item.path }"
        :title="item.desc"
        @click="go(item.path)"
      >
        <span>{{ item.title }}</span>
      </div>

      <div style="flex: 1"></div>

      <div
        class="qb-nav-item"
        title="返回教务系统"
        @click="goCrm"
      >
        <span>← 返回教务系统</span>
      </div>
    </aside>

    <div class="qb-main">
      <header class="qb-header">
        <h1>{{ currentTitle }}</h1>
        <div class="qb-user">
          <el-tag v-if="!isRealUser" type="warning" size="small" effect="plain">
            只读浏览模式
          </el-tag>
          <span>{{ user.name }}</span>
          <el-tag size="small" effect="plain">
            {{ user.role === "admin" ? "管理员" : "教师" }}
          </el-tag>
        </div>
      </header>

      <main class="qb-content">
        <!-- ★ key 绑定学科 id：切学科自动重建页面（见文件头注释） -->
        <router-view v-slot="{ Component }">
          <component :is="Component" :key="currentSubjectId" />
        </router-view>
      </main>
    </div>
  </div>
</template>