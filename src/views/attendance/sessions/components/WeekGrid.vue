<script setup lang="ts">
// 自绘 CSS Grid 周历（项目零日历组件 → 本项目第一个自绘网格）
//
// ★ 数据全部由父级一次取全后传入：days（周一→周日）/ periods（1–8）/ cells（按 `日期|节次` 索引）。
// ★ 不做任何请求；冲突判定在父级算好后随 cells 传入（同格 ≥2 张卡）。
// ★ 样式一律走 tokens（--brand-* / --status-* / --ink-*），禁止硬编码色值。
import EpWarning from "~icons/ep/warning";

defineOptions({
  name: "WeekGrid"
});

const props = defineProps<{
  /** 一周 7 天：[{ date, day_of_week, label, is_today }] */
  days: any[];
  /** 节次：[{ period, label, start_time, end_time }] */
  periods: any[];
  /** 单元格索引：{ [`${date}|${period}`]: session[] } */
  cells: Record<string, any[]>;
  /** 加载中 */
  loading?: boolean;
  /** 全校视角：卡片上加一行班级名，便于区分同格的多个班级 */
  showClass?: boolean;
  /** 是否标注冲突。全校视角下同格多课是常态 → 父级传 false 关闭（默认开启） */
  conflictMark?: boolean;
  /** 是否允许在格子上「＋」新增课次（仅 admin，由父级控制） */
  canAdd?: boolean;
}>();

const emit = defineEmits<{
  (e: "open", session: any): void;
  /** 在指定日期 + 节次新增课次（调休后补课等场景） */
  (e: "add", date: string, period: number): void;
}>();

/** 某格内的课次列表（空数组表示无课） */
function cellSessions(date: string, period: number): any[] {
  const key = `${date}|${period}`;
  return props.cells[key] || [];
}

/**
 * 同格 ≥2 张卡 = 冲突（前端计算）
 * ★ 2026-09-30：「全校视角」下同格有多个班的课是**正常现象**，父级传 conflictMark=false 关闭标注。
 */
function isConflict(date: string, period: number): boolean {
  if (props.conflictMark === false) return false;
  return cellSessions(date, period).length > 1;
}

/** 授课教师（代课时追加代课人） */
function teacherText(s: any): string {
  const base = s.teacher_name || "未指定教师";
  return s.substitute_teacher_name
    ? `${base} · 代课：${s.substitute_teacher_name}`
    : base;
}

/** 教室（★ v23：教室字典上线后显示**教室名**；此前误显示 room_id 数字） */
function roomText(s: any): string {
  return s.room_name || "未指定教室";
}

/** 状态 → el-tag 类型（§8：info/success/danger·灰/warning/info） */
function tagType(status: string): string {
  const map: Record<string, string> = {
    待上课: "info",
    已上课: "success",
    已停课: "danger",
    已挪课: "warning",
    已取消: "info"
  };
  return map[status] || "info";
}

/** 状态 → 卡片修饰类（含冲突覆盖） */
function cardClass(s: any, conflict: boolean): string {
  if (conflict) return "sc--conflict";
  if (s.status === "已停课") return "sc--stopped";
  if (s.status === "已挪课") return "sc--rescheduled";
  if (s.status === "已上课") return "sc--done";
  return "sc--upcoming";
}

/** MM/DD 短日期（角标用） */
function mmdd(date: string): string {
  return date ? date.slice(5).replace("-", "/") : "";
}
</script>

<template>
  <div class="week-grid" :class="{ 'is-loading': loading }">
    <!-- 表头行（display:contents 让子项直接落进网格轨道） -->
    <div class="wg-row wg-row--head">
      <div class="wg-corner">时间</div>
      <div
        v-for="day in days"
        :key="day.date"
        class="wg-day"
        :class="{ 'wg-day--today': day.is_today }"
      >
        <span class="wg-day__label">{{ day.label }}</span>
        <span class="wg-day__date">{{ mmdd(day.date) }}</span>
      </div>
    </div>

    <!-- 节次行 -->
    <div v-for="p in periods" :key="p.period" class="wg-row">
      <div class="wg-time">
        <span class="wg-time__label">{{ p.label }}</span>
        <span class="wg-time__range">
          {{
            p.start_time && p.end_time
              ? `${p.start_time}-${p.end_time}`
              : "未设置"
          }}
        </span>
      </div>
      <div
        v-for="day in days"
        :key="`${day.date}|${p.period}`"
        class="wg-cell"
        :class="{ 'wg-cell--today': day.is_today, 'wg-cell--addable': canAdd }"
      >
        <!-- ★ 2026-09-30 校区反馈②：格子上「＋」新增课次（日期 + 节次自动带入），
             用于「调休后补课加到某一天」；空格显示居中大按钮、有课显示右上角小按钮 -->
        <button
          v-if="canAdd"
          type="button"
          class="wg-cell__add"
          :class="
            cellSessions(day.date, p.period).length ? 'is-filled' : 'is-empty'
          "
          :title="`在 ${day.label} ${mmdd(day.date)} ${p.label} 添加课次`"
          @click.stop="emit('add', day.date, p.period)"
        >
          ＋
        </button>

        <div
          v-for="s in cellSessions(day.date, p.period)"
          :key="s.id"
          class="sc"
          :class="cardClass(s, isConflict(day.date, p.period))"
          @click="emit('open', s)"
        >
          <div class="sc__top">
            <span class="sc__course">{{ s.course_name || "未命名课程" }}</span>
            <el-icon
              v-if="isConflict(day.date, p.period)"
              class="sc__warn"
              :title="'同格存在多节课次，可能冲突'"
            >
              <EpWarning />
            </el-icon>
          </div>
          <!-- ★ 全校视角：显示班级名（同一格里有多个班时用于区分） -->
          <div v-if="showClass" class="sc__meta sc__class">
            {{ s.class_name || "未知班级" }}
          </div>
          <div class="sc__meta">{{ teacherText(s) }}</div>
          <div class="sc__meta">{{ roomText(s) }}</div>
          <div class="sc__foot">
            <span class="sc__time">
              {{
                s.start_time && s.end_time
                  ? `${s.start_time}-${s.end_time}`
                  : ""
              }}
            </span>
            <el-tag
              size="small"
              :type="tagType(s.status) as any"
              effect="light"
            >
              {{ s.status }}
            </el-tag>
          </div>
          <div v-if="s.status === '已挪课' && s.related_date" class="sc__badge">
            → {{ mmdd(s.related_date) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.week-grid {
  display: grid;
  grid-template-columns: 92px repeat(7, minmax(0, 1fr));
  overflow: hidden;
  background: var(--surface-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  transition: opacity var(--duration-base) var(--ease-out);
}

.week-grid.is-loading {
  opacity: 0.6;
}

/* display:contents 让行容器的子项直接进入网格轨道 */
.wg-row {
  display: contents;
}

/* ── 表头 ─────────────────────────────────────────────── */
.wg-corner,
.wg-day {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-default);
  background: var(--surface-sunken);
}

.wg-corner {
  font-size: var(--text-xs);
  color: var(--ink-500);
  text-align: center;
  border-right: 1px solid var(--border-default);
}

.wg-day {
  display: flex;
  gap: var(--space-1);
  align-items: baseline;
  justify-content: center;
  border-right: 1px solid var(--ink-100);
}

.wg-day__label {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  color: var(--ink-700);
}

.wg-day__date {
  font-size: var(--text-xs);
  color: var(--ink-400);
}

.wg-day--today {
  background: var(--brand-100);

  .wg-day__label {
    color: var(--brand-700);
  }
}

/* ── 时间轴列 ─────────────────────────────────────────── */
.wg-time {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-2) var(--space-3);
  border-right: 1px solid var(--border-default);
  border-bottom: 1px solid var(--ink-100);
}

.wg-time__label {
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--ink-600);
}

.wg-time__range {
  font-size: 11px;
  color: var(--ink-400);
}

/* ── 网格单元格 ───────────────────────────────────────── */
.wg-cell {
  position: relative; /* 「＋」新增课次按钮的定位基准 */
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-height: 64px;
  padding: var(--space-2);
  border-right: 1px solid var(--ink-100);
  border-bottom: 1px solid var(--ink-100);
  background: var(--surface-card);
}

.wg-cell--today {
  background: var(--brand-50);
}

/* ── 「＋」新增课次（★ 2026-09-30 校区反馈②） ─────────────
   空格 → 居中大按钮（「调休后补课加到某天」的主要入口，一眼可见）
   有课 → 右上角小按钮（不遮挡卡片信息）
   仅格子 hover 时出现，避免满屏按钮干扰阅读 */
.wg-cell__add {
  position: absolute;
  z-index: 2;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 14px;
  line-height: 1;
  color: var(--brand-600);
  cursor: pointer;
  background: var(--surface-card);
  border: 1px dashed var(--brand-400);
  border-radius: var(--radius-sm);
  transition:
    background var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);

  &:hover {
    background: var(--brand-50);
    border-color: var(--brand-600);
    border-style: solid;
  }

  &.is-empty {
    inset: 0;
    margin: auto;
    width: 28px;
    height: 28px;
    font-size: 16px;
  }

  &.is-filled {
    top: var(--space-1);
    right: var(--space-1);
    width: 18px;
    height: 18px;
    opacity: 0.75;
  }
}

.wg-cell--addable:hover .wg-cell__add {
  display: flex;
}

/* ── 课次卡片 ─────────────────────────────────────────── */
.sc {
  position: relative;
  padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
  cursor: pointer;
  background: var(--surface-card);
  border: 1px solid var(--border-default);
  border-left-width: 3px;
  border-radius: var(--radius-sm);
  transition:
    border-color var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out);

  &:hover {
    box-shadow: var(--shadow-xs);
  }
}

.sc__top {
  display: flex;
  gap: var(--space-1);
  align-items: center;
  justify-content: space-between;
}

.sc__course {
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  line-height: var(--leading-tight);
  color: var(--ink-800);
}

.sc__warn {
  flex: none;
  font-size: 14px;
  color: var(--status-danger);
}

.sc__meta {
  margin-top: 2px;
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
  color: var(--ink-500);
}

/* ★ 全校视角：卡片上的班级名 —— 同一格里有多个班时用于区分 */
.sc__class {
  font-weight: var(--weight-medium);
  color: var(--brand-700);
}

.sc__foot {
  display: flex;
  flex-wrap: wrap; /* ★ 格子偏窄时允许换行，不硬挤 */
  gap: var(--space-1);
  align-items: center;
  justify-content: space-between;
  margin-top: var(--space-1);
}

.sc__time {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--ink-400);
  /* ★ 2026-09-30：「08:00-08:45」不允许折成两行 ——
     全校视角给卡片加了一行班级名后格子更挤，实测出现过时间被拆行 */
  white-space: nowrap;
}

.sc__badge {
  position: absolute;
  top: -6px;
  right: -6px;
  padding: 0 4px;
  font-size: 10px;
  color: var(--on-brand);
  background: var(--status-warning);
  border-radius: var(--radius-pill);
}

/* 待上课：品牌色左边框 + 浅品牌底 */
.sc--upcoming {
  background: var(--brand-50);
  border-left-color: var(--brand-600);
}

/* 已上课：绿点 */
.sc--done {
  border-left-color: var(--status-success);

  &::after {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 6px;
    height: 6px;
    content: "";
    background: var(--status-success);
    border-radius: 50%;
  }
}

/* 已停课：灰底 + 删除线 */
.sc--stopped {
  background: var(--surface-sunken);
  border-left-color: var(--ink-300);

  .sc__course {
    color: var(--ink-400);
    text-decoration: line-through;
  }

  .sc__meta,
  .sc__time {
    color: var(--ink-300);
  }
}

/* 已挪课：虚线边框 + warning 左边框 */
.sc--rescheduled {
  background: var(--surface-card);
  border-style: dashed;
  border-left-style: solid;
  border-left-color: var(--status-warning);
}

/* 冲突：红左边框 + 红描边 */
.sc--conflict {
  background: var(--surface-card);
  border-left-color: var(--status-danger);
  box-shadow: inset 0 0 0 1px var(--status-danger);
}
</style>
