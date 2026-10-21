<script setup lang="ts">
/**
 * 使用指南（单页）
 * ---------------------------------------------------------------------------
 * 面向**没有技术背景的校区老师**，排版参考 pure-admin 官方文档
 * （https://pure-admin.cn/pages/introduction/）：左侧正文、右侧本页目录、
 * 标题锚点、彩色提示框（提示 / 注意 / 危险）。
 *
 * ★ 两个必须知道的技术约束（踩过才知道）：
 *   1. 本项目路由是 **hash 模式**（`/#/guide`）。因此**绝不能用 `<a href="#xxx">`**
 *      做页内跳转 —— 那会把 `#/guide` 换成 `#xxx`，路由直接被顶掉。
 *      本页一律用 JS `scrollIntoView` 跳转，不碰 URL。
 *   2. 模板里不能出现 `window` / `location`（K-080），宿主对象只在 script 里用。
 *
 * 全部颜色走 `src/style/tokens.scss` 的 CSS 变量，深浅色主题自动跟随，不写死色值。
 */
import { ref, computed, onMounted, onUnmounted, nextTick } from "vue";
import { useRouter } from "vue-router";
import { useUserStoreHook } from "@/store/modules/user";
import { AppPageHeader } from "@/components/AppPageHeader";
import {
  INTRO,
  PREP,
  MENU_GROUPS,
  FEATURES,
  FLOWS,
  FAQS,
  CAUTION_GROUPS,
  TOC,
  ROLE_LABEL,
  type Role,
  type GuideFeature,
  type GuideFaq
} from "./content";

import SearchIcon from "~icons/ep/search";
import LinkIcon from "~icons/ep/link";
import TopIcon from "~icons/ep/top";
import MoneyIcon from "~icons/ep/money";
import ClockIcon from "~icons/ep/clock";
import LockIcon from "~icons/ep/lock";
import DeleteIcon from "~icons/ep/delete";
import InfoIcon from "~icons/ep/info-filled";
import WarningIcon from "~icons/ep/warning-filled";
import DangerIcon from "~icons/ep/circle-close-filled";

defineOptions({ name: "Guide" });

const router = useRouter();
const myRoles = (useUserStoreHook().roles || []) as string[];

/* ── 页内搜索 ──────────────────────────────────────────────────────────── */
const keyword = ref("");
const searching = computed(() => keyword.value.trim().length > 0);

/** 命中判定：标题 / 用途 / 何时用 / 路径 / 每一步文案，任一包含关键字即命中 */
function hits(texts: string[]): boolean {
  const k = keyword.value.trim().toLowerCase();
  if (!k) return true;
  return texts.some(t => String(t).toLowerCase().includes(k));
}

const visibleFeatures = computed(() =>
  FEATURES.filter(f =>
    hits([
      f.title,
      f.group,
      f.purpose,
      f.when,
      f.path,
      ...f.steps.map(s => s.text)
    ])
  )
);

const visibleFaqs = computed(() =>
  FAQS.filter(f => hits([f.symptom, f.cause, ...f.fix]))
);

/** 按左侧菜单分组归拢功能（未命中搜索的分组自动隐藏） */
const featureGroups = computed(() =>
  MENU_GROUPS.map(g => ({
    group: g,
    items: visibleFeatures.value.filter(f => f.group === g.name)
  })).filter(x => x.items.length > 0)
);

const resultCount = computed(
  () => visibleFeatures.value.length + visibleFaqs.value.length
);

/* ── 角色标注 ──────────────────────────────────────────────────────────── */
function roleText(roles: Role[]): string {
  return roles.map(r => ROLE_LABEL[r]).join(" · ");
}

/** 当前登录人是否有权打开这个页面（有才显示「打开这个页面」按钮） */
function canOpen(roles: Role[]): boolean {
  return myRoles.some(r => roles.includes(r as Role));
}

function openPage(path: string) {
  router.push(path);
}

/* ── 跳转（不用 <a href="#...">，见文件头说明） ────────────────────────── */
const activeId = ref("s-intro");

function goTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  activeId.value = id;
}

function backToTop() {
  goTo("s-intro");
}

/* ── 右侧目录的当前项高亮（滚动监听） ──────────────────────────────────── */
let observer: IntersectionObserver | null = null;

function flatAnchors(): string[] {
  const ids: string[] = [];
  for (const t of TOC) {
    ids.push(t.id);
    t.children?.forEach(c => ids.push(c.id));
  }
  return ids;
}

onMounted(async () => {
  await nextTick();
  observer = new IntersectionObserver(
    entries => {
      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length) activeId.value = visible[0].target.id;
    },
    { rootMargin: "-72px 0px -70% 0px", threshold: 0 }
  );
  flatAnchors().forEach(id => {
    const el = document.getElementById(id);
    if (el) observer?.observe(el);
  });
});

onUnmounted(() => {
  observer?.disconnect();
  observer = null;
});

/* ── 文案里的 **加粗** 渲染 ───────────────────────────────────────────── */
function bold(text: string): string {
  const safe = String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

const CAUTION_ICON = {
  money: MoneyIcon,
  clock: ClockIcon,
  lock: LockIcon,
  trash: DeleteIcon
};

const CALLOUT_ICON = {
  tip: InfoIcon,
  warn: WarningIcon,
  danger: DangerIcon
};
</script>

<template>
  <div class="app-page guide-page">
    <AppPageHeader
      title="使用指南"
      description="给校区老师看的操作说明：不知道怎么用，就先翻这一页"
    >
      <el-button :icon="TopIcon" @click="backToTop">回到顶部</el-button>
    </AppPageHeader>

    <!-- 页内搜索：不记得功能在哪个菜单时，直接搜 -->
    <div class="page-card guide-search">
      <el-input
        v-model="keyword"
        size="large"
        clearable
        :prefix-icon="SearchIcon"
        placeholder="想找什么？试试：点名 / 退费 / 课时 / 打印 / 请假 / 导入"
      />
      <p v-if="searching" class="page-hint guide-search__hint">
        按「{{ keyword }}」找到 <strong>{{ resultCount }}</strong> 条结果。
        <el-button link type="primary" @click="keyword = ''"
          >清空搜索，看全部内容</el-button
        >
      </p>
      <p v-else class="page-hint guide-search__hint">
        也可以直接看右侧的「本页目录」跳到某一节。第一次用建议从
        <el-button link type="primary" @click="goTo('s-prep')"
          >使用前的准备</el-button
        >
        开始。
      </p>
    </div>

    <div class="guide-layout">
      <!-- ══════════ 正文 ══════════ -->
      <main class="guide-main">
        <!-- ───── 一、这套系统是干什么的 ───── -->
        <section id="s-intro" class="page-card guide-section">
          <h2 class="guide-h2">一、这套系统是干什么的</h2>

          <p class="guide-p">{{ INTRO.what }}</p>

          <h3 class="guide-h3">谁用它</h3>
          <ul class="guide-ul">
            <li v-for="w in INTRO.who" :key="w.role">
              <el-tag
                :type="w.role === 'admin' ? 'danger' : 'primary'"
                size="small"
                effect="plain"
                class="guide-tag"
              >
                {{ ROLE_LABEL[w.role] }}
              </el-tag>
              <span v-html="bold(w.text)" />
            </li>
          </ul>

          <h3 class="guide-h3">什么时候会用到它</h3>
          <ul class="guide-ul">
            <li v-for="(s, i) in INTRO.scenarios" :key="i">
              <span v-html="bold(s)" />
            </li>
          </ul>

          <h3 class="guide-h3">它不做什么（先说清楚，免得白找）</h3>
          <ul class="guide-ul">
            <li v-for="(s, i) in INTRO.notFor" :key="i">
              <span v-html="bold(s)" />
            </li>
          </ul>
        </section>

        <!-- ───── 二、使用前的准备 ───── -->
        <section id="s-prep" class="page-card guide-section">
          <h2 class="guide-h2">二、使用前的准备</h2>

          <h3 class="guide-h3">{{ PREP.access.title }}</h3>
          <ol class="guide-steps">
            <li v-for="(s, i) in PREP.access.steps" :key="i">
              <span class="guide-steps__no">{{ i + 1 }}</span>
              <div class="guide-steps__body">
                <span v-html="bold(s.text)" />
                <p v-if="s.tip" class="guide-tip" v-html="bold(s.tip)" />
              </div>
            </li>
          </ol>
          <div
            v-for="(c, i) in PREP.access.cautions"
            :key="`ac${i}`"
            class="guide-callout guide-callout--warn"
          >
            <WarningIcon class="guide-callout__icon" />
            <span v-html="bold(c)" />
          </div>

          <h3 class="guide-h3">{{ PREP.interface.title }}</h3>
          <p class="guide-p">
            系统主要就三块地方：左边的菜单是功能入口，上边一条是搜索和各种快捷入口，中间是当前页面。先把下面这几个「按钮在哪」记住，后面就好找了。
          </p>
          <el-table
            :data="PREP.interface.areas"
            size="small"
            class="guide-table"
          >
            <el-table-column prop="name" label="位置" width="140" />
            <el-table-column prop="what" label="它是什么" min-width="240" />
            <el-table-column prop="how" label="怎么用" min-width="260" />
          </el-table>
          <div
            v-for="(c, i) in PREP.interface.cautions"
            :key="`ic${i}`"
            class="guide-callout guide-callout--tip"
          >
            <InfoIcon class="guide-callout__icon" />
            <span v-html="bold(c)" />
          </div>

          <h3 class="guide-h3">{{ PREP.bootstrap.title }}</h3>
          <p class="guide-p" v-html="bold(PREP.bootstrap.intro)" />
          <el-table
            :data="PREP.bootstrap.order"
            size="small"
            class="guide-table"
          >
            <el-table-column
              prop="step"
              label="顺序"
              width="64"
              align="center"
            />
            <el-table-column label="要做的页面" width="180">
              <template #default="{ row }">
                <span class="guide-table__link">{{ row.title }}</span>
              </template>
            </el-table-column>
            <el-table-column
              prop="why"
              label="为什么要先做它"
              min-width="320"
            />
          </el-table>
          <div
            v-for="(c, i) in PREP.bootstrap.cautions"
            :key="`bc${i}`"
            class="guide-callout guide-callout--danger"
          >
            <DangerIcon class="guide-callout__icon" />
            <span v-html="bold(c)" />
          </div>

          <h3 class="guide-h3">左侧菜单全貌</h3>
          <p class="guide-p">
            下面就是左侧菜单里全部分组的清单，按从上到下的顺序排。带「负责人」标记的分组，老师账号是看不到的。
          </p>
          <el-table
            :data="MENU_GROUPS.filter(g => g.name !== '使用指南')"
            size="small"
            class="guide-table"
          >
            <el-table-column prop="name" label="菜单分组" width="130" />
            <el-table-column
              prop="summary"
              label="里面装了什么"
              min-width="300"
            />
            <el-table-column label="谁能看到" width="150">
              <template #default="{ row }">
                <el-tag
                  v-for="r in row.roles"
                  :key="r"
                  :type="r === 'admin' ? 'danger' : 'primary'"
                  size="small"
                  effect="plain"
                  class="guide-tag"
                >
                  {{ ROLE_LABEL[r] }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
          <div class="guide-callout guide-callout--tip">
            <InfoIcon class="guide-callout__icon" />
            <span
              >左侧菜单里如果没看到「家校沟通」这个分组，而是直接看到一个叫「通知记录」的一级菜单，这是正常的：分组里只有一项时，界面会把它直接提上来显示。</span
            >
          </div>
        </section>

        <!-- ───── 三、全部功能与操作 ───── -->
        <section id="s-features" class="page-card guide-section">
          <h2 class="guide-h2">三、全部功能与操作</h2>
          <p class="guide-p">
            按左侧菜单的顺序，把每个页面的「它是干什么的、什么时候用、怎么一步一步做」都写在这里。
          </p>
          <p v-if="searching" class="guide-p guide-count">
            当前搜索下，功能章节里还剩
            <strong>{{ visibleFeatures.length }}</strong> 个页面。
          </p>
        </section>

        <!-- 按分组铺开 -->
        <section
          v-for="fg in featureGroups"
          :id="`g-${fg.group.rank}`"
          :key="fg.group.name"
          class="guide-group"
        >
          <h2 class="guide-h2 guide-h2--group">{{ fg.group.name }}</h2>
          <p class="guide-p guide-p--muted">{{ fg.group.summary }}</p>

          <article
            v-for="f in fg.items"
            :id="f.id"
            :key="f.id"
            class="page-card guide-feature"
          >
            <header class="guide-feature__head">
              <div class="guide-feature__titleline">
                <h3 class="guide-h3 guide-h3--flat">{{ f.title }}</h3>
                <el-tag
                  v-for="r in f.roles"
                  :key="r"
                  :type="r === 'admin' ? 'danger' : 'primary'"
                  size="small"
                  effect="plain"
                  class="guide-tag"
                >
                  {{ ROLE_LABEL[r] }}
                </el-tag>
                <el-button
                  v-if="canOpen(f.roles)"
                  link
                  type="primary"
                  size="small"
                  :icon="LinkIcon"
                  @click="openPage(f.path)"
                  >打开这个页面</el-button
                >
              </div>
              <code class="guide-path">{{ f.path }}</code>
            </header>

            <dl class="guide-meta">
              <dt>它是干什么的</dt>
              <dd v-html="bold(f.purpose)" />
              <dt>什么时候用</dt>
              <dd v-html="bold(f.when)" />
            </dl>

            <div class="guide-steps__label">怎么操作</div>
            <ol class="guide-steps">
              <li v-for="(s, i) in f.steps" :key="i">
                <span class="guide-steps__no">{{ i + 1 }}</span>
                <div class="guide-steps__body">
                  <span v-html="bold(s.text)" />
                  <p v-if="s.tip" class="guide-tip" v-html="bold(s.tip)" />
                </div>
              </li>
            </ol>

            <template v-if="f.cautions?.length">
              <!-- 功能级的「注意事项」用黄色：它是"要当心的坑"。
                   红色留给真正不可撤销的操作（见「六、关键注意事项 → 不可撤销的操作」）——
                   如果满页都是红的，读者会对红色脱敏，反而漏掉真正危险的那几条。 -->
              <div
                v-for="(c, i) in f.cautions"
                :key="`c${i}`"
                class="guide-callout guide-callout--warn"
              >
                <WarningIcon class="guide-callout__icon" />
                <span v-html="bold(c)" />
              </div>
            </template>
          </article>
        </section>

        <!-- ───── 四、主要业务流 ───── -->
        <section id="s-flows" class="page-card guide-section">
          <h2 class="guide-h2">四、主要业务流</h2>
          <p class="guide-p">
            零散的功能会用了之后，再按下面四条线走一遍。每条线都对应一件真实要办的事，照着顺序做就行。
          </p>
        </section>

        <article
          v-for="fl in FLOWS"
          :id="fl.id"
          :key="fl.id"
          class="page-card guide-feature"
        >
          <header class="guide-feature__head">
            <div class="guide-feature__titleline">
              <h3 class="guide-h3 guide-h3--flat">{{ fl.title }}</h3>
              <el-tag
                v-for="r in fl.roles"
                :key="r"
                :type="r === 'admin' ? 'danger' : 'primary'"
                size="small"
                effect="plain"
                class="guide-tag"
              >
                {{ ROLE_LABEL[r] }}
              </el-tag>
            </div>
          </header>

          <p class="guide-scene">
            <strong>什么情况下会走这条线：</strong>{{ fl.scenario }}
          </p>

          <ol class="guide-flow">
            <li v-for="(s, i) in fl.steps" :key="i">
              <span class="guide-steps__no">{{ i + 1 }}</span>
              <div class="guide-steps__body">
                <div class="guide-flow__title">{{ s.title }}</div>
                <span v-html="bold(s.detail)" />
                <div v-if="s.link" class="guide-flow__link">
                  <el-button
                    link
                    type="primary"
                    size="small"
                    :icon="LinkIcon"
                    @click="
                      goTo(
                        `g-${MENU_GROUPS.find(g => g.name === FEATURES.find(f => f.path === s.link!.path)?.group)?.rank ?? 0}`
                      )
                    "
                    >看这一页的详细操作</el-button
                  >
                </div>
              </div>
            </li>
          </ol>

          <template v-if="fl.cautions?.length">
            <div
              v-for="(c, i) in fl.cautions"
              :key="`fc${i}`"
              :class="['guide-callout', `guide-callout--${c.kind}`]"
            >
              <component
                :is="CALLOUT_ICON[c.kind]"
                class="guide-callout__icon"
              />
              <span
                ><strong>{{ c.title }}：</strong>{{ c.text }}</span
              >
            </div>
          </template>
        </article>

        <!-- ───── 五、常见问题排查 ───── -->
        <section id="s-faq" class="page-card guide-section">
          <h2 class="guide-h2">五、常见问题排查</h2>
          <p class="guide-p">
            按「你怎么描述这个问题」来找。左边是你遇到的现象，右边是原因和解决办法。当前共
            <strong>{{ visibleFaqs.length }}</strong> 条。
          </p>
        </section>

        <article
          v-for="(q, i) in visibleFaqs"
          :id="q.id"
          :key="q.id"
          class="page-card guide-faq"
        >
          <h3 class="guide-h3 guide-h3--flat">
            <span class="guide-faq__no">现象 {{ i + 1 }}</span>
            {{ q.symptom }}
          </h3>
          <p class="guide-faq__cause" v-html="bold(`原因：${q.cause}`)" />
          <div class="guide-steps__label">怎么办</div>
          <ol class="guide-steps">
            <li v-for="(s, k) in q.fix" :key="k">
              <span class="guide-steps__no">{{ k + 1 }}</span>
              <div class="guide-steps__body">
                <span v-html="bold(s)" />
              </div>
            </li>
          </ol>
        </article>

        <!-- ───── 六、关键注意事项 ───── -->
        <section id="s-cautions" class="page-card guide-section">
          <h2 class="guide-h2">六、关键注意事项</h2>
          <p class="guide-p">
            这一节是把最容易出事的地方集中起来。**建议每位老师都读一遍**。
          </p>
        </section>

        <article
          v-for="cg in CAUTION_GROUPS"
          :id="cg.id"
          :key="cg.id"
          class="page-card guide-feature"
        >
          <h3 class="guide-h3 guide-h3--flat">
            <component :is="CAUTION_ICON[cg.icon]" class="guide-caution-icon" />
            {{ cg.title }}
          </h3>
          <ul class="guide-ul guide-ul--tight">
            <li
              v-for="(it, i) in cg.items"
              :key="i"
              :class="{ 'guide-danger-item': cg.id === 'c-danger' }"
            >
              <span v-html="bold(it)" />
            </li>
          </ul>
        </article>

        <div class="guide-foot">
          <el-button :icon="TopIcon" @click="backToTop">回到顶部</el-button>
          <span class="page-hint"
            >这份指南随系统一起更新。发现写得不清楚或与页面不符，请告诉校区负责人。</span
          >
        </div>
      </main>

      <!-- ══════════ 本页目录 ══════════ -->
      <aside class="guide-toc">
        <nav class="page-card guide-toc__card">
          <div class="guide-toc__title">本页目录</div>
          <ul class="guide-toc__list">
            <li v-for="t in TOC" :key="t.id">
              <button
                type="button"
                :class="['guide-toc__item', { 'is-active': activeId === t.id }]"
                @click="goTo(t.id)"
              >
                {{ t.label }}
              </button>
              <ul v-if="t.children?.length" class="guide-toc__sublist">
                <li v-for="c in t.children" :key="c.id">
                  <button
                    type="button"
                    :class="[
                      'guide-toc__item',
                      'guide-toc__item--sub',
                      { 'is-active': activeId === c.id }
                    ]"
                    @click="goTo(c.id)"
                  >
                    {{ c.label }}
                  </button>
                </li>
              </ul>
            </li>
          </ul>
        </nav>
      </aside>
    </div>
  </div>
</template>

<style lang="scss" scoped>


@media (width <= 1200px) {
  .guide-layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .guide-toc {
    display: none;
  }

  .guide-main {
    max-width: none;
  }
}

.guide-search {
  margin-bottom: var(--space-4);
}

.guide-search__hint {
  margin-top: var(--space-2);
}

/* ---------------------------------------------------------------------------
   两栏骨架：正文 + 右侧目录
   --------------------------------------------------------------------------- */
.guide-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 232px;
  gap: var(--space-4);
  align-items: start;
}

.guide-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;

  /* 正文行宽上限：中文每行 40~50 字最好读，太宽会串行 */
  max-width: 900px;
}

/* ---------------------------------------------------------------------------
   右侧目录
   --------------------------------------------------------------------------- */
.guide-toc__card {
  position: sticky;
  top: var(--space-4);
  max-height: calc(100vh - 120px);
  padding: var(--space-4);
  overflow-y: auto;
}

.guide-toc__title {
  margin-bottom: var(--space-3);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--ink-800);
}

.guide-toc__list,
.guide-toc__sublist {
  padding: 0;
  margin: 0;
  list-style: none;
}

.guide-toc__sublist {
  margin: 2px 0 var(--space-2) var(--space-3);
  border-left: 1px solid var(--ink-100);
}

.guide-toc__item {
  display: block;
  width: 100%;
  padding: 4px var(--space-2);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
  color: var(--ink-600);
  text-align: left;
  cursor: pointer;
  background: none;
  border: none;
  border-radius: var(--radius-xs);
  transition: all var(--duration-fast) var(--ease-out);

  &:hover {
    color: var(--brand-600);
    background: var(--surface-hover);
  }

  &.is-active {
    font-weight: var(--weight-medium);
    color: var(--brand-600);
    background: var(--brand-50);
  }
}

.guide-toc__item--sub {
  color: var(--ink-500);
}

/* ---------------------------------------------------------------------------
   正文排版
   --------------------------------------------------------------------------- */
.guide-section {
  scroll-margin-top: var(--space-4);
}

.guide-h2 {
  padding-bottom: var(--space-3);
  margin: 0 0 var(--space-4);
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  line-height: var(--leading-tight);
  color: var(--ink-900);
  border-bottom: 1px solid var(--ink-100);
}

.guide-h2--group {
  padding-bottom: 0;
  margin-bottom: var(--space-1);
  font-size: var(--text-md);
  border-bottom: none;
}

.guide-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  scroll-margin-top: var(--space-4);
}

.guide-h3 {
  margin: var(--space-5) 0 var(--space-3);
  font-size: var(--text-base);
  font-weight: var(--weight-semibold);
  line-height: var(--leading-tight);
  color: var(--ink-800);
}

.guide-h3--flat {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin: 0;
}

.guide-section > .guide-h3:first-of-type {
  margin-top: var(--space-4);
}

.guide-p {
  margin: 0 0 var(--space-3);
  font-size: var(--text-base);
  line-height: var(--leading-relaxed);
  color: var(--ink-700);
}

.guide-p--muted {
  margin-bottom: 0;
  font-size: var(--text-sm);
  color: var(--ink-500);
}

.guide-count {
  padding: var(--space-2) var(--space-3);
  margin-top: var(--space-3);
  font-size: var(--text-sm);
  color: var(--brand-700);
  background: var(--brand-50);
  border-radius: var(--radius-sm);
}

.guide-scene {
  padding: var(--space-3) var(--space-4);
  margin: 0 0 var(--space-4);
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
  color: var(--ink-700);
  background: var(--surface-sunken);
  border-radius: var(--radius-sm);
}

.guide-ul {
  padding-left: var(--space-5);
  margin: 0 0 var(--space-4);
  font-size: var(--text-base);
  line-height: var(--leading-relaxed);
  color: var(--ink-700);

  li {
    margin-bottom: var(--space-2);
  }
}

.guide-ul--tight li {
  margin-bottom: var(--space-1);
}

/* 「不可撤销的操作」整组用红色左边条 —— 全页只有这一处是红的，
   读者扫到红色就知道"这里不能反悔"（红色一旦滥用就没人看了）。 */
.guide-danger-item {
  padding: var(--space-2) var(--space-3);
  background: color-mix(in srgb, var(--status-danger) 7%, transparent);
  border-left: 3px solid var(--status-danger);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}

/* ---------------------------------------------------------------------------
   分步操作：编号圆点 + 正文
   --------------------------------------------------------------------------- */
.guide-steps {
  padding: 0;
  margin: 0 0 var(--space-3);
  list-style: none;

  li {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--ink-700);
    border-bottom: 1px dashed var(--ink-100);

    &:last-child {
      border-bottom: none;
    }
  }
}

.guide-steps__no {
  display: flex;
  flex: 0 0 20px;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-top: 3px;
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--on-brand);
  background: var(--brand-600);
  border-radius: var(--radius-pill);
}

.guide-steps__body {
  flex: 1;
  min-width: 0;
}

.guide-steps__label {
  margin: var(--space-3) 0 var(--space-1);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--ink-500);
  letter-spacing: 0.04em;
}

.guide-tip {
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
  color: var(--ink-500);
}

/* ---------------------------------------------------------------------------
   功能卡
   --------------------------------------------------------------------------- */
.guide-feature,
.guide-faq {
  scroll-margin-top: var(--space-4);
}

.guide-feature__head {
  margin-bottom: var(--space-4);
}

.guide-feature__titleline {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.guide-tag {
  flex: 0 0 auto;
}

.guide-path {
  display: inline-block;
  padding: 2px var(--space-2);
  margin-top: var(--space-2);
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--ink-500);
  background: var(--surface-sunken);
  border: 1px solid var(--ink-100);
  border-radius: var(--radius-xs);
}

.guide-meta {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: var(--space-2) var(--space-3);
  padding: var(--space-3) var(--space-4);
  margin: 0 0 var(--space-4);
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
  background: var(--surface-sunken);
  border-radius: var(--radius-sm);

  dt {
    color: var(--ink-500);
  }

  dd {
    margin: 0;
    color: var(--ink-700);
  }
}

/* ---------------------------------------------------------------------------
   提示框（仿 pure-admin 文档的 tip / warning / danger）
   --------------------------------------------------------------------------- */
.guide-callout {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  margin: var(--space-2) 0;
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
  border-left: 3px solid transparent;
  border-radius: var(--radius-sm);

  &:last-child {
    margin-bottom: 0;
  }
}

.guide-callout__icon {
  flex: 0 0 16px;
  margin-top: 3px;
  font-size: 16px;
}

.guide-callout--tip {
  color: var(--ink-700);
  background: var(--brand-50);
  border-left-color: var(--brand-600);

  .guide-callout__icon {
    color: var(--brand-600);
  }
}

.guide-callout--warn {
  color: var(--ink-800);
  background: color-mix(in srgb, var(--status-warning) 10%, transparent);
  border-left-color: var(--status-warning);

  .guide-callout__icon {
    color: var(--status-warning);
  }
}

.guide-callout--danger {
  color: var(--ink-800);
  background: color-mix(in srgb, var(--status-danger) 9%, transparent);
  border-left-color: var(--status-danger);

  .guide-callout__icon {
    color: var(--status-danger);
  }
}

/* ---------------------------------------------------------------------------
   业务流
   --------------------------------------------------------------------------- */
.guide-flow {
  padding: 0;
  margin: var(--space-4) 0 0;
  list-style: none;

  li {
    display: flex;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    font-size: var(--text-base);
    line-height: var(--leading-relaxed);
    color: var(--ink-700);
    border-bottom: 1px dashed var(--ink-100);

    &:last-child {
      border-bottom: none;
    }
  }
}

.guide-flow__title {
  margin-bottom: var(--space-1);
  font-weight: var(--weight-semibold);
  color: var(--ink-800);
}

.guide-flow__link {
  margin-top: var(--space-1);
}

/* ---------------------------------------------------------------------------
   常见问题
   --------------------------------------------------------------------------- */
.guide-faq__no {
  flex: 0 0 auto;
  padding: 1px var(--space-2);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  color: var(--ink-500);
  background: var(--surface-sunken);
  border-radius: var(--radius-xs);
}

.guide-faq__cause {
  padding: var(--space-3) var(--space-4);
  margin: var(--space-3) 0 0;
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
  color: var(--ink-700);
  background: var(--surface-sunken);
  border-radius: var(--radius-sm);
}

.guide-caution-icon {
  font-size: 16px;
  color: var(--brand-600);
}

/* ---------------------------------------------------------------------------
   页脚
   --------------------------------------------------------------------------- */
.guide-foot {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-4) 0;
}

/* ---------------------------------------------------------------------------
   表格微调：把默认宽度撑满卡片
   --------------------------------------------------------------------------- */
.guide-table {
  width: 100%;
  margin-bottom: var(--space-4);
}

.guide-table__link {
  color: var(--brand-600);
}

.guide-table :deep(.el-table__cell) {
  font-size: var(--text-sm);
}

/* ---------------------------------------------------------------------------
   搜索条
   --------------------------------------------------------------------------- */
</style>
