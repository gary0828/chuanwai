import { createApp } from "vue";
import ElementPlus from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import "element-plus/dist/index.css";
// ★ KaTeX 样式必须引入，否则公式被渲染成无样式的裸文本
import "katex/dist/katex.min.css";
import "./styles.css";
import App from "./App.vue";
import { router } from "./router";

createApp(App).use(ElementPlus, { locale: zhCn }).use(router).mount("#app");