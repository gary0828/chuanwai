/**
 * 题库本地预览服务（与 ai-workbench/serve.mjs 同构）
 *
 * - 静态托管 question-bank/dist
 * - 把 /api 反代到教务系统后端（默认 http://127.0.0.1:3000），
 *   与 Docker 环境行为一致，因此题库无需任何跨域配置。
 *
 * ★ 与工作台 serve.mjs 的差别：额外支持 `/qb/` 前缀路由
 *   —— 访问 http://127.0.0.1:8849/qb/ 才能正确拿到静态资源
 *   （index.html 里用的是相对路径 ./assets/xxx，所以放在子路径下也对得上）。
 *
 * 用法：node question-bank/serve.mjs [port] [apiBase]
 *   例：node question-bank/serve.mjs 8849 http://127.0.0.1:3000
 */
import { createServer, request as httpRequest } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "dist");
let port = Number(process.argv[2] || process.env.PORT || 8849);
const TARGET = new URL(process.argv[3] || process.env.API_BASE || "http://127.0.0.1:3000");
const HOST = "127.0.0.1";
/** 挂载前缀：与生产 nginx 一致（/qb/） */
const MOUNT = "/qb";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject"
};

/** 把 /api/* 转发到教务系统后端 */
function proxy(req, res) {
  const upstream = httpRequest(
    {
      hostname: TARGET.hostname,
      port: TARGET.port || 80,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: TARGET.host }
    },
    (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    }
  );
  upstream.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ success: false, message: `后端不可达：${err.message}` }));
  });
  req.pipe(upstream);
}

createServer(async (req, res) => {
  const url = req.url || "/";
  const pathname = url.split("?")[0];

  if (pathname.startsWith("/api/")) return proxy(req, res);

  // 根路径重定向到 /qb/ —— 直接开 8849 也知道该去哪
  if (pathname === "/" || pathname === "/index.html") {
    res.writeHead(302, { Location: `${MOUNT}/` });
    return res.end();
  }

  // 剥掉 /qb 前缀 → 磁盘相对路径
  let rel = pathname.startsWith(`${MOUNT}/`)
    ? pathname.slice(MOUNT.length + 1)
    : pathname.replace(/^\//, "");
  // 同样支持不带前缀直接访问（/assets/xxx）
  if (!rel) rel = "index.html";

  const filePath = normalize(join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  try {
    const buf = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(buf);
  } catch {
    // SPA 回落：交给 index.html（hash 路由的入口）
    try {
      const buf = await readFile(join(ROOT, "index.html"));
      res.writeHead(200, { "Content-Type": MIME[".html"] });
      res.end(buf);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("题库尚未构建：先运行 vite build --config question-bank/vite.config.ts");
    }
  }
}).listen(port, HOST, () => {
  console.log(`[题库] 已启动：http://${HOST}:${port}${MOUNT}/`);
  console.log(`[题库] /api 反代到 ${TARGET.origin}`);
  console.log(
    `[题库] 提示：免登需要票据。若直接从这里打开会是只读模式，`
  );
  console.log(`       正常路径是教务系统顶栏点「题库」入口进入。`);
});