<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import * as XLSX from "xlsx";
import {
  getStudentList,
  getAllClasses,
  exportStudents,
  importStudents,
  createStudent,
  updateStudent,
  deleteStudent,
  getStudentDeleteImpact,
  restoreStudent,
  createClass,
  getUserList
} from "@/api/attendance";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "Students"
});

const loading = ref(false);
const dataList = ref<any[]>([]);
const classOptions = ref<any[]>([]);
const teacherOptions = ref<any[]>([]);
const searchForm = reactive({
  class_id: "",
  name: "",
  student_no: "",
  // v30 软删："" = 只看在读档案（默认）｜"1" = 只看已删除｜"all" = 全部
  deleted: ""
});
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
  class_id: [{ required: true, message: "请选择班级", trigger: "change" }],
  // P2-3：此前手机号完全没校验，`abc123` 也能入库；
  // 允许留空（家长/学员可能只留一个联系方式），填了就必须是 11 位手机号
  phone: [
    {
      validator: (_r: any, value: string, callback: (e?: Error) => void) => {
        if (!value) return callback();
        if (!/^1[3-9]\d{9}$/.test(value))
          callback(new Error("手机号格式不正确"));
        else callback();
      },
      trigger: "blur"
    }
  ]
};
const genderOptions = ["男", "女"];
const studentStatusOptions = ["在读", "休学", "退学"];
const sourceOptions = ["转介绍", "线上", "地推", "广告", "其他"];

// 导入结果
const importDialogVisible = ref(false);
const importResult = ref<any>(null);
// ★ 2026-09-26 新增：导入处理中状态（此前无任何 loading，大文件时用户会以为「没反应」）
const importing = ref(false);

/** Excel 日期单元格兼容：可能是 Date、数字序列号，或文本 */
function toDateStr(v: any): string {
  if (v === undefined || v === null || v === "") return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  if (v instanceof Date) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  if (typeof v === "number") {
    // Excel 1900 日期系统序列号 → 公历日期
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  return String(v).trim();
}

/** 下载导入模板 */
function downloadTemplate() {
  // ★ 示例班级用系统里真实存在的班级名 —— 此前写死「软件工程一班」，用户照抄必然报「班级无法匹配」
  const sampleClass =
    classOptions.value[0]?.name || "请填写系统中已存在的班级名称";
  const ws = XLSX.utils.json_to_sheet(
    [
      {
        学号: "20241001",
        姓名: "张三",
        性别: "男",
        手机号: "13800000000",
        邮箱: "zhangsan@example.com",
        班级: sampleClass,
        班主任: "",
        年级: "",
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
        "班主任",
        "年级",
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

/** 解析并导入 Excel
 *
 * ★ 2026-09-26 修复（用户反馈「批量上传学生没有任何反应」）：
 *   el-upload 的 `before-upload` 传入的是 **UploadRawFile**（= 原生 File + uid），
 *   它**没有 `raw` 字段** —— `raw` 只存在于 change 事件的 UploadFile 上。
 *   原代码写 `reader.readAsArrayBuffer(file.raw)`，实参是 undefined → FileReader 抛 TypeError；
 *   而 try/catch 只包住 `reader.onload` 的**内部**，这个抛错无人接管
 *   → 无请求、无消息、无弹窗，用户看到的正是「点了没反应」。
 *   现改为直接读 `file`，并补齐 loading / 业务失败 / 读取异常 三条反馈路径。
 */
/**
 * ★ 2026-09-30 校区反馈④：导入时自动建班
 *
 * 此前行为：班级名在系统里不存在 → **整批取消**并提示「请先到班级管理核对」。
 * 校区实际场景是拿一张名单直接导入，故改为：缺失的班级**自动创建**，并把学员分进去。
 *
 * 规则（用户 2026-09-30 拍板）：
 *  - 同名班级只建一次（classMap 就地补全，后续行直接命中）
 *  - 模板「班主任」列按**姓名匹配教师账号** → 设为班主任；匹配不到 → 建无班主任的班并提示
 *  - 模板「年级」列写入班级 grade
 *  - 教师列表按需拉取（首次调用时）
 */
async function autoCreateMissingClasses(
  rows: any[],
  classMap: Record<string, number>
) {
  const created: string[] = [];
  const missed: string[] = [];
  const pending = rows
    .map(r => String(r["班级"] || "").trim())
    .filter(name => name && !classMap[name]);
  const names = [...new Set(pending)];
  if (names.length === 0) return { ok: true, created, missed };

  if (!teacherOptions.value.length) {
    const tRes: any = await getUserList({ role: "teacher", pageSize: 200 });
    if (tRes.success) teacherOptions.value = tRes.data.list || [];
  }
  const teacherByName = new Map<string, number>();
  teacherOptions.value.forEach((t: any) =>
    teacherByName.set(String(t.name || "").trim(), t.id)
  );

  for (const name of names) {
    const row = rows.find(r => String(r["班级"] || "").trim() === name) || {};
    const grade = String(row["年级"] || "").trim();
    const headName = String(row["班主任"] || "").trim();
    let headId: number | null = null;
    if (headName) {
      headId = teacherByName.get(headName) ?? null;
      if (!headId) missed.push(headName);
    }
    const res: any = await createClass({
      name,
      grade,
      head_teacher: headName,
      head_teacher_id: headId
    });
    if (res.success) {
      classMap[name] = res.data.id;
      created.push(name);
    } else {
      ElMessage.error(
        `班级「${name}」自动创建失败：${res.message || "未知原因"}`
      );
      return { ok: false, created, missed };
    }
  }
  if (created.length > 0) {
    ElMessage.success(
      `已自动创建 ${created.length} 个班级：${created.join("、")}`
    );
  }
  return { ok: true, created, missed };
}

function handleImport(file: any) {
  if (importing.value) return false; // 防重复提交
  importing.value = true;
  const done = () => {
    importing.value = false;
  };

  const reader = new FileReader();
  reader.onerror = () => {
    done();
    ElMessage.error("文件读取失败，请重新选择文件后再试");
  };
  reader.onload = async (e: any) => {
    try {
      const wb = XLSX.read(e.target.result, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet);
      if (rows.length === 0) {
        done();
        ElMessage.warning("文件中没有数据，请确认第一张工作表里有数据行");
        return;
      }
      const classMap: Record<string, number> = {};
      classOptions.value.forEach((c: any) => (classMap[c.name] = c.id));

      // ★ 2026-09-30 校区反馈④：缺失班级自动创建后再导入
      const autoRes = await autoCreateMissingClasses(rows, classMap);
      if (!autoRes.ok) {
        done();
        return;
      }

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
          // ★ 2026-09-26 补：模板里本就有这两列，此前未映射 → 用户填了会静默丢失
          source_channel: String(r["来源渠道"] || "").trim(),
          enroll_date: toDateStr(r["报名日期"]),
          __line: i + 2
        };
      });
      const missingClass = records
        .filter(r => !r.class_id)
        .map(r => `第${r.__line}行（${r.student_no || r.name || "无学号"}）`);
      if (missingClass.length > 0) {
        done();
        ElMessage.warning(
          `以下行没有填写班级（或班级创建失败），已取消导入：${missingClass.join("、")}`
        );
        return;
      }
      importStudents({ records })
        .then((res: any) => {
          if (res.success) {
            importResult.value = {
              ...res.data,
              __createdClasses: autoRes.created,
              __teacherMissed: autoRes.missed
            };
            importDialogVisible.value = true;
            loadData();
          } else {
            // 业务失败（HTTP 200 但 success=false）此前完全静默
            ElMessage.error(res.message || "导入失败，请稍后重试");
          }
        })
        .catch(() => {
          // HTTP 层失败已由全局响应拦截器弹提示，这里只需保证按钮状态恢复
        })
        .finally(done);
    } catch (err) {
      done();
      ElMessage.error(
        "文件解析失败，请上传 .xlsx / .xls / .csv 文件，并确认表头与「模板」一致"
      );
    }
  };
  // ★ 这里必须传 file 本身（UploadRawFile），不是 file.raw
  reader.readAsArrayBuffer(file);
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
  Object.assign(searchForm, {
    class_id: "",
    name: "",
    student_no: "",
    deleted: ""
  });
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

/**
 * 删除学员
 * ★ 2026-09-26 改造：先调「删除影响预览」，把**具体会连带清理多少条**摆进确认框。
 *   原先确认框是一句写死的文案，用户只能盲确认；而后端其实早就算好了条数，
 *   只是放在了 DELETE 的响应里（删完才返回）—— 属于「代价不可见」。
 *
 * ★ 2026-10-18（v30）：删除已改为**软删**，所以文案必须跟着改 ——
 *   还写「将同时清理 XXX 条」会吓到用户，实际一条都不会删。
 *   现在改为「档案移入已删除，历史数据全部保留，可恢复」，条数只作为「关联情况」展示。
 */
function handleDelete(row: any) {
  getStudentDeleteImpact(row.id).then((res: any) => {
    if (!res.success) return;
    const { cascade = {}, orderCount = 0, blocked } = res.data || {};

    // 有报班/缴费记录时后端会拒绝 —— 直接给出可执行的出路，不让用户白点一次
    if (blocked) {
      ElMessageBox.alert(
        `「${row.name}」有 ${orderCount} 条报班/缴费记录，不能直接删除。\n` +
          `如需下线，请改为把学籍状态设为「退学」（档案保留，不再计入在读）。`,
        "无法删除",
        { type: "warning", confirmButtonText: "知道了" }
      ).catch(() => {});
      return;
    }

    const items = Object.entries(cascade as Record<string, number>).map(
      ([label, count]) => `${label} ${count} 条`
    );
    const detail = items.length
      ? `\n该学员有 ${items.join("、")}，这些记录都会保留。`
      : "\n该学员暂无关联历史记录。";
    ElMessageBox.confirm(
      `删除「${row.name}（${row.student_no}）」后，档案将移入「已删除」并从列表隐藏。` +
        `${detail}\n历史数据不会丢失，管理员可随时恢复。`,
      "删除确认",
      {
        type: "warning",
        confirmButtonText: "移入已删除",
        cancelButtonText: "取消"
      }
    )
      .then(() => {
        deleteStudent(row.id).then((res: any) => {
          if (res.success) {
            ElMessage.success("已移入「已删除」，可随时恢复");
            loadData();
          }
        });
      })
      .catch(() => {});
  });
}

/** 恢复已删除的学员（v30，仅 admin；后端会再校验一次角色） */
function handleRestore(row: any) {
  ElMessageBox.confirm(
    `恢复「${row.name}（${row.student_no}）」？恢复后会重新出现在学员列表、班级名单与点名名单中。`,
    "恢复确认",
    { type: "info", confirmButtonText: "恢复", cancelButtonText: "取消" }
  )
    .then(() => {
      restoreStudent(row.id).then((res: any) => {
        if (res.success) {
          ElMessage.success("已恢复");
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

// v29：跳转「学员档案」—— 剩余课时 / 剩余学费 / 缴费退费 / 课时流水汇总页
const router = useRouter();
function openProfile(row: any) {
  router.push({ path: "/student/profile", query: { id: String(row.id) } });
}
</script>

<template>
  <div class="app-page">
    <AppPageHeader title="学生管理" description="学员档案、分班与批量导入" />
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
        <el-select
          v-model="searchForm.deleted"
          placeholder="档案状态"
          clearable
          class="!w-32"
          @change="handleSearch"
        >
          <el-option label="在读档案" value="" />
          <el-option label="已删除" value="1" />
          <el-option label="全部" value="all" />
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
          :disabled="importing"
          accept=".xlsx,.xls,.csv"
        >
          <el-button :loading="importing">{{
            importing ? "导入中…" : "导入"
          }}</el-button>
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
        <!-- v30 软删：档案是否已移入「已删除」 -->
        <el-table-column label="档案" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.deleted_at" type="info" size="small"
              >已删除</el-tag
            >
            <span v-else class="text-gray-400">正常</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="190" align="center" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openProfile(row)"
              >档案</el-button
            >
            <el-button
              v-if="!row.deleted_at"
              type="primary"
              link
              @click="openEdit(row)"
              >编辑</el-button
            >
            <el-button
              v-if="row.deleted_at"
              type="success"
              link
              @click="handleRestore(row)"
              >恢复</el-button
            >
            <el-button v-else type="danger" link @click="handleDelete(row)"
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
        <el-form-item label="手机号" prop="phone">
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

        <!-- ★ 2026-09-30 校区反馈④：导入时自动建班的明细（此前班级不存在会整批取消） -->
        <el-alert
          v-if="importResult.__createdClasses?.length"
          type="success"
          :closable="false"
          class="mt-2"
          :title="`已自动创建 ${importResult.__createdClasses.length} 个班级`"
          :description="importResult.__createdClasses.join('、')"
        />
        <el-alert
          v-if="importResult.__teacherMissed?.length"
          type="warning"
          :closable="false"
          class="mt-2"
          :title="`班主任未匹配到教师账号：${[...new Set(importResult.__teacherMissed)].join('、')}（这些班级暂未设班主任，可到班级管理补）`"
        />
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
