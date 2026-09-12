import { reactive } from "vue";
import type { FormRules } from "element-plus";

/** 密码正则（密码格式应为8-18位数字、字母、符号的任意两种组合） */
export const REGEXP_PWD =
  /^(?![0-9]+$)(?![a-z]+$)(?![A-Z]+$)(?!([^(0-9a-zA-Z)]|[()])+$)(?!^.*[\u4E00-\u9FA5].*$)([^(0-9a-zA-Z)]|[()]|[a-z]|[A-Z]|[0-9]){8,18}$/;

/**
 * 生成登录校验规则
 *
 * 说明：官方完整版把图形验证码存进 `store/modules/user` 的 `verifyCode` 字段。
 * 但本项目 `WORKBUDDY.md` §0.3 规定「禁止修改 `src/store/modules/user.ts` 等框架核心文件」，
 * 因此这里改为由登录页通过 `getImgCode()` 把当前验证码传进来，不改动框架核心文件。
 *
 * @param getImgCode 读取当前图形验证码（canvas 生成，仅存在于内存，不入库、不出网）
 * @param captchaEnabled 是否启用图形验证码（对应环境变量 VITE_LOGIN_CAPTCHA）
 */
export function createLoginRules(
  getImgCode: () => string,
  captchaEnabled = true
): FormRules {
  const rules: FormRules = {
    password: [
      {
        validator: (rule, value, callback) => {
          if (value === "") {
            callback(new Error("请输入密码"));
          } else if (!REGEXP_PWD.test(value)) {
            callback(
              new Error("密码格式应为8-18位数字、字母、符号的任意两种组合")
            );
          } else {
            callback();
          }
        },
        trigger: "blur"
      }
    ]
  };

  if (captchaEnabled) {
    rules.verifyCode = [
      {
        validator: (rule, value, callback) => {
          if (value === "") {
            callback(new Error("请输入验证码"));
          } else if (
            String(getImgCode()).toLowerCase() !== String(value).toLowerCase()
          ) {
            callback(new Error("验证码不正确，请点击图片刷新后重新输入"));
          } else {
            callback();
          }
        },
        trigger: "blur"
      }
    ];
  }

  return rules;
}

/** 未启用图形验证码时的默认规则（保留导出，便于其他地方复用） */
export const loginRules = reactive<FormRules>(createLoginRules(() => "", true));
