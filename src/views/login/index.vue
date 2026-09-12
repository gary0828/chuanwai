<script setup lang="ts">
import Motion from "./utils/motion";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import { createLoginRules } from "./utils/rule";
import { ref, reactive, toRaw } from "vue";
import { debounce } from "@pureadmin/utils";
import { useNav } from "@/layout/hooks/useNav";
import { useEventListener } from "@vueuse/core";
import type { FormInstance } from "element-plus";
import { useLayout } from "@/layout/hooks/useLayout";
import { useUserStoreHook } from "@/store/modules/user";
import { initRouter, getTopMenu } from "@/router/utils";
import { bg, avatar, illustration } from "./utils/static";
import { useRenderIcon } from "@/components/ReIcon/src/hooks";
import { useDataThemeChange } from "@/layout/hooks/useDataThemeChange";
import { ReImageVerify } from "@/components/ReImageVerify";

import dayIcon from "@/assets/svg/day.svg?component";
import darkIcon from "@/assets/svg/dark.svg?component";
import Lock from "~icons/ri/lock-fill";
import User from "~icons/ri/user-3-fill";
import Keyhole from "~icons/ri/shield-keyhole-line";

defineOptions({
  name: "Login"
});

const router = useRouter();
const loading = ref(false);
const disabled = ref(false);
const ruleFormRef = ref<FormInstance>();

const { initStorage } = useLayout();
initStorage();

const { dataTheme, overallStyle, dataThemeChange } = useDataThemeChange();
dataThemeChange(overallStyle.value);
const { title } = useNav();

// 图形验证码开关：环境变量 VITE_LOGIN_CAPTCHA=false 时可关闭
// （关闭场景：Playwright 自动化验证脚本无法识别 canvas 验证码，见 PROGRESS.md）
const captchaEnabled = import.meta.env.VITE_LOGIN_CAPTCHA !== "false";

// 当前图形验证码（由 ReImageVerify 通过 v-model:code 回写，仅存在于内存）
const imgCode = ref("");
// 校验规则需要能读到最新验证码，因此用工厂函数创建
const loginRules = createLoginRules(() => imgCode.value, captchaEnabled);
// 验证码组件实例，登录失败时用来刷新
const verifyRef = ref<InstanceType<typeof ReImageVerify>>();

const ruleForm = reactive({
  username: "",
  password: "",
  verifyCode: ""
});

/** 刷新图形验证码（登录失败、切换登录方式时调用） */
const refreshCaptcha = () => {
  ruleForm.verifyCode = "";
  verifyRef.value?.getImgCode?.();
};

const onLogin = async (formEl: FormInstance | undefined) => {
  if (!formEl) return;
  await formEl.validate(valid => {
    if (valid) {
      loading.value = true;
      useUserStoreHook()
        .loginByUsername({
          // 登录方式扩展：后端统一入口支持 type: 'password' | 'phone' | 'wechat'
          // 本期仅实现账号密码登录，手机号/微信登录见下方预留入口
          type: "password",
          username: ruleForm.username,
          password: ruleForm.password
        })
        .then(res => {
          if (res.success) {
            // 获取后端路由
            return initRouter().then(() => {
              disabled.value = true;
              router
                .push(getTopMenu(true).path)
                .then(() => {
                  message("登录成功", { type: "success" });
                })
                .finally(() => (disabled.value = false));
            });
          } else {
            message(res.message || "登录失败", { type: "error" });
            refreshCaptcha();
          }
        })
        .catch(error => {
          // 后端以 400/403 等非 2xx 返回登录失败，axios 走 reject：
          // 展示后端具体原因（账号或密码错误 / 学生暂未开放登录等），避免静默无提示
          message(
            error?.response?.data?.message || error?.message || "登录失败",
            { type: "error" }
          );
          refreshCaptcha();
        })
        .finally(() => (loading.value = false));
    }
  });
};

const immediateDebounce: any = debounce(
  formRef => onLogin(formRef),
  1000,
  true
);

useEventListener(document, "keydown", ({ code }) => {
  if (
    ["Enter", "NumpadEnter"].includes(code) &&
    !disabled.value &&
    !loading.value
  )
    immediateDebounce(ruleFormRef.value);
});
</script>

<template>
  <div class="select-none">
    <img :src="bg" class="wave" />
    <div class="flex-c absolute right-5 top-3">
      <!-- 主题 -->
      <el-switch
        v-model="dataTheme"
        inline-prompt
        :active-icon="dayIcon"
        :inactive-icon="darkIcon"
        @change="dataThemeChange"
      />
    </div>
    <div class="login-container">
      <div class="img">
        <component :is="toRaw(illustration)" />
      </div>
      <div class="login-box">
        <div class="login-form">
          <avatar class="avatar" />
          <Motion>
            <h2 class="outline-hidden">{{ title }}</h2>
          </Motion>

          <el-form
            ref="ruleFormRef"
            :model="ruleForm"
            :rules="loginRules"
            size="large"
          >
            <Motion :delay="100">
              <el-form-item
                :rules="[
                  {
                    required: true,
                    message: '请输入账号',
                    trigger: 'blur'
                  }
                ]"
                prop="username"
              >
                <el-input
                  v-model="ruleForm.username"
                  clearable
                  placeholder="账号"
                  :prefix-icon="useRenderIcon(User)"
                />
              </el-form-item>
            </Motion>

            <Motion :delay="150">
              <el-form-item prop="password">
                <el-input
                  v-model="ruleForm.password"
                  clearable
                  show-password
                  placeholder="密码"
                  :prefix-icon="useRenderIcon(Lock)"
                />
              </el-form-item>
            </Motion>

            <Motion v-if="captchaEnabled" :delay="200">
              <el-form-item prop="verifyCode">
                <el-input
                  v-model="ruleForm.verifyCode"
                  clearable
                  placeholder="验证码"
                  :prefix-icon="useRenderIcon(Keyhole)"
                >
                  <template v-slot:append>
                    <ReImageVerify
                      ref="verifyRef"
                      v-model:code="imgCode"
                      title="看不清？点击图片换一张"
                    />
                  </template>
                </el-input>
              </el-form-item>
            </Motion>

            <Motion :delay="250">
              <el-button
                class="w-full mt-4!"
                size="default"
                type="primary"
                :loading="loading"
                :disabled="disabled"
                @click="onLogin(ruleFormRef)"
              >
                登录
              </el-button>
            </Motion>

            <!--
              预留多端登录入口（UI 占位，本期不实现）：
              1. 手机号登录：后端已预留 POST /api/auth/sms-code（发验证码），接入时调用
                 POST /api/auth/login，body 传 { type: 'phone', phone, code }；
              2. 微信扫码登录：后端已预留 POST /api/auth/wechat（code 换 token），
                 与微信小程序共用 user_oauth 表绑定 openid/unionid。
              接入时移除 disabled 占位并调用对应接口即可。
            -->
            <Motion :delay="300">
              <div class="mt-5 flex items-center justify-center text-[12px]">
                <el-tooltip
                  content="手机号登录功能开发中，敬请期待"
                  placement="bottom"
                >
                  <span class="cursor-not-allowed select-none opacity-60"
                    >手机号登录</span
                  >
                </el-tooltip>
                <el-divider direction="vertical" />
                <el-tooltip
                  content="微信扫码登录功能开发中，敬请期待"
                  placement="bottom"
                >
                  <span class="cursor-not-allowed select-none opacity-60"
                    >微信扫码登录</span
                  >
                </el-tooltip>
              </div>
            </Motion>
          </el-form>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url("@/style/login.css");
</style>

<style lang="scss" scoped>
:deep(.el-input-group__append, .el-input-group__prepend) {
  padding: 0;
}
</style>
