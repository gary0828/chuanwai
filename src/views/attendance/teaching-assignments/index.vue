<script setup lang="ts">
// 任课关系维护页（班级 × 课程 × 教师 × 学期）
//
// ★ 骨架照抄 users/index.vue（AppPageHeader + .page-card--flush + 表格 + 弹窗）。
// ★ 任课关系是"任课教师可见自己班级教学数据"的依据（G2）。
// ★ 接口全部走 @/api/sessions；无 axios / $route / localStorage。
import { ref, reactive, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  getAllClasses,
  getAllCourses,
  getAllTerms,
  getUserList
} from "@/api/attendance";
import {
  getTeachingAssignments,
  createTeachingAssignment,
  updateTeachingAssignment,
  deleteTeachingAssignment
} from "@/api/sessions";
import { AppPageHeader } from "@/components/AppPageHeader";
import { AppEmpty } from "@/components/AppEmpty";

defineOptions({
  name: "TeachingAssignments"
});

const loading = ref(false);
const dataList = ref<any[]>([]);
const classOptions = ref<any[]>([]);
const courseOptions = ref<any[]>([]);
const teacherOptions = ref<any[]>([]);
const termOptions = ref<any[]>([]);

const searchForm = reactive({
  class_id: null as number | null,
  teacher_id: null as number | null,
  term_id: null as number | null
});
const pagination = reactive({ page: 1, pageSize: 10, total: 0 });

// 新增/编辑
const dialogVisible = ref(false);
const dialogTitle = ref("新增任课关系");
const formRef = ref();
const form = reactive({
  id: null as number | null,
  class_id: null as number | null,
  course_id: null as number | null,
  teacher_id: null as number | null,
  term_id: null as number | null
});
const rules = {
  class_id: [{ required: true, message: "请选择班级", trigger: "change" }],
  course_id: [{ required: true, message: "请选择课程", trigger: "change" }]
};

function loadOptions() {
  getAllClasses().then((res: any) => {
    if (res.success) classOptions.value = res.data;
  });
  getAllCourses().then((res: any) => {
    if (res.success) courseOptions.value = res.data;
  });
  getAllTerms().then((res: any) => {
    if (res.success) termOptions.value = res.data;
  });
  getUserList({ role: "teacher", pageSize: 100 }).then((res: any) => {
    if (res.success) teacherOptions.value = res.data.list;
  });
}

function loadData() {
  loading.value = true;
  getTeachingAssignments({
    class_id: searchForm.class_id ?? undefined,
    teacher_id: searchForm.teacher_id ?? undefined,
    term_id: searchForm.term_id ?? undefined,
    page: pagination.page,
    pageSize: pagination.pageSize
  })
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
  Object.assign(searchForm, {
    class_id: null,
    teacher_id: null,
    term_id: null
  });
  handleSearch();
}

function openAdd() {
  dialogTitle.value = "新增任课关系";
  Object.assign(form, {
    id: null,
    class_id: null,
    course_id: null,
    teacher_id: null,
    term_id: null
  });
  dialogVisible.value = true;
}

function openEdit(row: any) {
  dialogTitle.value = "编辑任课关系";
  Object.assign(form, {
    id: row.id,
    class_id: row.class_id,
    course_id: row.course_id,
    teacher_id: row.teacher_id,
    term_id: row.term_id
  });
  dialogVisible.value = true;
}

function handleSubmit() {
  formRef.value.validate((valid: boolean) => {
    if (!valid) return;
    const payload = {
      class_id: form.class_id,
      course_id: form.course_id,
      teacher_id: form.teacher_id,
      term_id: form.term_id
    };
    const api = form.id
      ? updateTeachingAssignment(form.id, payload)
      : createTeachingAssignment(payload);
    api.then((res: any) => {
      if (res.success) {
        ElMessage.success(form.id ? "修改成功" : "新增成功");
        dialogVisible.value = false;
        loadData();
      }
    });
  });
}

function handleDelete(row: any) {
  ElMessageBox.confirm(
    `确定删除「${row.class_name} · ${row.course_name}」的任课关系吗？删除后该教师将看不到对应班级的教学数据。`,
    "提示",
    { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" }
  )
    .then(() => {
      deleteTeachingAssignment(row.id).then((res: any) => {
        if (res.success) {
          ElMessage.success("删除成功");
          loadData();
        }
      });
    })
    .catch(() => {});
}

onMounted(() => {
  loadOptions();
  loadData();
});
</script>

<template>
  <div class="app-page">
    <AppPageHeader
      title="任课关系"
      description="维护「班级 × 课程 × 教师」，任课教师可据此看到自己的教学数据"
    >
      <el-button type="primary" @click="openAdd">新增任课关系</el-button>
    </AppPageHeader>

    <div class="page-card page-card--flush">
      <div class="page-toolbar">
        <el-select
          v-model="searchForm.class_id"
          placeholder="班级"
          clearable
          class="!w-44"
          @change="handleSearch"
        >
          <el-option
            v-for="c in classOptions"
            :key="c.id"
            :label="c.name"
            :value="c.id"
          />
        </el-select>
        <el-select
          v-model="searchForm.teacher_id"
          placeholder="教师"
          clearable
          class="!w-40"
          @change="handleSearch"
        >
          <el-option
            v-for="t in teacherOptions"
            :key="t.id"
            :label="t.name"
            :value="t.id"
          />
        </el-select>
        <el-select
          v-model="searchForm.term_id"
          placeholder="学期"
          clearable
          class="!w-44"
          @change="handleSearch"
        >
          <el-option
            v-for="t in termOptions"
            :key="t.id"
            :label="t.name"
            :value="t.id"
          />
        </el-select>
        <el-button type="primary" @click="handleSearch">搜索</el-button>
        <el-button @click="handleReset">重置</el-button>
      </div>

      <el-table v-loading="loading" :data="dataList" border stripe>
        <el-table-column type="index" label="#" width="60" align="center" />
        <el-table-column prop="class_name" label="班级" min-width="140" />
        <el-table-column prop="course_name" label="课程" min-width="140" />
        <el-table-column label="任课教师" min-width="120">
          <template #default="{ row }">
            {{ row.teacher_name || "未指定" }}
          </template>
        </el-table-column>
        <el-table-column label="生效学期" min-width="140">
          <template #default="{ row }">
            {{ row.term_name || "长期有效" }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)"
              >编辑</el-button
            >
            <el-button link type="danger" @click="handleDelete(row)"
              >删除</el-button
            >
          </template>
        </el-table-column>
        <template #empty>
          <AppEmpty
            title="还没维护任课关系"
            description="新增一条后，该教师即可看到对应班级的课表 / 考勤 / 成绩 / 课评"
          />
        </template>
      </el-table>

      <div class="page-card__footer">
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
    </div>

    <!-- 新增/编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="480px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
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
        <el-form-item label="任课教师">
          <el-select
            v-model="form.teacher_id"
            placeholder="可留空（未定教师）"
            clearable
            class="!w-full"
          >
            <el-option
              v-for="t in teacherOptions"
              :key="t.id"
              :label="t.name"
              :value="t.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="生效学期">
          <el-select
            v-model="form.term_id"
            placeholder="可留空（长期有效）"
            clearable
            class="!w-full"
          >
            <el-option
              v-for="t in termOptions"
              :key="t.id"
              :label="t.name"
              :value="t.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>
