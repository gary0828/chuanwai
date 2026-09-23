<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import type { UploadRawFile, UploadRequestOptions } from "element-plus";
import AvatarDefault from "@/assets/user.jpg";
import {
  getMyProfile,
  updateMyPassword,
  updateMyProfile,
  uploadMyAvatar
} from "@/api/attendance";
import { useUserStoreHook } from "@/store/modules/user";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "Profile"
});

const userStore = useUserStoreHook();

const loading = ref(false);
const avatarUploading = ref(false);
/** 本地预览 URL：服务端返回前先显示，避免"点了没反应" */
const avatarTempUrl = ref("");

const profile = reactive({
  username: "",
  name: "",
  phone: "",
  avatar: ""
});

const pwdFormRef = ref();
const profileFormRef = ref();
const pwdSaving = ref(false);
const profileSaving = ref(false);

const pwdForm = reactive({
  old_password: "",
  password: "",
  confirm: ""
});

const pwdRules = {
  old_password: [{ required: true, message: "请输入原密码", trigger: "blur" }],
  password: [
    { required: true, message: "请输入新密码", trigger: "blur" },
    { min: 8, message: "新密码长度至少 8 位", trigger: "blur" }
  ],
  confirm: [
    { required: true, message: "请再次输入新密码", trigger: "blur" },
    {
      validator: (_r: any, value: string, callback: (e?: Error) => void) => {
        if (value !== pwdForm.password)
          callback(new Error("两次输入的密码不一致"));
        else callback();
      },
      trigger: "blur"
    }
  ]
};

const profileRules = {
  name: [{ required: true, message: "请输入姓名", trigger: "blur" }],
  phone: [
    {
      validator: (_r: any, value: string, callback: (e?: Error) => void) => {
        if (!value) return callback(); // 手机号允许为空
        if (!/^1[3-9]\d{9}$/.test(value))
          callback(new Error("手机号格式不正确"));
        else callback();
      },
      trigger: "blur"
    }
  ]
};

/** 头像展示：本地预览优先 → 已保存头像 → 内置占位图 */
const avatarPreview = ref<string>("");
function currentAvatar() {
  return avatarTempUrl.value || profile.avatar || AvatarDefault;
}
// 用 computed 更省心，但这里需要在上传失败时同步回落，故显式维护
const syncPreview = () => {
  avatarPreview.value = currentAvatar();
};

function loadProfile() {
  loading.value = true;
  getMyProfile()
    .then((res: any) => {
      if (res?.success) {
        profile.username = res.data.username || "";
        profile.name = res.data.name || "";
        profile.phone = res.data.phone || "";
        profile.avatar = res.data.avatar || "";
        syncPreview();
      }
    })
    .finally(() => (loading.value = false));
}

/** 上传前校验（后端还有魔数校验兜底） */
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

function uploadAvatar(options: UploadRequestOptions) {
  avatarUploading.value = true;
  const localUrl = URL.createObjectURL(options.file);
  avatarTempUrl.value = localUrl;
  syncPreview();

  // return 出去，满足 el-upload 的 http-request 契约（返回 Promise 便于它感知结束）
  return uploadMyAvatar(options.file as unknown as File)
    .then((res: any) => {
      if (res?.success) {
        profile.avatar = res.data.avatar;
        avatarTempUrl.value = "";
        URL.revokeObjectURL(localUrl);
        syncPreview();
        // 同步顶栏头像（顶栏读的就是 store 里的 avatar）
        userStore.SET_AVATAR(res.data.avatar);
        ElMessage.success("头像已更新");
      }
    })
    .catch((err: any) => {
      avatarTempUrl.value = "";
      URL.revokeObjectURL(localUrl);
      syncPreview();
      // 413 是 nginx 层拦截，请求根本没到后端 → 只提示"上传失败"会让人反复重试大图
      const status = err?.response?.status;
      if (status === 413) {
        ElMessage.error("图片过大，服务器拒绝接收（上限 2MB），请压缩后重试");
      } else if (status === 401 || status === 403) {
        ElMessage.error("登录状态已失效或无权限，请重新登录后再试");
      } else {
        ElMessage.error(err?.response?.data?.message || "上传失败，请重试");
      }
    })
    .finally(() => (avatarUploading.value = false));
}

function saveProfile() {
  profileFormRef.value.validate((valid: boolean) => {
    if (!valid) return;
    profileSaving.value = true;
    updateMyProfile({ name: profile.name, phone: profile.phone })
      .then((res: any) => {
        if (res?.success) {
          ElMessage.success("资料已更新");
          // 顶栏显示的是 nickname，改名后要同步，否则"改了但没变"
          userStore.SET_NICKNAME(res.data.name);
          profile.name = res.data.name;
          profile.phone = res.data.phone || "";
        }
      })
      .catch((err: any) => {
        ElMessage.error(err?.response?.data?.message || "保存失败，请重试");
      })
      .finally(() => (profileSaving.value = false));
  });
}

/**
 * 改密码：成功后后端已吊销本人全部已签发凭证（H2 口径）→ 这里只清理**本地**登录态并回登录页。
 * ★ 用 `resetLoginState()` 而不是 `logOut()`：后者会拿已吊销的 token 再调一次登出接口，
 *   必然 401 → 全局弹红色「登录状态已失效」，用户刚改密成功却看到报错。
 *   不做"原地继续用"，否则下一个请求必然 401，体验更差。
 */
function savePassword() {
  pwdFormRef.value.validate((valid: boolean) => {
    if (!valid) return;
    pwdSaving.value = true;
    updateMyPassword({
      old_password: pwdForm.old_password,
      password: pwdForm.password
    })
      .then((res: any) => {
        if (res?.success) {
          ElMessage.success("密码已修改，请使用新密码重新登录");
          userStore.resetLoginState();
        }
      })
      .catch((err: any) => {
        ElMessage.error(err?.response?.data?.message || "修改失败，请重试");
      })
      .finally(() => (pwdSaving.value = false));
  });
}

onMounted(() => {
  loadProfile();
});
</script>

<template>
  <div class="app-page">
    <AppPageHeader
      title="个人中心"
      description="修改头像、姓名与手机号；修改密码后需使用新密码重新登录"
    />

    <el-card v-loading="loading" shadow="never">
      <!-- 头像 -->
      <div class="mb-6 flex flex-wrap items-center gap-4">
        <img :src="avatarPreview" alt="头像" class="avatar-preview" />
        <div>
          <el-upload
            :show-file-list="false"
            :before-upload="beforeUpload"
            :http-request="uploadAvatar"
            accept=".png,.jpg,.jpeg,.svg,.webp,.ico"
          >
            <el-button :loading="avatarUploading">上传头像</el-button>
          </el-upload>
          <div class="mt-2 text-xs text-[--el-text-color-secondary]">
            支持 png / jpg / webp / svg / ico，不超过
            2MB；上传后顶栏头像立即更新
          </div>
        </div>
      </div>

      <!-- 基本资料 -->
      <el-form
        ref="profileFormRef"
        :model="profile"
        :rules="profileRules"
        label-width="96px"
        class="max-w-[560px]"
      >
        <el-form-item label="用户名">
          <el-input :model-value="profile.username" disabled />
          <div class="w-full text-xs text-[--el-text-color-secondary]">
            登录账号不可自行修改，需联系管理员
          </div>
        </el-form-item>
        <el-form-item label="姓名" prop="name">
          <el-input v-model="profile.name" placeholder="请输入姓名" clearable />
        </el-form-item>
        <el-form-item label="手机号" prop="phone">
          <el-input
            v-model="profile.phone"
            placeholder="用于班级联系，可留空"
            clearable
          />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            :loading="profileSaving"
            @click="saveProfile"
          >
            保存资料
          </el-button>
        </el-form-item>
      </el-form>

      <el-divider />

      <!-- 修改密码 -->
      <el-form
        ref="pwdFormRef"
        :model="pwdForm"
        :rules="pwdRules"
        label-width="96px"
        class="max-w-[560px]"
      >
        <el-form-item label="原密码" prop="old_password">
          <el-input
            v-model="pwdForm.old_password"
            type="password"
            show-password
            placeholder="请输入当前密码"
          />
        </el-form-item>
        <el-form-item label="新密码" prop="password">
          <el-input
            v-model="pwdForm.password"
            type="password"
            show-password
            placeholder="至少 8 位"
          />
        </el-form-item>
        <el-form-item label="确认新密码" prop="confirm">
          <el-input
            v-model="pwdForm.confirm"
            type="password"
            show-password
            placeholder="再次输入新密码"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="pwdSaving" @click="savePassword">
            修改密码
          </el-button>
          <span class="ml-3 text-xs text-[--el-text-color-secondary]">
            修改成功后当前登录状态会失效，需用新密码重新登录
          </span>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.avatar-preview {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border: 1px solid var(--el-border-color);
  border-radius: 50%;
}
</style>
