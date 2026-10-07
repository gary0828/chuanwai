import appChartCard from "./src/index.vue";
import { withInstall } from "@pureadmin/utils";

/** 图表卡片：统一「标题 + 图/空态 + 主题跟随」外壳，业务页只关心 options */
export const AppChartCard = withInstall(appChartCard);

export default AppChartCard;