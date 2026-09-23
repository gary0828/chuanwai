<script setup lang="ts">
/**
 * 轻量折线图（纯 SVG，不引图表库）
 *
 * 为什么不用 ECharts：工作台是独立部署的静态应用，成长曲线的诉求非常单一
 * （几条序列、固定量程、看趋势），引一个 300KB 的图表库不划算。
 * 用 SVG 手绘还能完全复用全站 token，配色与教务系统一致。
 *
 * 量程按 series 的 domain 自适应；y=null 表示该点无数据（断线，不画成 0）。
 */
import { computed } from "vue";

export interface LineSeries {
  name: string;
  color: string;
  points: { x: string; y: number | null }[];
}

const props = withDefaults(
  defineProps<{
    series: LineSeries[];
    height?: number;
    min?: number;
    max?: number;
    showArea?: boolean;
    /**
     * 纵轴是否贴合数据实际区间。
     *
     * 为什么需要（实测发现）：1-5 分的课堂评价，真实取值集中在 3~5，
     * 固定 1-5 量程会把差异压成一条几乎水平的线，"成长"看不出来。
     * 开启后按数据范围缩放，并保证至少 minSpan 的跨度 ——
     * 否则两次课 4.0 → 4.1 会被放大成剧烈起伏，那是另一种失真。
     */
    fitData?: boolean;
    minSpan?: number;
  }>(),
  { height: 160, min: 0, max: 5, showArea: false, fitData: false, minSpan: 1.5 }
);

/** 实际参与计算的量程 */
const domain = computed(() => {
  if (!props.fitData) return { min: props.min, max: props.max };
  const vals: number[] = [];
  for (const s of props.series) {
    for (const p of s.points) {
      if (p.y !== null && Number.isFinite(p.y)) vals.push(p.y);
    }
  }
  if (!vals.length) return { min: props.min, max: props.max };

  let lo = Math.min(...vals);
  let hi = Math.max(...vals);

  // 保证最低跨度，避免把微小波动视觉放大
  const span = hi - lo;
  if (span < props.minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - props.minSpan / 2;
    hi = mid + props.minSpan / 2;
  }

  // 上下留 8% 呼吸空间，并夹在硬量程内
  const pad = (hi - lo) * 0.08;
  return {
    min: Math.max(props.min, Math.floor((lo - pad) * 10) / 10),
    max: Math.min(props.max, Math.ceil((hi + pad) * 10) / 10)
  };
});

const W = 640;
const PAD = { top: 12, right: 12, bottom: 26, left: 30 };

/** 所有 x 值的并集（各序列的采样日期可能不完全一致） */
const xs = computed(() => {
  const set = new Set<string>();
  for (const s of props.series) for (const p of s.points) set.add(p.x);
  return [...set].sort();
});

const innerW = computed(() => W - PAD.left - PAD.right);
const innerH = computed(() => props.height - PAD.top - PAD.bottom);

function xAt(x: string): number {
  const n = xs.value.length;
  if (n <= 1) return PAD.left + innerW.value / 2;
  const i = xs.value.indexOf(x);
  return PAD.left + (innerW.value * i) / (n - 1);
}

function yAt(y: number): number {
  const span = domain.value.max - domain.value.min || 1;
  const r = Math.max(0, Math.min(1, (y - domain.value.min) / span));
  return PAD.top + innerH.value * (1 - r);
}

/** 把点位切成若干连续段：遇到 null 就断开，避免把"没有数据"连成线 */
const paths = computed(() =>
  props.series.map(s => {
    const segs: { x: string; y: number }[][] = [];
    let cur: { x: string; y: number }[] = [];
    for (const p of s.points) {
      if (p.y === null || !Number.isFinite(p.y)) {
        if (cur.length) segs.push(cur);
        cur = [];
      } else {
        cur.push({ x: p.x, y: p.y });
      }
    }
    if (cur.length) segs.push(cur);

    return {
      name: s.name,
      color: s.color,
      d: segs
        .map(seg =>
          seg
            .map(
              (p, i) =>
                `${i === 0 ? "M" : "L"}${xAt(p.x).toFixed(1)},${yAt(p.y).toFixed(1)}`
            )
            .join(" ")
        )
        .join(" "),
      segs,
      area: segs.length
        ? segs
            .map(seg => {
              if (seg.length < 2) return "";
              const top = seg
                .map(
                  (p, i) =>
                    `${i === 0 ? "M" : "L"}${xAt(p.x).toFixed(1)},${yAt(p.y).toFixed(1)}`
                )
                .join(" ");
              const last = seg[seg.length - 1];
              const first = seg[0];
              return `${top} L${xAt(last.x).toFixed(1)},${PAD.top + innerH.value} L${xAt(first.x).toFixed(1)},${PAD.top + innerH.value} Z`;
            })
            .join(" ")
        : ""
    };
  })
);

/** 网格线：固定 5 档，标签取整数或一位小数 */
const ticks = computed(() => {
  const n = 4;
  const { min, max } = domain.value;
  return Array.from({ length: n + 1 }, (_, i) => {
    const v = min + ((max - min) * i) / n;
    return { v: Math.round(v * 10) / 10, y: yAt(v) };
  });
});

/** x 轴标签：最多显示 6 个，避免挤在一起 */
const xLabels = computed(() => {
  const n = xs.value.length;
  if (!n) return [];
  const step = Math.max(1, Math.ceil(n / 6));
  return xs.value
    .map((x, i) => ({ x, i }))
    .filter(o => o.i % step === 0 || o.i === n - 1)
    .map(o => ({ x: o.x, label: o.x.slice(5), px: xAt(o.x) }));
});
</script>

<template>
  <div class="chart">
    <div v-if="series.length" class="legend">
      <span v-for="s in series" :key="s.name" class="lg-item">
        <i class="lg-dot" :style="{ background: s.color }" />
        {{ s.name }}
      </span>
    </div>
    <svg :viewBox="`0 0 ${W} ${height}`" class="svg" role="img">
      <!-- 网格 -->
      <g>
        <line
          v-for="t in ticks"
          :key="t.v"
          :x1="PAD.left"
          :x2="W - PAD.right"
          :y1="t.y"
          :y2="t.y"
          stroke="#e9eef3"
          stroke-width="1"
        />
        <text
          v-for="t in ticks"
          :key="`l-${t.v}`"
          :x="PAD.left - 6"
          :y="t.y + 3.5"
          text-anchor="end"
          class="tick"
        >
          {{ t.v }}
        </text>
      </g>

      <!-- 面积（可选，只画第一条序列时用来强调趋势） -->
      <g v-if="showArea">
        <path
          v-for="(p, i) in paths"
          v-show="i === 0 && p.area"
          :key="`a-${i}`"
          :d="p.area"
          :fill="p.color"
          opacity="0.08"
        />
      </g>

      <!-- 折线 -->
      <path
        v-for="(p, i) in paths"
        :key="`p-${i}`"
        :d="p.d"
        fill="none"
        :stroke="p.color"
        stroke-width="1.8"
        stroke-linejoin="round"
        stroke-linecap="round"
      />

      <!-- 数据点 -->
      <g v-for="(p, i) in paths" :key="`d-${i}`">
        <circle
          v-for="(pt, j) in p.segs.flat()"
          :key="j"
          :cx="xAt(pt.x)"
          :cy="yAt(pt.y)"
          r="2.6"
          :fill="p.color"
          stroke="#fff"
          stroke-width="1.2"
        >
          <title>{{ p.name }} · {{ pt.x }} · {{ pt.y }}</title>
        </circle>
      </g>

      <!-- x 轴 -->
      <line
        :x1="PAD.left"
        :x2="W - PAD.right"
        :y1="PAD.top + innerH"
        :y2="PAD.top + innerH"
        stroke="#dde5ec"
        stroke-width="1"
      />
      <text
        v-for="l in xLabels"
        :key="l.x"
        :x="l.px"
        :y="height - 8"
        text-anchor="middle"
        class="tick"
      >
        {{ l.label }}
      </text>
    </svg>
  </div>
</template>

<style scoped>
.chart {
  width: 100%;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-bottom: 6px;
}

.lg-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--c-text-2);
}

.lg-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.svg {
  display: block;
  width: 100%;
  height: auto;
}

.tick {
  font-size: 10px;
  fill: var(--c-text-3);
  font-family: inherit;
}
</style>
