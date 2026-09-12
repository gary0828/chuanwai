<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import * as XLSX from "xlsx";
import {
  getStudentList,
  getAllClasses,
  exportStudents,
  importStudents,
  createStudent,
  updateStudent,
  deleteStudent
} from "@/api/attendance";

defineOptions({
  name: "Students"
});

const loading = ref(false);
const dataList = ref<any[]>([]);
const classOptions = ref<any[]>([]);
const searchForm = reactive({ class_id: "", name: "", student_no: "" });
const pagination = reactive({ page: 1, pageSize: 10, total: 0 });

const statusTag: Record<string, string> = {
  在读: "success",
  休学: "warning",
  退学: "danger"
};

// 新增/编辑弹窗
const dialogVisible = ref(false);
const dialogTitle = ref("新增学生");
const formRef = ref();
const form = reactive({
  id: null as number | null,
  student_no: "",
  name: "",
  gender: "男",
  phone: "",
  email: "",
  class_id: null as number | null,
  status: "在读",
  parent_name: "",
  parent_phone: "",
  source_channel: "",
  enroll_date: ""
});
const rules = {
  student_no: [{ required: true, message: "请输入学号", trigger: "blur" }],
  name: [{ required: true, message: "请输入姓名", trigger: "blur" }],
  class_id: [{ required: true, message: "请选择班级", trigger: "change" }]
};
const genderOptions = ["男", "女"];
const studentStatusOptions = ["在读", "休学", "退学"];
const sourceOptions = ["转介绍", "线上", "地推", "广告", "其他"];

// 导入结果
const importDialogVisible = ref(false);
const importResult = ref<any>(null);

/** 下载导入模板 */
function downloadTemplate() {
  const ws = XLSX.utils.json_to_sheet(
    [
      {
        学号: "20241001",
        姓名: "张三",
        性别: "男",
        手机号: "13800000000",
        邮箱: "zhangsan@example.com",
        班级: "软件工程一班",
        状态: "在读",
        家长姓名: "李四",
        家长电话: "13900000000",
        来源渠道: "转介绍",
        报名日期: "2024-09-01"
      }
    ],
    {
      header: [
        "学号",
        "姓名",
        "性别",
        "手机号",
        "邮箱",
        "班级",
        "状态",
        "家长姓名",
        "家长电话",
        "来源渠道",
        "报名日期"
      ]
    }
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "学生导入模板");
  XLSX.writeFile(wb, "学生导入模板.xlsx");
}

/** 解析并导入 Excel */
function handleImport(file: any) {
  const reader = new FileReader();
  reader.onload = (e: any) => {
    try {
      const wb = XLSX.read(e.target.result, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet);
      if (rows.length === 0) {
        ElMessage.warning("文件中没有数据");
        return;
      }
      const classMap: Record<string, number> = {};
      classOptions.value.forEach((c: any) => (classMap[c.name] = c.id));
      const records = rows.map((r, i) => {
        const className = String(r["班级"] || "").trim();
        return {
          student_no: String(r["学号"] || "").trim(),
          name: String(r["姓名"] || "").trim(),
          gender: String(r["性别"] || "男").trim() || "男",
          phone: String(r["手机号"] || "").trim(),
          email: String(r["邮箱"] || "").trim(),
          class_id: classMap[className] || null,
          status: String(r["状态"] || "在读").trim() || "在读",
          parent_name: String(r["家长姓名"] || "").trim(),
          parent_phone: String(r["家长电话"] || "").trim(),
          __line: i + 2
        };
      });
      const missingClass = records
        .filter(r => !r.class_id)
        .map(r => `第${r.__line}行（${r.student_no || r.name}）`);
      if (missingClass.length > 0) {
        ElMessage.warning(`以下行班级名称无法匹配：${missingClass.join("、")}`);
        return;
      }
      importStudents({ records }).then((res: any) => {
        if (res.success) {
          importResult.value = res.data;
          importDialogVisible.value = true;
          loadData();
        }
      });
    } catch (err) {
      ElMessage.error("文件解析失败，请上传 .xlsx 或 .csv 文件");
    }
  };
  reader.readAsArrayBuffer(file.raw);
  return false;
}

/** 导出当前筛选结果为 Excel */
function handleExport() {
  exportStudents(searchForm).then((res: any) => {
    if (res.success && res.data.list.length > 0) {
      const ws = XLSX.utils.json_to_sheet(res.data.list);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "学生名单");
      XLSX.writeFile(
        wb,
        `学生名单_${new Date().toISOString().slice(0, 10)}.xlsx`
      );
    } else {
      ElMessage.warning("没有可导出的数据");
    }
  });
}

function loadClasses() {
  getAllClasses().then((res: any) => {
    if (res.success) classOptions.value = res.data;
  });
}

function loadData() {
  loading.value = true;
  getStudentList({
    ...searchForm,
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
  Object.assign(searchForm, { class_id: "", name: "", student_no: "" });
  handleSearch();
}

function openAdd() {
  dialogTitle.value = "新增学生";
  Object.assign(form, {
    id: null,
    student_no: "",
    name: "",
    gender: "男",
    phone: "",
    email: "",
    class_id: null,
    status: "在读",
    parent_name: "",
    parent_phone: "",
    source_channel: "",
    enroll_date: ""
  });
  dialogVisible.value = true;
}

function openEdit(row: any) {
  dialogTitle.value = "编辑学生";
  Object.assign(form, {
    id: row.id,
    student_no: row.student_no,
    name: row.name,
    gender: row.gender || "男",
    phone: row.phone || "",
    email: row.email || "",
    class_id: row.class_id ?? null,
    status: row.status || "在读",
    parent_name: row.parent_name || "",
    parent_phone: row.parent_phone || "",
    source_channel: row.source_channel || "",
    enroll_date: row.enroll_date || ""
  });
  dialogVisible.value = true;
}

function handleSubmit() {
  formRef.value.validate((valid: boolean) => {
    if (!valid) return;
    const payload: Record<string, any> = {
      student_no: form.student_no,
      name: form.name,
      gender: form.gender,
      phone: form.phone,
      email: form.email,
      class_id: form.class_id,
      status: form.status,
      parent_name: form.parent_name,
      parent_phone: form.parent_phone,
      source_channel: form.source_channel,
      enroll_date: form.enroll_date
    };
    const api = form.id
      ? updateStudent(form.id, payload)
      : createStudent(payload);
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
    `确定删除学生「${row.name}（${row.student_no}）」吗？其考勤/请假/通知等历史记录将一并清理。`,
    "删除确认",
    { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" }
  )
    .then(() => {
      deleteStudent(row.id).then((res: any) => {
        if (res.success) {
          ElMessage.success("删除成功");
          loadData();
        }
      });
    })
    .catch(() => {});
}

onMounted(() => {
  loadClasses();
  loadData();
});
</script>

<template>
  <div class="p-4">
    <el-card shadow="never">
      <!-- 搜索 -->
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <el-select
          v-model="searchForm.class_id"
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
        <el-input
          v-model="searchForm.name"
          placeholder="姓名"
          clearable
          class="!w-36"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-input
          v-model="searchForm.student_no"
          placeholder="学号"
          clearable
          class="!w-44"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-button type="primary" @click="handleSearch">搜索</el-button>
        <el-button @click="handleReset">重置</el-button>
        <div class="flex-1" />
        <el-button type="primary" @click="openAdd">新增学生</el-button>
        <el-button @click="downloadTemplate">模板</el-button>
        <el-upload
          :show-file-list="false"
          :before-upload="handleImport"
          accept=".xlsx,.xls,.csv"
        >
          <el-button>导入</el-button>
        </el-upload>
        <el-button @click="handleExport">导出</el-button>
      </div>

      <!-- 表格 -->
      <el-table v-loading="loading" :data="dataList" border stripe>
        <el-table-column type="index" label="#" width="60" align="center" />
        <el-table-column prop="student_no" label="学号" min-width="110" />
        <el-table-column prop="name" label="姓名" min-width="100" />
        <el-table-column prop="gender" label="性别" width="80" align="center" />
        <el-table-column prop="class_name" label="班级" min-width="140" />
        <el-table-column prop="phone" label="手机号" min-width="130" />
        <el-table-column label="家长" min-width="160">
          <template #default="{ row }">
            <template v-if="row.parent_name || row.parent_phone">
              <div>{{ row.parent_name || "—" }}</div>
              <div class="text-xs text-gray-500">
                {{ row.parent_phone || "" }}
              </div>
            </template>
            <span v-else class="text-gray-400">未填写</span>
          </template>
        </el-table-column>
        <el-table-column label="来源渠道" width="110" align="center">
          <template #default="{ row }">
            <span v-if="row.source_channel">{{ row.source_channel }}</span>
            <span v-else class="text-gray-400">—</span>
          </template>
        </el-table-column>
        <el-table-column label="报名日期" width="120" align="center">
          <template #default="{ row }">
            <span v-if="row.enroll_date">{{ row.enroll_date }}</span>
            <span v-else class="text-gray-400">—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="statusTag[row.status] as any" size="small">
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" align="center" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openEdit(row)"
              >编辑</el-button
            >
            <el-button type="danger" link @click="handleDelete(row)"
              >删除</el-button
            >
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无学生数据" :image-size="60" />
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

    <!-- 新增/编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="520px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="学号" prop="student_no">
          <el-input v-model="form.student_no" placeholder="学号（全局唯一）" />
        </el-form-item>
        <el-form-item label="姓名" prop="name">
          <el-input v-model="form.name" placeholder="请输入姓名" />
        </el-form-item>
        <el-form-item label="性别">
          <el-select v-model="form.gender" class="!w-full">
            <el-option
              v-for="g in genderOptions"
              :key="g"
              :label="g"
              :value="g"
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
        <el-form-item label="手机号">
          <el-input v-model="form.phone" placeholder="学生手机号（选填）" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="form.email" placeholder="选填" />
        </el-form-item>
        <el-form-item label="学籍状态">
          <el-select v-model="form.status" class="!w-full">
            <el-option
              v-for="s in studentStatusOptions"
              :key="s"
              :label="s"
              :value="s"
            />
          </el-select>
        </el-form-item>
        <el-divider content-position="left">家长信息</el-divider>
        <el-form-item label="家长姓名">
          <el-input v-model="form.parent_name" placeholder="家长姓名（选填）" />
        </el-form-item>
        <el-form-item label="家长电话">
          <el-input
            v-model="form.parent_phone"
            placeholder="家长联系电话（选填）"
          />
        </el-form-item>
        <el-divider content-position="left">来源与报名</el-divider>
        <el-form-item label="来源渠道">
          <el-select
            v-model="form.source_channel"
            placeholder="请选择来源渠道（选填）"
            class="w-full"
            clearable
          >
            <el-option
              v-for="s in sourceOptions"
              :key="s"
              :label="s"
              :value="s"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="报名日期">
          <el-date-picker
            v-model="form.enroll_date"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="请选择报名日期（选填）"
            class="w-full"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="false" @click="handleSubmit"
          >确定</el-button
        >
      </template>
    </el-dialog>

    <!-- 导入结果弹窗 -->
    <el-dialog v-model="importDialogVisible" title="导入结果" width="560px">
      <template v-if="importResult">
        <el-result
          :icon="importResult.failCount > 0 ? 'warning' : 'success'"
          :title="`成功 ${importResult.successCount} 条，失败 ${importResult.failCount} 条`"
          :sub-title="`共处理 ${importResult.total} 条记录`"
        >
          <template #extra>
            <el-button type="primary" @click="importDialogVisible = false"
              >知道了</el-button
            >
          </template>
        </el-result>
        <el-table
          v-if="importResult.failCount > 0"
          :data="importResult.fails"
          border
          max-height="260"
          class="mt-2"
        >
          <el-table-column prop="line" label="行号" width="70" align="center" />
          <el-table-column prop="student_no" label="学号" min-width="110" />
          <el-table-column prop="name" label="姓名" min-width="90" />
          <el-table-column prop="reason" label="失败原因" min-width="170" />
        </el-table>
      </template>
    </el-dialog>
  </div>
</template>
