<script setup lang="ts">
import EpPrinter from "~icons/ep/printer";
import { ref } from "vue";
import { ElMessage } from "element-plus";
import { getStudentList } from "@/api/attendance";
import { getStudentTimeline } from "@/api/teaching";

defineOptions({
  name: "TeachingGrowth"
});

/* ---------- 学员选择 ---------- */
const studentOptions = ref<any[]>([]);
const studentLoading = ref(false);
const studentId = ref<number | null>(null);

function remoteSearch(query: string) {
  const kw = (query || "").trim();
  if (!kw) {
    studentOptions.value = [];
    return;
  }
  studentLoading.value = true;
  getStudentList({ keyword: kw, page: 1, pageSize: 20 })
    .then((res: any) => {
      if (res.success) studentOptions.value = res.data.list;
    })
    .finally(() => (studentLoading.value = false));
}

/* ---------- 成长档案时间线 ---------- */
const timelineLoading = ref(false);
const timeline = ref<any[]>([]);

// 事件类型 → el-tag 配色（入学/报班/缴费/退费/考勤/成绩/结业）
const typeColorMap: Record<string, any> = {
  入学: "success",
  报班: "",
  缴费: "success",
  退费: "danger",
  考勤: "warning",
  成绩: "",
  结业: "info"
};

function tagType(type: string) {
  return typeColorMap[type] ?? "";
}

function loadTimeline() {
  if (!studentId.value) return;
  timelineLoading.value = true;
  timeline.value = [];
  getStudentTimeline(studentId.value)
    .then((res: any) => {
      if (res.success) {
        timeline.value = res.data || [];
      } else {
        ElMessage.error(res.message || "加载成长档案失败");
      }
    })
    .finally(() => (timelineLoading.value = false));
}

function handlePrint() {
  window.print();
}
</script>

<template>
  <div class="p-4">
    <!-- 学员选择 -->
    <el-card shadow="never" class="mb-4">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[13px] text-gray-500">选择学员：</span>
        <el-select
          v-model="studentId"
          filterable
          remote
          clearable
          reserve-keyword
          :remote-method="remoteSearch"
          :loading="studentLoading"
          placeholder="输入姓名 / 学号搜索学员"
          class="!w-72"
          @change="loadTimeline"
          @clear="timeline = []"
        >
          <el-option
            v-for="s in studentOptions"
            :key="s.id"
            :label="`${s.name}（${s.student_no}）${s.class_name ? '· ' + s.class_name : ''}`"
            :value="s.id"
          />
        </el-select>
        <div class="flex-1" />
        <el-button
          type="primary"
          plain
          :disabled="!timeline.length"
          @click="handlePrint"
        >
          <el-icon class="mr-1"><EpPrinter /></el-icon>
          打印 / 导出
        </el-button>
      </div>
    </el-card>

    <el-card shadow="never">
      <template #header
        ><span class="font-medium">成长档案时间线</span></template
      >
      <div id="printGrowth" v-loading="timelineLoading">
        <template v-if="timeline.length">
          <el-timeline>
            <el-timeline-item
              v-for="(item, index) in timeline"
              :key="index"
              :timestamp="item.time || ''"
              placement="top"
            >
              <el-card shadow="never">
                <div class="mb-1 flex flex-wrap items-center gap-2">
                  <el-tag
                    v-if="item.type"
                    :type="tagType(item.type)"
                    size="small"
                    >{{ item.type }}</el-tag
                  >
                  <span class="font-medium">{{ item.title }}</span>
                </div>
                <div class="whitespace-pre-wrap text-sm text-gray-600">
                  {{ item.content }}
                </div>
              </el-card>
            </el-timeline-item>
          </el-timeline>
        </template>
        <el-empty
          v-else-if="!timelineLoading"
          description="请先选择学员查看成长档案"
          :image-size="80"
        />
      </div>
    </el-card>
  </div>
</template>

<style>
/* 打印：仅输出 #printGrowth 区域 */
@media print {
  body * {
    visibility: hidden;
  }
  #printGrowth,
  #printGrowth * {
    visibility: visible;
  }
  #printGrowth {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    padding: 0;
  }
}
</style>
