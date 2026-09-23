import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";

// 独立 AI 教学工作台：复用项目根 node_modules（Node 向上查找依赖），
// 独立端口 5180、独立产物目录，便于单独部署与后续整体移植。
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  base: "./",
  plugins: [
    vue(),
    Icons({
      autoInstall: false,
      compiler: "vue3",
      scale: 1
    })
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  server: {
    port: 5300,
    host: "127.0.0.1",
    strictPort: false
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000
  }
});
