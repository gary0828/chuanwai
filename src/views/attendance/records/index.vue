<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { ElMessage } from "element-plus";
import * as XLSX from "xlsx";
import {
  getAttendanceRecords,
  getAllCourses,
  getAllClasses,
  saveAttendanceBatch
} from "@/api/attendance";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "AttendanceRecords"
});

const loading = ref(false);
const dataList = ref<any[]>([]);
const courseOptions = ref<any[]>([]);
const classOptions = ref<any[]>([]);
const filter = reactive({
  date_start: "",
  date_end: "",
  course_id: "",
  class_id: "",
  status: ""
});
const pagination = reactive({ page: 1, pageSize: 10, total: 0 });

const statusTag: Record<string, string> = {
  正常: "success",
  迟到: "warning",
  早退: "warning",
  缺勤: "danger",
  请假: "info"
};

// 修改记录
const editDialogVisible = ref(false);
const editForm = reactive({
  id: null as number | null,
  student_id: null as number | null,
  date: "",
  course_id: null as number | null,
  // ★ 2026-09-26 新增：记录归属的课次。带上它，后端才会走「按课次更新」分支；
  //   不带的话会走 legacy 分支**新插入一行**，导致同一节课同一学生出现两条考勤
  //   （统计双计 + 课时按另一分区状态多扣/多回补）。
  session_id: null as number | null,
  status: "正常",
  remark: "",
  student_name: "",
  course_name: ""
});
const statusOptions = ["正常", "迟到", "早退", "缺勤", "请假"];

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
  getAttendanceRecords({
    ...filter,
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
  Object.assign(filter, {
    date_start: "",
    date_end: "",
    course_id: "",
    class_id: "",
    status: ""
  });
  handleSearch();
}

function openEdit(row: any) {
  Object.assign(editForm, {
    id: row.id,
    student_id: row.student_id,
    date: row.date,
    course_id: row.course_id,
    session_id: row.session_id ?? null, // ★ 关键：带上课次归属（见 editForm 注释）
    status: row.status,
    remark: row.remark,
    student_name: row.student_name,
    course_name: row.course_name
  });
  editDialogVisible.value = true;
}

function handleSave() {
  saveAttendanceBatch({
    date: editForm.date,
    course_id: editForm.course_id,
    // ★ 带上 session_id：有课次的记录走「按课次更新」，不会新增重复行
    ...(editForm.session_id ? { session_id: editForm.session_id } : {}),
    records: [
      {
        student_id: editForm.student_id,
        status: editForm.status,
        remark: editForm.remark
      }
    ]
  }).then((res: any) => {
    if (res.success) {
      ElMessage.success("修改成功");
      editDialogVisible.value = false;
      loadData();
    }
  });
}

/** 导出当前筛选的考勤记录（前 500 条） */
function handleExport() {
  getAttendanceRecords({ ...filter, page: 1, pageSize: 500 }).then(
    (res: any) => {
      if (res.success && res.data.list.length > 0) {
        const list = res.data.list.map(r => ({
          日期: r.date,
          学号: r.student_no,
          姓名: r.student_name,
          班级: r.class_name,
          课程: r.course_name,
          状态: r.status,
          备注: r.remark
        }));
        const ws = XLSX.utils.json_to_sheet(list);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "考勤记录");
        XLSX.writeFile(
          wb,
          `考勤记录_${new Date().toISOString().slice(0, 10)}.xlsx`
        );
      } else {
        ElMessage.warning("没有可导出的数据");
      }
    }
  );
}

onMounted(() => {
  loadOptions();
  loadData();
});
</script>

<template>
  <div class="app-page">
    <AppPageHeader title="考勤记录" description="查询与订正历史考勤；缺勤不扣课时" />
    <el-card shadow="never">
      <!-- 筛选 -->
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <el-date-picker
          v-model="filter.date_start"
          type="date"
          placeholder="开始日期"
          value-format="YYYY-MM-DD"
          class="!w-36"
        />
        <el-date-picker
          v-model="filter.date_end"
          type="date"
          placeholder="结束日期"
          value-format="YYYY-MM-DD"
          class="!w-36"
        />
        <el-select
          v-model="filter.course_id"
          placeholder="课程"
          clearable
          class="!w-36"
          @change="handleSearch"
        >
          <el-option
            v-for="item in courseOptions"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
        <el-select
          v-model="filter.class_id"
          placeholder="班级"
          clearable
          class="!w-40"
          @change="handleSearch"
        >
          <el-option
            v-for="item in classOptions"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
        <el-select
          v-model="filter.status"
          placeholder="状态"
          clearable
          class="!w-28"
          @change="handleSearch"
        >
          <el-option
            v-for="s in statusOptions"
            :key="s"
            :label="s"
            :value="s"
          />
        </el-select>
        <el-button type="primary" @click="handleSearch">搜索</el-button>
        <el-button @click="handleReset">重置</el-button>
        <div class="flex-1" />
        <el-button type="primary" plain @click="handleExport">导出</el-button>
      </div>

      <!-- 表格 -->
      <el-table v-loading="loading" :data="dataList" border stripe>
        <el-table-column type="index" label="#" width="60" align="center" />
        <el-table-column prop="date" label="日期" width="120" />
        <el-table-column prop="student_no" label="学号" min-width="110" />
        <el-table-column prop="student_name" label="姓名" min-width="90" />
        <el-table-column prop="class_name" label="班级" min-width="140" />
        <el-table-column prop="course_name" label="课程" min-width="120" />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="statusTag[row.status] as any" size="small">
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          prop="remark"
          label="备注"
          min-width="140"
          show-overflow-tooltip
        />
        <el-table-column prop="updated_at" label="更新时间" min-width="170" />
        <el-table-column label="操作" width="90" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)"
              >修改</el-button
            >
          </template>
        </el-table-column>
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

    <!-- 修改考勤记录弹窗 -->
    <el-dialog v-model="editDialogVisible" title="修改考勤记录" width="460px">
      <el-form label-width="80px">
        <el-form-item label="学生">
          <span
            >{{ editForm.student_name }}（{{ editForm.date }} ·
            {{ editForm.course_name }}）</span
          >
        </el-form-item>
        <el-form-item label="状态">
          <el-tooltip
            :disabled="editForm.status !== '请假'"
            content="标记请假将自动生成请假申请，需在「请假管理」中审批"
            placement="top"
          >
            <el-select v-model="editForm.status" class="!w-full">
              <el-option
                v-for="s in statusOptions"
                :key="s"
                :label="s"
                :value="s"
              />
            </el-select>
          </el-tooltip>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="editForm.remark" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
