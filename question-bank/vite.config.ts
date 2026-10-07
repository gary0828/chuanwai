import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";

/**
 * 独立智能题库系统（2026-10-07 · 一期）
 *
 * 与 `ai-workbench/` 完全同构：复用项目根 `node_modules`（Node 向上查找依赖），
 * 独立产物目录，便于整体迁出。
 *
 * ★ `base: "./"` 是必须的：题库挂在统一入口 nginx 的 `/qb/` **子路径**下，
 *   用绝对路径 `/assets/...` 会 404（去到教务系统的 html 目录找）。
 *   这与工作台踩过的坑同型（nginx 注释里有详细记录）。
 *
 * 部署形态：统一入口单端口
 *   /      教务系统  ·  /ai/  AI 工作台  ·  /qb/  题库系统
 */
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
    port: 5301,
    host: "127.0.0.1",
    strictPort: false,
    proxy: {
      // 本地开发时把 /api 打到教务后端；生产由 nginx 反代，同源无需配置
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000
  }
});