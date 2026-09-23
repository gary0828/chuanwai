<script setup lang="ts">
import Motion from "./utils/motion";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import { createLoginRules } from "./utils/rule";
import { ref, reactive, computed } from "vue";
import { debounce } from "@pureadmin/utils";
import { useNav } from "@/layout/hooks/useNav";
import { useSiteStore } from "@/store/modules/site";
import { useEventListener } from "@vueuse/core";
import type { FormInstance } from "element-plus";
import { useLayout } from "@/layout/hooks/useLayout";
import { useUserStoreHook } from "@/store/modules/user";
import { initRouter, getTopMenu } from "@/router/utils";
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

// 站点信息：Logo 与副标题支持后台配置（未配置则用内置默认）
const site = useSiteStore();
const logoUrl = computed(() => site.logo);
const siteSlogan = computed(
  () =>
    site.info["site.slogan"] || "考勤、成绩、课表、学员档案与财务，都在同一处。"
);

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
  <div class="login-page select-none">
    <!-- 背景：全屏对称的教务格栅（主 128px / 次 32px 两级坐标线，中心渐隐） -->
    <div class="login-page__grid" aria-hidden="true" />

    <div class="login-page__theme">
      <el-tooltip content="切换明暗主题" placement="bottom">
        <el-switch
          v-model="dataTheme"
          inline-prompt
          :active-icon="dayIcon"
          :inactive-icon="darkIcon"
          @change="dataThemeChange"
        />
      </el-tooltip>
    </div>

    <!-- 品牌 → 表单卡 → 页脚：三者同轴居中，整个页面因此上下左右完全对称 -->
    <div class="login-shell">
      <header class="login-brand">
        <img class="login-brand__logo" :src="logoUrl" alt="logo" />
        <h1 class="login-brand__name">{{ title }}</h1>
        <p class="login-brand__slogan">
          {{ siteSlogan }}
        </p>
      </header>

      <main class="login-form">
        <h2 class="login-form__title">登录</h2>
        <p class="login-form__subtitle">使用管理员分配的账号与密码</p>

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
              class="w-full mt-2!"
              type="primary"
              size="large"
              :loading="loading"
              :disabled="disabled"
              @click="onLogin(ruleFormRef)"
            >
              登录
            </el-button>
          </Motion>

          <!--
            多端登录入口：**已按内容清点 C8 隐藏（2026-09-23）**。
            原来这里展示「手机号登录 / 微信扫码登录」两个不可点占位（tooltip「开发中」），
            面向所有员工可见却点不动，只会让人以为功能坏了。
            产品边界（`docs/03-开发指南/产品边界与AI.md`）本就禁止出网触达与小程序，
            故直接不展示；后端预留接口保持原样，将来要接入时：
            1. 手机号登录：`POST /api/auth/sms-code` 发验证码 → `POST /api/auth/login`
               body 传 `{ type: 'phone', phone, code }`；
            2. 微信扫码：`POST /api/auth/wechat`（code 换 token），与小程序共用 `user_oauth` 表。
            接入时把本块恢复并绑上真实 handler 即可。样式类 `.login-form__alt` 保留在
            `src/style/login.css` 中，未删除（避免动共享样式表）。
          -->
        </el-form>
      </main>

      <footer class="login-foot">
        仅限本校员工使用 · 忘记密码请联系教务管理员重置
      </footer>
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
