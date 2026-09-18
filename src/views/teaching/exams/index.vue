<script setup lang="ts">
import EpPrinter from "~icons/ep/printer";
import { ref, reactive, computed, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { getAllCourses, getAllClasses } from "@/api/attendance";
import {
  getExamList,
  createExam,
  updateExam,
  deleteExam,
  getExamScores,
  saveExamScores,
  getExamScorecard
} from "@/api/teaching";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "TeachingExams"
});

const typeOptions = [
  { label: "单元测", value: "单元测" },
  { label: "期中", value: "期中" },
  { label: "期末", value: "期末" }
];

/* ---------- 筛选 ---------- */
const courseOptions = ref<any[]>([]);
const classOptions = ref<any[]>([]);
const searchForm = reactive({
  course_id: null as number | null,
  class_id: null as number | null,
  keyword: ""
});
const pagination = reactive({ page: 1, pageSize: 10, total: 0 });

const loading = ref(false);
const dataList = ref<any[]>([]);

function loadOptions() {
  getAllCourses().then((res: any) => {
    if (res.success) courseOptions.value = res.data;
  });
  getAllClasses().then((res: any) => {
    if (res.success) classOptions.value = res.data;
  });
}

function loadData() {
  loading.value = true;
  const params: Record<string, any> = {
    page: pagination.page,
    pageSize: pagination.pageSize
  };
  if (searchForm.course_id) params.course_id = searchForm.course_id;
  if (searchForm.class_id) params.class_id = searchForm.class_id;
  if (searchForm.keyword) params.keyword = searchForm.keyword;
  getExamList(params)
    .then((res: any) => {
      if (res.success) {
        dataList.value = res.data.list;
        pagination.total = res.data.total;
      }
    })
    .finally(() => (loading.value = false));
}

function handleSearch() {
  pagination.page = 1;
  loadData();
}

function handleReset() {
  searchForm.course_id = null;
  searchForm.class_id = null;
  searchForm.keyword = "";
  handleSearch();
}

function typeTag(type: string) {
  if (type === "期中") return "warning";
  if (type === "期末") return "danger";
  return "";
}

function scorePercent(row: any) {
  const total = Number(row.student_count) || 0;
  if (!total) return 0;
  const scored = Number(row.scored_count) || 0;
  return Math.min(100, Math.round((scored / total) * 100));
}

/* ---------- 新建/编辑弹窗 ---------- */
const dialogVisible = ref(false);
const dialogTitle = ref("新增考试");
const formRef = ref();
const form = reactive({
  id: null as number | null,
  name: "",
  course_id: null as number | null,
  class_id: null as number | null,
  type: "单元测",
  exam_date: "",
  full_score: 100,
  remark: ""
});
const rules = {
  name: [{ required: true, message: "请输入考试名称", trigger: "blur" }],
  course_id: [{ required: true, message: "请选择课程", trigger: "change" }],
  class_id: [{ required: true, message: "请选择班级", trigger: "change" }],
  type: [{ required: true, message: "请选择考试类型", trigger: "change" }],
  exam_date: [{ required: true, message: "请选择考试日期", trigger: "change" }],
  full_score: [{ required: true, message: "请输入满分", trigger: "change" }]
};

function openAdd() {
  dialogTitle.value = "新增考试";
  Object.assign(form, {
    id: null,
    name: "",
    course_id: null,
    class_id: null,
    type: "单元测",
    exam_date: "",
    full_score: 100,
    remark: ""
  });
  dialogVisible.value = true;
}

function openEdit(row: any) {
  dialogTitle.value = "编辑考试";
  Object.assign(form, {
    id: row.id,
    name: row.name,
    course_id: row.course_id ?? null,
    class_id: row.class_id ?? null,
    type: row.type || "单元测",
    exam_date: row.exam_date || "",
    full_score: row.full_score ?? 100,
    remark: row.remark || ""
  });
  dialogVisible.value = true;
}

function handleSubmit() {
  formRef.value.validate((valid: boolean) => {
    if (!valid) return;
    const payload = {
      name: form.name,
      course_id: form.course_id,
      class_id: form.class_id,
      type: form.type,
      exam_date: form.exam_date,
      full_score: form.full_score,
      remark: form.remark
    };
    const api = form.id ? updateExam(form.id, payload) : createExam(payload);
    api
      .then((res: any) => {
        if (res.success) {
          ElMessage.success(form.id ? "修改成功" : "新增成功");
          dialogVisible.value = false;
          loadData();
        } else {
          ElMessage.error(res.message || "保存失败");
        }
      })
      .catch((err: any) => {
        ElMessage.error(
          err?.response?.data?.message || err?.message || "保存失败"
        );
      });
  });
}

/* ---------- 录入成绩弹窗 ---------- */
const scoreDialogVisible = ref(false);
const scoreLoading = ref(false);
const scoreSaving = ref(false);
const scoreExam = ref<any>(null);
const scoreRows = ref<any[]>([]);

function openScores(row: any) {
  scoreExam.value = row;
  scoreDialogVisible.value = true;
  scoreLoading.value = true;
  scoreRows.value = [];
  getExamScores(row.id)
    .then((res: any) => {
      if (res.success) {
        scoreRows.value = (res.data.students || []).map((s: any) => ({
          student_id: s.student_id,
          student_no: s.student_no,
          name: s.name,
          score: s.score ?? null,
          remark: s.remark || ""
        }));
      } else {
        ElMessage.error(res.message || "加载成绩名单失败");
      }
    })
    .finally(() => (scoreLoading.value = false));
}

function saveScores() {
  const payload = scoreRows.value
    .filter(s => s.score !== null && s.score !== undefined && s.score !== "")
    .map(s => ({ student_id: s.student_id, score: s.score, remark: s.remark }));
  if (!payload.length) {
    ElMessage.warning("请先录入成绩");
    return;
  }
  scoreSaving.value = true;
  saveExamScores(scoreExam.value.id, { scores: payload })
    .then((res: any) => {
      if (res.success) {
        ElMessage.success("成绩保存成功");
        scoreDialogVisible.value = false;
        loadData();
      } else {
        ElMessage.error(res.message || "保存失败");
      }
    })
    .catch((err: any) => {
      ElMessage.error(
        err?.response?.data?.message || err?.message || "保存失败"
      );
    })
    .finally(() => (scoreSaving.value = false));
}

/* ---------- 成绩单弹窗 ---------- */
const cardVisible = ref(false);
const cardLoading = ref(false);
const cardData = ref<any>(null);

function openScorecard(row: any) {
  cardVisible.value = true;
  cardLoading.value = true;
  cardData.value = null;
  getExamScorecard(row.id)
    .then((res: any) => {
      if (res.success) {
        cardData.value = res.data;
      } else {
        ElMessage.error(res.message || "加载成绩单失败");
      }
    })
    .finally(() => (cardLoading.value = false));
}

function gradeTag(grade: string) {
  const map: Record<string, any> = {
    A: "success",
    B: "",
    C: "warning",
    D: "danger",
    E: "danger"
  };
  return map[grade] || "";
}

/* ---------- 删除 ---------- */
function handleDelete(row: any) {
  ElMessageBox.confirm(
    `确定删除考试「${row.name}」吗？其成绩记录将一并清除。`,
    "提示",
    {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消"
    }
  )
    .then(() => {
      deleteExam(row.id)
        .then((res: any) => {
          if (res.success) {
            ElMessage.success("删除成功");
            loadData();
          } else {
            ElMessage.error(res.message || "删除失败");
          }
        })
        .catch((err: any) => {
          ElMessage.error(
            err?.response?.data?.message || err?.message || "删除失败"
          );
        });
    })
    .catch(() => {});
}

/* ---------- 打印 ---------- */
function handlePrint() {
  window.print();
}

onMounted(() => {
  loadOptions();
  loadData();
});
</script>

<template>
  <div class="app-page">
    <AppPageHeader title="成绩管理" description="成绩录入、等级换算与导出" />
    <el-card shadow="never">
      <!-- 筛选 -->
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <el-select
          v-model="searchForm.course_id"
          placeholder="全部课程"
          clearable
          class="!w-40"
          @change="handleSearch"
        >
          <el-option
            v-for="c in courseOptions"
            :key="c.id"
            :label="c.name"
            :value="c.id"
          />
        </el-select>
        <el-select
          v-model="searchForm.class_id"
          placeholder="全部班级"
          clearable
          class="!w-40"
          @change="handleSearch"
        >
          <el-option
            v-for="c in classOptions"
            :key="c.id"
            :label="c.name"
            :value="c.id"
          />
        </el-select>
        <el-input
          v-model="searchForm.keyword"
          placeholder="考试名称关键字"
          clearable
          class="!w-48"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-button type="primary" @click="handleSearch">搜索</el-button>
        <el-button @click="handleReset">重置</el-button>
        <div class="flex-1" />
        <el-button type="primary" @click="openAdd">新增考试</el-button>
      </div>

      <!-- 表格 -->
      <el-table v-loading="loading" :data="dataList" border stripe>
        <el-table-column
          prop="name"
          label="考试名称"
          min-width="160"
          show-overflow-tooltip
        />
        <el-table-column label="课程" min-width="120">
          <template #default="{ row }">{{ row.course_name || "-" }}</template>
        </el-table-column>
        <el-table-column label="班级" min-width="120">
          <template #default="{ row }">{{ row.class_name || "-" }}</template>
        </el-table-column>
        <el-table-column label="类型" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="typeTag(row.type)" size="small">{{
              row.type || "-"
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="exam_date" label="考试日期" min-width="110" />
        <el-table-column label="满分" width="80" align="center">
          <template #default="{ row }">{{ row.full_score ?? "-" }}</template>
        </el-table-column>
        <el-table-column label="成绩录入进度" width="150" align="center">
          <template #default="{ row }">
            <div class="text-[12px] text-gray-500">
              {{ row.scored_count ?? 0 }} / {{ row.student_count ?? 0 }}
            </div>
            <el-progress
              :percentage="scorePercent(row)"
              :stroke-width="8"
              :show-text="false"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openScores(row)"
              >录入成绩</el-button
            >
            <el-button link type="primary" @click="openScorecard(row)"
              >成绩单</el-button
            >
            <el-button link type="primary" @click="openEdit(row)"
              >编辑</el-button
            >
            <el-button link type="danger" @click="handleDelete(row)"
              >删除</el-button
            >
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无考试数据" :image-size="60" />
        </template>
      </el-table>

      <!-- 分页 -->
      <div class="mt-4 flex justify-end">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :total="pagination.total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next, jumper"
          background
          @size-change="loadData"
          @current-change="loadData"
        />
      </div>
    </el-card>

    <!-- 新建/编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="520px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="考试名称" prop="name">
          <el-input v-model="form.name" placeholder="如：数学单元测（第3章）" />
        </el-form-item>
        <el-form-item label="课程" prop="course_id">
          <el-select
            v-model="form.course_id"
            placeholder="请选择课程"
            class="!w-full"
          >
            <el-option
              v-for="c in courseOptions"
              :key="c.id"
              :label="c.name"
              :value="c.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="班级" prop="class_id">
          <el-select
            v-model="form.class_id"
            placeholder="请选择班级"
            class="!w-full"
          >
            <el-option
              v-for="c in classOptions"
              :key="c.id"
              :label="c.name"
              :value="c.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="考试类型" prop="type">
          <el-select
            v-model="form.type"
            placeholder="请选择考试类型"
            class="!w-full"
          >
            <el-option
              v-for="t in typeOptions"
              :key="t.value"
              :label="t.label"
              :value="t.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="考试日期" prop="exam_date">
          <el-date-picker
            v-model="form.exam_date"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择考试日期"
            class="!w-full"
          />
        </el-form-item>
        <el-form-item label="满分" prop="full_score">
          <el-input-number
            v-model="form.full_score"
            :min="1"
            :max="1000"
            controls-position="right"
            class="!w-full"
          />
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input
            v-model="form.remark"
            type="textarea"
            :rows="2"
            placeholder="选填"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 录入成绩弹窗 -->
    <el-dialog
      v-model="scoreDialogVisible"
      :title="scoreExam ? `录入成绩：${scoreExam.name}` : '录入成绩'"
      width="720px"
    >
      <div v-loading="scoreLoading">
        <el-table :data="scoreRows" border stripe max-height="440">
          <el-table-column type="index" label="#" width="55" align="center" />
          <el-table-column prop="student_no" label="学号" min-width="110" />
          <el-table-column prop="name" label="姓名" min-width="90" />
          <el-table-column label="成绩" width="190" align="center">
            <template #default="{ row }">
              <el-input-number
                v-model="row.score"
                :min="0"
                :max="scoreExam ? Number(scoreExam.full_score) || 100 : 100"
                :precision="1"
                controls-position="right"
                placeholder="未录入"
                style="width: 140px"
              />
            </template>
          </el-table-column>
          <el-table-column label="备注" min-width="160">
            <template #default="{ row }">
              <el-input v-model="row.remark" placeholder="选填" />
            </template>
          </el-table-column>
        </el-table>
        <div class="mt-2 text-[12px] text-gray-400">
          已录入
          {{
            scoreRows.filter(
              s => s.score !== null && s.score !== undefined && s.score !== ""
            ).length
          }}
          / {{ scoreRows.length }} 人，保存后已录成绩将覆盖更新
        </div>
      </div>
      <template #footer>
        <el-button @click="scoreDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="scoreSaving" @click="saveScores"
          >保存成绩</el-button
        >
      </template>
    </el-dialog>

    <!-- 成绩单弹窗 -->
    <el-dialog v-model="cardVisible" title="考试成绩单" width="640px">
      <div id="printScorecard" v-loading="cardLoading">
        <template v-if="cardData">
          <div class="mb-3 text-center">
            <h2 class="text-lg font-bold">
              {{ cardData.exam?.name || "考试成绩单" }}
            </h2>
            <div class="text-sm text-gray-500">
              {{ cardData.exam?.course_name || "-" }} ·
              {{ cardData.exam?.class_name || "-" }} ·
              {{ cardData.exam?.exam_date || "-" }}
            </div>
          </div>
          <el-table :data="cardData.list || []" border stripe size="small">
            <el-table-column
              prop="rank"
              label="排名"
              width="70"
              align="center"
            />
            <el-table-column prop="student_no" label="学号" min-width="110" />
            <el-table-column prop="name" label="姓名" min-width="90" />
            <el-table-column label="分数" min-width="90" align="center">
              <template #default="{ row }">
                <span
                  :class="
                    row.score !== null && row.score !== undefined
                      ? 'font-medium'
                      : 'text-gray-400'
                  "
                >
                  {{ row.score ?? "-" }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="等级" width="80" align="center">
              <template #default="{ row }">
                <el-tag
                  v-if="row.grade"
                  :type="gradeTag(row.grade)"
                  size="small"
                  >{{ row.grade }}</el-tag
                >
                <span v-else class="text-gray-300">-</span>
              </template>
            </el-table-column>
          </el-table>
          <div class="mt-3 text-sm">
            平均分：<b class="text-blue-600">{{ cardData.avg_score ?? "-" }}</b>
            <span class="ml-2 text-gray-400"
              >满分 {{ cardData.exam?.full_score ?? "-" }}</span
            >
          </div>
        </template>
      </div>
      <template #footer>
        <el-button @click="cardVisible = false">关闭</el-button>
        <el-button
          type="primary"
          plain
          :disabled="!cardData"
          @click="handlePrint"
        >
          <el-icon class="mr-1"><EpPrinter /></el-icon>
          打印成绩单
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style>
/* 打印：仅输出 #printScorecard 区域（成绩单弹窗） */
@media print {
  body * {
    visibility: hidden;
  }
  #printScorecard,
  #printScorecard * {
    visibility: visible;
  }
  #printScorecard {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    padding: 10px;
  }
  .el-overlay,
  .el-overlay .el-dialog {
    background: transparent !important;
    box-shadow: none !important;
  }
}
</style>
