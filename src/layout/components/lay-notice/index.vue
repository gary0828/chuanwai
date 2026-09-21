<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { getNoticeList } from "@/api/attendance";
import NoticeList from "./components/NoticeList.vue";
import type { TabItem } from "./types";
import BellIcon from "~icons/ep/bell";

// ── 数据源：后端公告 /api/notices ──────────────────────────────────────
//
// ★ 2026-09-21 改造：此前读的是 `./data.ts` 里写死的模板演示数据（"小铭 评论了你"
//   "开发多租户管理"…，且含 3 个第三方图片外链），从未请求后端。现已改为真实数据，
//   演示数据文件已删除。设计决议见 `docs/ROADMAP.md`「五之二、通知铃铛 + 待办功能」。

/** 红点口径：最近 N 天新增的「已发布」公告数。
 *  走时间基准而非已读基准 —— 公告表没有 per-user 已读记录，
 *  走已读基准需新建 notice_reads 表 + 迁移，L1 刻意不做（见 ROADMAP 决策）。 */
const RECENT_DAYS = 7;
/** 铃铛里最多展示多少条 */
const MAX_ITEMS = 20;
/** 单次拉取条数（用于统计近 7 天数量；当前公告规模远小于此，不会低估） */
const FETCH_SIZE = 50;

const loading = ref(false);
const rows = ref<any[]>([]);

/** 后端 created_at 形如 `YYYY-MM-DD HH:mm:ss`（localtime）。
 *  直接 `new Date("2026-09-21 10:00:00")` 在部分内核下解析失败，故把 `-` 换 `/` 提兼容。 */
function toTimestamp(s: unknown): number {
  return new Date(String(s ?? "").replace(/-/g, "/")).getTime();
}

function isRecent(s: unknown): boolean {
  const t = toTimestamp(s);
  return Number.isFinite(t) && Date.now() - t <= RECENT_DAYS * 86400_000;
}

/** ★ 列表接口不按状态过滤（管理页需要看到「下架」的），铃铛只展示「已发布」。 */
const published = computed(() => rows.value.filter(r => r?.status === "发布"));

/** 红点数字 */
const noticesNum = computed(
  () => published.value.filter(r => isRecent(r.created_at)).length
);

function toListItem(r: any) {
  return {
    title: String(r?.title ?? ""),
    description: String(r?.content ?? ""),
    datetime: String(r?.created_at ?? "").slice(0, 10),
    type: "notice",
    ...(Number(r?.is_top) ? { extra: "置顶", status: "danger" as const } : {})
  };
}

const notices = computed<TabItem[]>(() => [
  {
    key: "notice",
    name: "通知",
    emptyText: loading.value ? "加载中…" : "暂无通知",
    list: published.value.slice(0, MAX_ITEMS).map(toListItem)
  }
]);

const activeKey = ref(notices.value[0].key);

async function load() {
  loading.value = true;
  try {
    const res: any = await getNoticeList({ page: 1, pageSize: FETCH_SIZE });
    rows.value = res?.success ? (res.data?.list ?? []) : [];
  } catch {
    // 拉取失败不阻塞导航栏：红点归零、下拉显示空态，不弹错误打扰用户
    rows.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function getLabel(item: TabItem) {
  return item.name + (item.list.length > 0 ? `(${item.list.length})` : "");
}
</script>

<template>
  <el-dropdown
    trigger="click"
    placement="bottom-end"
    @visible-change="visible => visible && load()"
  >
    <span
      :class="[
        'dropdown-badge',
        'navbar-bg-hover',
        'select-none',
        Number(noticesNum) !== 0 && 'mr-[10px]'
      ]"
    >
      <el-badge :value="Number(noticesNum) === 0 ? '' : noticesNum" :max="99">
        <span class="header-notice-icon">
          <IconifyIconOffline :icon="BellIcon" />
        </span>
      </el-badge>
    </span>
    <template #dropdown>
      <el-dropdown-menu>
        <el-tabs
          v-model="activeKey"
          :stretch="true"
          class="dropdown-tabs"
          style="width: 330px"
        >
          <el-tab-pane
            v-for="item in notices"
            :key="item.key"
            :label="getLabel(item)"
            :name="item.key"
          >
            <el-scrollbar max-height="330px">
              <div class="noticeList-container">
                <NoticeList :list="item.list" :emptyText="item.emptyText" />
              </div>
            </el-scrollbar>
          </el-tab-pane>
        </el-tabs>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<style lang="scss" scoped>
.dropdown-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 48px;
  cursor: pointer;

  .header-notice-icon {
    font-size: 18px;
  }
}

.dropdown-tabs {
  .noticeList-container {
    padding: 15px 24px 0;
  }

  :deep(.el-tabs__header) {
    margin: 0;
  }

  :deep(.el-tabs__nav-wrap)::after {
    height: 1px;
  }

  :deep(.el-tabs__nav-wrap) {
    padding: 0 36px;
  }
}
</style>
