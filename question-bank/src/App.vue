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
import { computed, onMounted } from "vue";
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

onMounted(async () => {
  try {
    await loadSubjects();
  } catch (err) {
    // ★ 学科拉不到必须明确告知 —— 否则页面一直显示空数据，老师会以为题库丢了
    ElMessage.error(
      err instanceof Error ? err.message : "学科列表加载失败，请刷新页面重试"
    );
  }
});
</script>

<template>
  <div class="qb-layout">
    <aside class="qb-sidebar">
      <div class="qb-brand">
        智能题库
        <small>校区题目资产</small>
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
        @click="() => (location.href = crmUrl())"
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