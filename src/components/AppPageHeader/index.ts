import appPageHeader from "./src/index.vue";
import { withInstall } from "@pureadmin/utils";

/** 页面级页头：标题 + 说明 + 主操作，统一 34 个页面的首屏视觉语法 */
export const AppPageHeader = withInstall(appPageHeader);

export default AppPageHeader;
