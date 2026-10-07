<script setup lang="ts">
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  watch,
  nextTick
} from "vue";
import * as echarts from "echarts/core";
import { PieChart, BarChart, LineChart, FunnelChart } from "echarts/charts";
import {
  GridComponent,
  TitleComponent,
  LegendComponent,
  TooltipComponent
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { AppEmpty } from "@/components/AppEmpty";
// ep/data-line 是项目内已验证可用的图标名（ep/data-bar 不存在，会导致构建失败）
import DataLineIcon from "~icons/ep/data-line";

echarts.use([
  PieChart,
  BarChart,
  LineChart,
  FunnelChart,
  GridComponent,
  TitleComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer
]);

/**
 * 图表卡片（2026-10-03 新增）
 *
 * 为什么不用 @pureadmin/utils 的 useECharts：
 *   它在 setOptions 里有 `if (el.offsetHeight === 0) {延时重试一次; return}` 守卫，
 *   且 init 时同步读取传入的 ref/选择器 —— 在"数据异步到达 + 容器初始无内容"的情况下
 *   会**静默不绘制**（实测：接口返回正常、容器高度 340px，但页面上一个 canvas 都没有，
 *   控制台也无任何报错）。首页/ 考勤统计页能用是因为它们的数据在首屏同步就位。
 *   本组件改为自持实例，init 时机与重绘时机完全由自己控制。
 *
 * 统一收口三件事：
 *   1. 实例生命周期（init / setOption / resize / dispose）
 *   2. 明暗主题切换后重绘（canvas 读不到 CSS 变量，只能按新色值重新 setOption）
 *   3. 空态（K-050 静默即缺陷：无数据必须给出明确说明，不能画一张空坐标系）
 */
defineOptions({
  name: "AppChartCard"
});

const props = withDefaults(
  defineProps<{
    title?: string;
    /** ECharts 配置项；null/undefined 表示无数据 → 走空态 */
    options?: any;
    height?: string;
    emptyTitle?: string;
    emptyDescription?: string;
    /** 图表下方附注（口径说明等） */
    footnote?: string;
  }>(),
  {
    title: "",
    options: undefined,
    height: "clamp(280px, 36vh, 340px)",
    emptyTitle: "暂无数据",
    emptyDescription: "",
    footnote: ""
  }
);

/** ECharts 在 canvas 上绘制，读不到 CSS 变量，必须取计算后的实际色值 */
function token(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/** 把配置里 "var(--chart-xxx)" 的字符串替换为当前主题的真实色值（递归） */
function resolveThemeColors(value: any): any {
  if (typeof value === "string") {
    const m = value.match(/^var\((--[\w-]+)\)$/);
    return m ? token(m[1]) || value : value;
  }
  if (Array.isArray(value)) return value.map(resolveThemeColors);
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      out[key] = resolveThemeColors(value[key]);
    }
    return out;
  }
  return value;
}

const boxRef = ref<HTMLDivElement | null>(null);

/** ECharts 实例刻意用普通变量而非 ref：
 *  实例不需要参与视图更新，放进响应式反而会被深度代理（大数据量图表会明显变慢） */
let chart: echarts.ECharts | null = null;
const hasData = ref(false);

/** 容器始终保留高度（用 visibility 隐去而非 display:none，
 *  一旦高度为 0，ECharts 会画出 0×0 的空白画布）
 *  ★ 这里返回字符串而非对象：vue-tsc 对 `<div ref="x" :style="{...}"/>` 自闭合标签
 *    会误报 TS2345（把 ref 当成普通属性），改用 style 字符串即可绕开（与项目既有
 *    `src/views/attendance/statistics/index.vue:475` 的写法一致）。 */
const boxStyle = computed(
  () =>
    `height: ${props.height}; visibility: ${hasData.value ? "visible" : "hidden"};`
);

/** 容器真正拿到尺寸后才 init + 绘制。
 *  必须等尺寸：ECharts 对 0×0 容器会画出空白画布。
 *  用 ResizeObserver 而非只靠 nextTick —— Element Plus 的 tab-pane 切换带过渡动画，
 *  nextTick 时容器仍是 display:none（offsetHeight=0），实测整页图表不渲染。 */
function tryDraw() {
  const el = boxRef.value;
  if (!el || !el.offsetHeight) return false;
  if (!chart || chart.isDisposed()) {
    chart = echarts.init(el);
  }
  chart.setOption(resolveThemeColors(props.options), true);
  chart.resize();
  hasData.value = true;
  return true;
}

function draw() {
  if (!props.options) {
    hasData.value = false;
    return;
  }
  nextTick(() => tryDraw());
}

let themeObserver: MutationObserver | null = null;
let ro: ResizeObserver | null = null;

onMounted(() => {
  draw();

  // 主题切换后按新色值重绘（canvas 无法自动跟随 CSS 变量）
  themeObserver = new MutationObserver(() => {
    if (hasData.value) draw();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"]
  });

  // 容器从 0 高度变为有高度（页签激活、侧栏展开、窗口缩放）时补画
  if (boxRef.value) {
    ro = new ResizeObserver(() => {
      if (props.options && !hasData.value) tryDraw();
      else chart?.resize();
    });
    ro.observe(boxRef.value);
  }
});

onBeforeUnmount(() => {
  themeObserver?.disconnect();
  themeObserver = null;
  ro?.disconnect();
  ro = null;
  chart?.dispose();
  chart = null;
});

// 数据变化（含异步到达）→ 重绘
watch(() => props.options, draw, { deep: true });
</script>

<template>
  <section class="page-card app-chart-card">
    <header v-if="title" class="card-head">{{ title }}</header>

    <!-- 画布容器始终保留高度，见 boxStyle 上方说明 -->
    <div ref="boxRef" class="app-chart-card__box" :style="boxStyle" />

    <!-- 空态覆盖在画布之上（画布仍占位以保证尺寸） -->
    <AppEmpty
      v-if="!hasData"
      class="app-chart-card__empty"
      :title="emptyTitle"
      :description="emptyDescription"
      :icon="DataLineIcon"
    />

    <p v-if="footnote" class="app-chart-card__note">{{ footnote }}</p>
  </section>
</template>

<style lang="scss" scoped>
.app-chart-card {
  position: relative;
  display: flex;
  flex-direction: column;
}

.app-chart-card__box {
  width: 100%;
}

/* 空态覆盖层：贴在画布同一位置，不额外占高度 */
.app-chart-card__empty {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-card);
}

.app-chart-card__note {
  margin: var(--space-3) 0 0;
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
  color: var(--ink-400);
}
</style>