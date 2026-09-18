<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  getLeadList,
  createLead,
  updateLead,
  followLead,
  updateLeadStatus,
  convertLead,
  deleteLead,
  getChannelStats,
  getAllCourses,
  getAllClasses
} from "@/api/attendance";
import { useUserStoreHook } from "@/store/modules/user";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "RecruitLeads"
});

const isAdmin = computed(() => useUserStoreHook().roles.includes("admin"));
const activeTab = ref("list");
const loading = ref(false);
const dataList = ref<any[]>([]);
const searchForm = reactive({ keyword: "", status: "", source: "" });
const pagination = reactive({ page: 1, pageSize: 10, total: 0 });

const SOURCE_OPTIONS = ["转介绍", "线上", "地推", "广告"];
const STATUS_OPTIONS = ["新线索", "跟进中", "已转化", "已流失"];
const STATUS_TAG = {
  新线索: "primary",
  跟进中: "warning",
  已转化: "success",
  已流失: "info"
} as Record<string, string>;
const SOURCE_TAG = {
  转介绍: "success",
  线上: "primary",
  地推: "warning",
  广告: "info"
} as Record<string, string>;

const courseOptions = ref<any[]>([]);
const classOptions = ref<any[]>([]);

// 新增/编辑弹窗
const editVisible = ref(false);
const editMode = ref<"create" | "edit">("create");
const editForm = reactive({
  id: 0,
  name: "",
  phone: "",
  intent_course_id: "",
  source: "转介绍",
  remark: ""
});
const submitting = ref(false);

// 跟进弹窗
const followVisible = ref(false);
const followData = ref<any>(null);
const followContent = ref("");
const followRecords = ref<any[]>([]);

// 转化弹窗
const convertVisible = ref(false);
const convertForm = reactive({
  id: 0,
  name: "",
  class_id: "",
  course_id: "",
  amount: 0,
  remark: ""
});

// 渠道统计
const channelLoading = ref(false);
const channelList = ref<any[]>([]);
const channelSummary = ref<any>(null);

function loadData() {
  loading.value = true;
  const params: Record<string, any> = {
    ...searchForm,
    page: pagination.page,
    pageSize: pagination.pageSize
  };
  getLeadList(params)
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
  searchForm.keyword = "";
  searchForm.status = "";
  searchForm.source = "";
  handleSearch();
}

function loadChannels() {
  channelLoading.value = true;
  getChannelStats()
    .then((res: any) => {
      if (res.success) {
        channelList.value = res.data.list;
        channelSummary.value = res.data.summary;
      }
    })
    .finally(() => (channelLoading.value = false));
}

function openCreate() {
  editMode.value = "create";
  Object.assign(editForm, {
    id: 0,
    name: "",
    phone: "",
    intent_course_id: "",
    source: "转介绍",
    remark: ""
  });
  editVisible.value = true;
}

function openEdit(row: any) {
  editMode.value = "edit";
  Object.assign(editForm, {
    id: row.id,
    name: row.name,
    phone: row.phone,
    intent_course_id: row.course_id ?? "",
    source: row.source,
    remark: row.remark
  });
  editVisible.value = true;
}

function handleSave() {
  if (!editForm.name.trim()) {
    ElMessage.warning("请输入线索姓名");
    return;
  }
  submitting.value = true;
  const payload = {
    name: editForm.name.trim(),
    phone: editForm.phone,
    intent_course_id: editForm.intent_course_id
      ? Number(editForm.intent_course_id)
      : null,
    source: editForm.source,
    remark: editForm.remark
  };
  const req =
    editMode.value === "create"
      ? createLead(payload)
      : updateLead(editForm.id, payload);
  req
    .then((res: any) => {
      if (res.success) {
        ElMessage.success(
          editMode.value === "create" ? "线索已登记" : "修改成功"
        );
        editVisible.value = false;
        handleSearch();
      }
    })
    .finally(() => (submitting.value = false));
}

function openFollow(row: any) {
  followData.value = row;
  followContent.value = "";
  try {
    followRecords.value = JSON.parse(row.follow_records || "[]");
  } catch {
    followRecords.value = [];
  }
  followVisible.value = true;
}

function handleFollow() {
  if (!followContent.value.trim()) {
    ElMessage.warning("请填写跟进内容");
    return;
  }
  submitting.value = true;
  followLead(followData.value.id, { content: followContent.value })
    .then((res: any) => {
      if (res.success) {
        ElMessage.success("跟进已记录");
        followRecords.value = res.data.records || [];
        followContent.value = "";
        handleSearch();
      }
    })
    .finally(() => (submitting.value = false));
}

function handleStatus(row: any, status: string) {
  ElMessageBox.confirm(`确定将该线索标记为「${status}」吗？`, "提示", {
    type: "warning",
    confirmButtonText: "确认",
    cancelButtonText: "取消"
  })
    .then(() => {
      updateLeadStatus(row.id, { status }).then((res: any) => {
        if (res.success) {
          ElMessage.success("操作成功");
          handleSearch();
          loadChannels();
        }
      });
    })
    .catch(() => {});
}

function openConvert(row: any) {
  Object.assign(convertForm, {
    id: row.id,
    name: row.name ?? "",
    class_id: "",
    course_id: row.course_id ?? "",
    amount: 0,
    remark: ""
  });
  convertVisible.value = true;
}

function handleConvert() {
  if (!convertForm.class_id) {
    ElMessage.warning("请选择学员班级");
    return;
  }
  submitting.value = true;
  convertLead(convertForm.id, {
    class_id: Number(convertForm.class_id),
    course_id: convertForm.course_id ? Number(convertForm.course_id) : null,
    amount: Number(convertForm.amount),
    remark: convertForm.remark
  })
    .then((res: any) => {
      if (res.success) {
        ElMessage.success(
          `转化成功，已生成学员档案（学号 ${res.data.student_no}），请到财务补录课时包与缴费`
        );
        convertVisible.value = false;
        handleSearch();
        loadChannels();
      }
    })
    .finally(() => (submitting.value = false));
}

function handleDelete(row: any) {
  ElMessageBox.confirm(`确定删除线索「${row.name}」吗？`, "提示", {
    type: "warning",
    confirmButtonText: "删除",
    cancelButtonText: "取消"
  })
    .then(() => {
      deleteLead(row.id).then((res: any) => {
        if (res.success) {
          ElMessage.success("删除成功");
          handleSearch();
          loadChannels();
        }
      });
    })
    .catch(() => {});
}

function fmtTime(t: string) {
  return t ? t.replace("T", " ") : "—";
}

onMounted(() => {
  loadData();
  getAllCourses().then((res: any) => {
    if (res.success) courseOptions.value = res.data || [];
  });
  getAllClasses().then((res: any) => {
    if (res.success) classOptions.value = res.data || [];
  });
});
</script>

<template>
  <div class="app-page">
    <AppPageHeader title="线索管理" description="招生线索跟进与转化" />
    <el-tabs
      v-model="activeTab"
      @tab-change="n => (n === 'channels' ? loadChannels() : null)"
    >
      <!-- ================= 线索列表 ================= -->
      <el-tab-pane label="线索列表" name="list">
        <el-card shadow="never">
          <!-- 筛选 -->
          <div class="mb-4 flex flex-wrap items-center gap-2">
            <el-input
              v-model="searchForm.keyword"
              placeholder="姓名 / 电话"
              clearable
              class="!w-44"
              @keyup.enter="handleSearch"
              @clear="handleSearch"
            />
            <el-select
              v-model="searchForm.status"
              placeholder="状态"
              clearable
              class="!w-32"
            >
              <el-option
                v-for="s in STATUS_OPTIONS"
                :key="s"
                :label="s"
                :value="s"
              />
            </el-select>
            <el-select
              v-model="searchForm.source"
              placeholder="来源渠道"
              clearable
              class="!w-32"
            >
              <el-option
                v-for="s in SOURCE_OPTIONS"
                :key="s"
                :label="s"
                :value="s"
              />
            </el-select>
            <el-button type="primary" @click="handleSearch">搜索</el-button>
            <el-button @click="handleReset">重置</el-button>
            <div class="flex-1" />
            <el-button type="primary" @click="openCreate">新增线索</el-button>
          </div>

          <!-- 表格 -->
          <div class="overflow-x-auto">
            <el-table
              v-loading="loading"
              :data="dataList"
              border
              stripe
              style="min-width: 1150px"
            >
              <el-table-column
                type="index"
                label="#"
                width="55"
                align="center"
              />
              <el-table-column
                prop="name"
                label="姓名"
                width="120"
                show-overflow-tooltip
              />
              <el-table-column prop="phone" label="电话" width="130">
                <template #default="{ row }">{{ row.phone || "—" }}</template>
              </el-table-column>
              <el-table-column
                prop="course_name"
                label="意向课程"
                min-width="110"
              >
                <template #default="{ row }">{{
                  row.course_name || "—"
                }}</template>
              </el-table-column>
              <el-table-column label="来源" width="90" align="center">
                <template #default="{ row }">
                  <el-tag
                    :type="SOURCE_TAG[row.source] || 'info'"
                    size="small"
                    >{{ row.source }}</el-tag
                  >
                </template>
              </el-table-column>
              <el-table-column label="状态" width="90" align="center">
                <template #default="{ row }">
                  <el-tag
                    :type="STATUS_TAG[row.status] || 'info'"
                    size="small"
                    >{{ row.status }}</el-tag
                  >
                </template>
              </el-table-column>
              <el-table-column
                prop="follow_count"
                label="跟进"
                width="70"
                align="center"
              />
              <el-table-column
                prop="follow_user_name"
                label="跟进人"
                width="100"
                align="center"
              >
                <template #default="{ row }">{{
                  row.follow_user_name || "—"
                }}</template>
              </el-table-column>
              <el-table-column label="转化学员" min-width="130">
                <template #default="{ row }">
                  <span v-if="row.converted_name"
                    >{{ row.converted_name }}（{{ row.student_no }}）</span
                  >
                  <span v-else class="text-gray-400">—</span>
                </template>
              </el-table-column>
              <el-table-column prop="created_at" label="创建时间" width="170">
                <template #default="{ row }">{{
                  fmtTime(row.created_at)
                }}</template>
              </el-table-column>
              <el-table-column label="操作" width="180" align="center">
                <template #default="{ row }">
                  <el-button
                    v-if="['新线索', '跟进中'].includes(row.status)"
                    link
                    type="primary"
                    @click="openFollow(row)"
                    >跟进</el-button
                  >
                  <el-button
                    v-if="['新线索', '跟进中'].includes(row.status)"
                    link
                    type="success"
                    @click="openConvert(row)"
                    >转化</el-button
                  >
                  <el-button
                    v-if="row.status === '新线索'"
                    link
                    type="warning"
                    @click="handleStatus(row, '跟进中')"
                    >跟进中</el-button
                  >
                  <el-button
                    v-if="['新线索', '跟进中'].includes(row.status)"
                    link
                    type="info"
                    @click="handleStatus(row, '已流失')"
                    >已流失</el-button
                  >
                  <el-button link type="primary" @click="openEdit(row)"
                    >编辑</el-button
                  >
                  <el-button
                    v-if="isAdmin"
                    link
                    type="danger"
                    @click="handleDelete(row)"
                    >删除</el-button
                  >
                </template>
              </el-table-column>
              <template #empty>
                <el-empty
                  description="暂无线索，点击右上角「新增线索」登记"
                  :image-size="60"
                />
              </template>
            </el-table>
          </div>

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
      </el-tab-pane>

      <!-- ================= 渠道统计 ================= -->
      <el-tab-pane label="渠道统计" name="channels">
        <el-card shadow="never">
          <div v-loading="channelLoading">
            <div v-if="channelSummary" class="mb-3 flex gap-8">
              <el-statistic title="线索总数" :value="channelSummary.total" />
              <el-statistic title="已转化" :value="channelSummary.converted" />
              <el-statistic
                title="转化率"
                :value="channelSummary.convert_rate"
                suffix="%"
              />
            </div>
            <el-table :data="channelList" border stripe>
              <el-table-column
                type="index"
                label="#"
                width="60"
                align="center"
              />
              <el-table-column prop="source" label="来源渠道" min-width="120" />
              <el-table-column
                prop="total"
                label="线索数"
                width="100"
                align="center"
              />
              <el-table-column
                prop="following"
                label="跟进中"
                width="100"
                align="center"
              />
              <el-table-column
                prop="converted"
                label="已转化"
                width="100"
                align="center"
              />
              <el-table-column label="转化率" min-width="120" align="center">
                <template #default="{ row }">
                  <span
                    :class="
                      row.convert_rate >= 50
                        ? 'text-green-600'
                        : 'text-orange-500'
                    "
                    >{{ row.convert_rate }}%</span
                  >
                </template>
              </el-table-column>
              <template #empty>
                <el-empty description="暂无线索数据" :image-size="60" />
              </template>
            </el-table>
          </div>
        </el-card>
      </el-tab-pane>
    </el-tabs>

    <!-- 新增/编辑线索 -->
    <el-dialog
      v-model="editVisible"
      :title="editMode === 'create' ? '新增线索' : '编辑线索'"
      width="480px"
      destroy-on-close
    >
      <el-form label-width="90px">
        <el-form-item label="姓名" required>
          <el-input
            v-model="editForm.name"
            placeholder="线索姓名"
            maxlength="20"
          />
        </el-form-item>
        <el-form-item label="电话">
          <el-input
            v-model="editForm.phone"
            placeholder="手机号"
            maxlength="20"
          />
        </el-form-item>
        <el-form-item label="意向课程">
          <el-select
            v-model="editForm.intent_course_id"
            placeholder="选择课程"
            clearable
            filterable
            class="w-full"
          >
            <el-option
              v-for="o in courseOptions"
              :key="o.id"
              :label="o.name"
              :value="String(o.id)"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="来源渠道">
          <el-select v-model="editForm.source" class="w-full">
            <el-option
              v-for="s in SOURCE_OPTIONS"
              :key="s"
              :label="s"
              :value="s"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="editForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSave"
          >保存</el-button
        >
      </template>
    </el-dialog>

    <!-- 跟进记录 -->
    <el-dialog
      v-model="followVisible"
      :title="`跟进记录 - ${followData?.name || ''}`"
      width="520px"
      destroy-on-close
    >
      <div class="mb-4 max-h-64 overflow-auto">
        <el-timeline v-if="followRecords.length">
          <el-timeline-item
            v-for="(r, i) in followRecords"
            :key="i"
            :timestamp="`${r.time} · ${r.user}`"
            placement="top"
          >
            {{ r.content }}
          </el-timeline-item>
        </el-timeline>
        <el-empty v-else description="暂无跟进记录" :image-size="50" />
      </div>
      <el-input
        v-model="followContent"
        type="textarea"
        :rows="2"
        placeholder="填写本次跟进内容…"
        @keydown.ctrl.enter="handleFollow"
      />
      <template #footer>
        <el-button @click="followVisible = false">关闭</el-button>
        <el-button type="primary" :loading="submitting" @click="handleFollow"
          >记录跟进</el-button
        >
      </template>
    </el-dialog>

    <!-- 标记转化：仅建档（学员档案 + 建档订单），课时包与缴费在财务模块补录 -->
    <el-dialog
      v-model="convertVisible"
      :title="convertForm.name ? `标记转化 - ${convertForm.name}` : '标记转化'"
      width="480px"
      destroy-on-close
    >
      <el-alert type="info" :closable="false" class="mb-3">
        <template #title>本步仅创建学员档案与建档订单</template>
        <div class="text-xs leading-5">
          <div>转化后请到「财务管理 → 报班管理」补录以下内容：</div>
          <div>
            <b>课时包（总课时）与缴费记录</b>
          </div>
          <div>未补录前，该学员的考勤不会扣减课时，也不会产生已确认收入。</div>
        </div>
      </el-alert>
      <el-form label-width="90px">
        <el-form-item label="学员班级" required>
          <el-select
            v-model="convertForm.class_id"
            placeholder="选择班级"
            filterable
            class="w-full"
          >
            <el-option
              v-for="o in classOptions"
              :key="o.id"
              :label="o.name"
              :value="String(o.id)"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="报名课程">
          <el-select
            v-model="convertForm.course_id"
            placeholder="默认取意向课程"
            clearable
            filterable
            class="w-full"
          >
            <el-option
              v-for="o in courseOptions"
              :key="o.id"
              :label="o.name"
              :value="String(o.id)"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="订单金额">
          <el-input-number
            v-model="convertForm.amount"
            :min="0"
            :precision="2"
            :step="100"
            class="w-full"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="convertForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="convertVisible = false">取消</el-button>
        <el-button type="success" :loading="submitting" @click="handleConvert"
          >确认转化</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>
