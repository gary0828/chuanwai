import appEmpty from "./src/index.vue";
import { withInstall } from "@pureadmin/utils";

/** 统一空状态：说明"为什么空"与"下一步做什么" */
export const AppEmpty = withInstall(appEmpty);

export default AppEmpty;
