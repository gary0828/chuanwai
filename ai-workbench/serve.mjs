/**
 * AI 教学工作台本地预览服务
 * - 静态托管 ai-workbench/dist
 * - 把 /api 反代到教务系统后端（默认 http://127.0.0.1:3000），与 Docker 环境行为一致，
 *   因此工作台无需任何跨域配置，apiBase() 默认同源即可。
 *
 * 用法：node ai-workbench/serve.mjs [port] [apiBase]
 *   例：node ai-workbench/serve.mjs 5300 http://127.0.0.1:3000
 */
import { createServer, request as httpRequest } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "dist");
let port = Number(process.argv[2] || process.env.PORT || 5300);
const TARGET = new URL(
  process.argv[3] || process.env.API_BASE || "http://127.0.0.1:3000"
);
const HOST = "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf"
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
    up => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    }
  );

  upstream.on("error", err => {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        success: false,
        message: `教务系统后端不可达（${TARGET.origin}）：${err.message}`
      })
    );
  });

  req.pipe(upstream);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    proxy(req, res);
    return;
  }

  try {
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";

    const target = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ""));
    if (!target.startsWith(ROOT)) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    const buf = await readFile(target);
    res.writeHead(200, {
      "Content-Type":
        MIME[extname(target).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(buf);
  } catch {
    // hash 路由：未知路径回落到 index.html
    try {
      const buf = await readFile(join(ROOT, "index.html"));
      res.writeHead(200, { "Content-Type": MIME[".html"] }).end(buf);
    } catch {
      res.writeHead(404).end("Not Found");
    }
  }
});

/** 端口被系统保留（Windows 动态端口区间会返回 EACCES）时自动向后寻找 */
let tries = 0;
server.on("error", err => {
  if ((err.code === "EACCES" || err.code === "EADDRINUSE") && tries < 20) {
    tries += 1;
    port += 1;
    server.listen(port, HOST);
    return;
  }
  console.error(`启动失败：${err.message}`);
  process.exit(1);
});

server.listen(port, HOST, () => {
  console.log(`AI 教学工作台预览：http://${HOST}:${port}`);
  console.log(`/api 反代目标：${TARGET.origin}`);
});
