<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { ElMessage } from "element-plus";
import type { UploadRawFile, UploadRequestOptions } from "element-plus";
import { getSettings, updateSettings } from "@/api/attendance";
import {
  getSiteInfoAdmin,
  updateSiteInfo,
  uploadSiteImage,
  type SiteInfo
} from "@/api/site";
import { useSiteStore } from "@/store/modules/site";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "SysSettings"
});

const siteStore = useSiteStore();

/* ---------------- 站点信息（机构名称 / Logo / 页脚） ---------------- */

const siteLoading = ref(false);
const siteSaving = ref(false);
const logoUploading = ref(false);
const faviconUploading = ref(false);

/** 表单：空串表示「未配置」，保存时原样提交即为清空 */
const siteForm = reactive<Record<keyof SiteInfo, string>>({
  "site.name": "",
  "site.title": "",
  "site.orgName": "",
  "site.sinceYear": "",
  "site.slogan": "",
  "site.contact": "",
  "site.address": "",
  "site.icp": "",
  "site.policeNo": "",
  "site.copyrightExtra": "",
  "site.logo": "",
  "site.favicon": ""
});

/** 上传中显示的本地预览地址（未保存也能看到效果） */
const logoTempUrl = ref("");
const faviconTempUrl = ref("");

const defaultLogo = new URL("/logo.svg", import.meta.url).href;

const logoPreview = computed(
  () => logoTempUrl.value || siteForm["site.logo"] || defaultLogo
);
const faviconPreview = computed(
  () => faviconTempUrl.value || siteForm["site.favicon"]
);

function loadSiteInfo() {
  siteLoading.value = true;
  getSiteInfoAdmin()
    .then((res: any) => {
      if (res?.success && res.data) {
        Object.keys(siteForm).forEach(k => {
          siteForm[k] = res.data[k] ?? "";
        });
      }
    })
    .finally(() => (siteLoading.value = false));
}

function handleSaveSite() {
  // 年份做基本校验：只接受 4 位数字或空
  const y = siteForm["site.sinceYear"].trim();
  if (y && !/^\d{4}$/.test(y)) {
    ElMessage.warning("起始年份请填 4 位数字，例如 2020");
    return;
  }
  siteSaving.value = true;
  updateSiteInfo({ ...siteForm } as Partial<SiteInfo>)
    .then((res: any) => {
      if (res?.success) {
        // 立即同步到全局 store：标题 / Logo / 页脚无需刷新即生效
        siteStore.setInfo(res.data);
        siteStore.applyFavicon();
        ElMessage.success("站点信息已保存");
      }
    })
    .finally(() => (siteSaving.value = false));
}

/** 上传前校验类型与大小（后端还有魔数校验兜底） */
function beforeUpload(file: UploadRawFile) {
  const ok = [
    "image/png",
    "image/jpeg",
    "image/svg+xml",
    "image/webp",
    "image/x-icon",
    "image/vnd.microsoft.icon"
  ];
  if (!ok.includes(file.type)) {
    ElMessage.error("仅支持 png / jpg / webp / svg / ico 格式");
    return false;
  }
  if (file.size > 2 * 1024 * 1024) {
    ElMessage.error("图片不能超过 2MB");
    return false;
  }
  return true;
}

/** 统一上传处理：kind 决定写入 site.logo 还是 site.favicon */
function makeUploader(kind: "logo" | "favicon") {
  return (options: UploadRequestOptions) => {
    if (kind === "logo") logoUploading.value = true;
    else faviconUploading.value = true;

    // 本地预览（服务端返回前就能看到图）
    const localUrl = URL.createObjectURL(options.file);
    if (kind === "logo") logoTempUrl.value = localUrl;
    else faviconTempUrl.value = localUrl;

    uploadSiteImage(options.file as unknown as File, kind)
      .then((res: any) => {
        if (res?.success) {
          const url = res.data.url;
          siteForm[`site.${kind}`] = url;
          if (kind === "logo") logoTempUrl.value = "";
          else faviconTempUrl.value = "";
          URL.revokeObjectURL(localUrl);
          // 同步全局：Logo / favicon 立即生效
          siteStore.setInfo({ [`site.${kind}`]: url } as Partial<SiteInfo>);
          if (kind === "favicon") siteStore.applyFavicon();
          ElMessage.success("上传成功");
        }
      })
      .catch((err: any) => {
        // 失败则回滚预览，避免误导用户以为已上传
        if (kind === "logo") logoTempUrl.value = "";
        else faviconTempUrl.value = "";
        URL.revokeObjectURL(localUrl);

        // ★ 把底层错误码翻译成人话。413 是 nginx 层的体积拦截，
        //   此时请求**根本没到后端**，所以只提示"上传失败"会让用户反复重试大图。
        const status = err?.response?.status;
        if (status === 413) {
          ElMessage.error("图片过大，服务器拒绝接收（上限 2MB），请压缩后重试");
        } else if (status === 401 || status === 403) {
          ElMessage.error("登录状态已失效或无权限，请重新登录后再试");
        } else if (err?.code === "ECONNABORTED" || err?.message?.includes("timeout")) {
          ElMessage.error("上传超时，请检查网络后重试");
        } else {
          ElMessage.error(err?.response?.data?.message || "上传失败，请重试");
        }
      })
      .finally(() => {
        if (kind === "logo") logoUploading.value = false;
        else faviconUploading.value = false;
      });
  };
}

const uploadLogo = makeUploader("logo");
const uploadFavicon = makeUploader("favicon");

/** 恢复为内置默认 Logo */
function resetLogo() {
  siteForm["site.logo"] = "";
  logoTempUrl.value = "";
  siteStore.setInfo({ "site.logo": "" } as Partial<SiteInfo>);
  ElMessage.info("已恢复默认 Logo，记得点「保存站点信息」");
}

/* ---------------- 业务参数（缺勤预警） ---------------- */

const loading = ref(false);
const saving = ref(false);

const form = reactive({
  warn_rate: 80,
  warn_consecutive: 3,
  warn_days: 14
});

function loadSettings() {
  loading.value = true;
  getSettings()
    .then((res: any) => {
      if (res.success) {
        const s = res.data || {};
        form.warn_rate = Number(s.warn_rate ?? 80);
        form.warn_consecutive = Number(s.warn_consecutive ?? 3);
        form.warn_days = Number(s.warn_days ?? 14);
      }
    })
    .finally(() => (loading.value = false));
}

function handleSave() {
  saving.value = true;
  updateSettings({
    warn_rate: form.warn_rate,
    warn_consecutive: form.warn_consecutive,
    warn_days: form.warn_days
  })
    .then((res: any) => {
      if (res.success) {
        ElMessage.success("保存成功");
      }
    })
    .finally(() => (saving.value = false));
}

onMounted(() => {
  loadSiteInfo();
  loadSettings();
});
</script>

<template>
  <div class="app-page">
    <AppPageHeader title="系统参数" description="机构信息与业务参数维护" />

    <div class="settings-stack">
      <!-- ============ 站点信息 ============ -->
      <el-card v-loading="siteLoading" shadow="never" class="page-card">
        <template #header>
          <div class="card-head">
            <span class="font-medium">站点信息</span>
            <span class="card-head__hint">
              影响登录页、侧边栏、浏览器标签与页脚
            </span>
          </div>
        </template>

        <el-form :model="siteForm" label-width="120px" class="max-w-3xl">
          <el-form-item label="机构名称">
            <el-input
              v-model="siteForm['site.name']"
              placeholder="如：川外培训"
              maxlength="50"
              show-word-limit
            />
            <span class="form-tip">用于侧边栏与登录页的简称</span>
          </el-form-item>

          <el-form-item label="系统全称">
            <el-input
              v-model="siteForm['site.title']"
              placeholder="如：川外培训 · 教务管理系统"
              maxlength="60"
              show-word-limit
            />
            <span class="form-tip">浏览器标签页显示的名称</span>
          </el-form-item>

          <el-form-item label="登录页副标题">
            <el-input
              v-model="siteForm['site.slogan']"
              placeholder="留空则使用系统默认文案"
              maxlength="80"
              show-word-limit
            />
          </el-form-item>

          <el-divider content-position="left">
            <span class="divider-text">图标</span>
          </el-divider>

          <el-form-item label="系统 Logo">
            <div class="upload-row">
              <div class="upload-preview">
                <img :src="logoPreview" alt="Logo 预览" />
              </div>
              <div class="upload-actions">
                <el-upload
                  :show-file-list="false"
                  :before-upload="beforeUpload"
                  :http-request="uploadLogo"
                  accept=".png,.jpg,.jpeg,.svg,.webp,.ico"
                >
                  <el-button :loading="logoUploading">上传 Logo</el-button>
                </el-upload>
                <el-button v-if="siteForm['site.logo']" @click="resetLogo">
                  恢复默认
                </el-button>
              </div>
            </div>
            <span class="form-tip">
              建议 PNG / SVG 透明底，高度 44px 左右；不超 2MB。留空用内置默认图
            </span>
          </el-form-item>

          <el-form-item label="标签页图标">
            <div class="upload-row">
              <div class="upload-preview upload-preview--sm">
                <img
                  v-if="faviconPreview"
                  :src="faviconPreview"
                  alt="图标预览"
                />
                <span v-else class="upload-preview__empty">默认</span>
              </div>
              <el-upload
                :show-file-list="false"
                :before-upload="beforeUpload"
                :http-request="uploadFavicon"
                accept=".png,.svg,.ico"
              >
                <el-button :loading="faviconUploading">上传图标</el-button>
              </el-upload>
            </div>
            <span class="form-tip"
              >浏览器标签上的小图标，推荐 32×32 的 ico 或 png</span
            >
          </el-form-item>

          <el-divider content-position="left">
            <span class="divider-text">页脚信息</span>
          </el-divider>

          <el-form-item label="版权主体">
            <el-input
              v-model="siteForm['site.orgName']"
              placeholder="如：川外培训学校"
              maxlength="60"
            />
          </el-form-item>

          <el-form-item label="起始年份">
            <el-input
              v-model="siteForm['site.sinceYear']"
              placeholder="如：2020"
              maxlength="4"
              class="w-32"
            />
            <span class="form-tip">
              页脚将显示为 Copyright © {{ siteStore.copyrightYears }}
            </span>
          </el-form-item>

          <el-form-item label="联系电话">
            <el-input
              v-model="siteForm['site.contact']"
              placeholder="选填，前台电话"
              maxlength="30"
            />
          </el-form-item>

          <el-form-item label="地址">
            <el-input
              v-model="siteForm['site.address']"
              placeholder="选填"
              maxlength="80"
            />
          </el-form-item>

          <el-form-item label="补充说明">
            <el-input
              v-model="siteForm['site.copyrightExtra']"
              placeholder="选填，显示在页脚版权行末尾"
              maxlength="60"
            />
          </el-form-item>

          <el-form-item label="ICP 备案号">
            <el-input
              v-model="siteForm['site.icp']"
              placeholder="暂不需要可留空，留空则页脚不显示"
              maxlength="40"
            />
          </el-form-item>

          <el-form-item label="公安备案号">
            <el-input
              v-model="siteForm['site.policeNo']"
              placeholder="暂不需要可留空，留空则页脚不显示"
              maxlength="40"
            />
          </el-form-item>

          <el-form-item>
            <el-button
              type="primary"
              :loading="siteSaving"
              @click="handleSaveSite"
            >
              保存站点信息
            </el-button>
            <span class="form-tip ml-3">保存后立即生效，无需重启</span>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- ============ 业务参数 ============ -->
      <el-card v-loading="loading" shadow="never" class="page-card">
        <template #header>
          <span class="font-medium">缺勤预警参数</span>
        </template>
        <p class="mb-4 text-sm text-gray-400">
          以下参数作用于「统计报表」中的缺勤预警：达到阈值的学生将被标记为预警对象。
        </p>
        <el-form :model="form" label-width="160px" class="max-w-xl">
          <el-form-item label="出勤率预警阈值（%）">
            <el-input-number v-model="form.warn_rate" :min="1" :max="100" />
            <span class="ml-2 text-sm text-gray-400">低于该出勤率视为预警</span>
          </el-form-item>
          <el-form-item label="连续缺勤天数">
            <el-input-number
              v-model="form.warn_consecutive"
              :min="1"
              :max="30"
            />
            <span class="ml-2 text-sm text-gray-400"
              >连续缺勤达到该天数触发预警</span
            >
          </el-form-item>
          <el-form-item label="统计窗口（天）">
            <el-input-number v-model="form.warn_days" :min="1" :max="90" />
            <span class="ml-2 text-sm text-gray-400">预警统计的时间范围</span>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="saving" @click="handleSave"
              >保存</el-button
            >
          </el-form-item>
        </el-form>
      </el-card>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.settings-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.card-head__hint {
  color: var(--ink-400);
  font-size: 12px;
}

.divider-text {
  color: var(--ink-500);
  font-size: 13px;
}

.form-tip {
  margin-left: 8px;
  color: var(--ink-400);
  font-size: 12px;
  line-height: 1.5;
}

.upload-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.upload-preview {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 120px;
  height: 56px;
  padding: 8px;
  background: var(--ink-50);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);

  img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
}

.upload-preview--sm {
  width: 56px;
  height: 56px;
}

.upload-preview__empty {
  color: var(--ink-400);
  font-size: 12px;
}

.upload-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
