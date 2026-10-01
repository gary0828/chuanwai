// 静态托管 dist/ 并把 /api 代理到本地后端，用于对「生产构建产物」做浏览器验证。
// 注意：这是本地验证工具，不是部署方案（线上由 nginx 承担，见 Dockerfile / docker-compose.yml）。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

// DIST 目录可通过环境变量覆盖（默认 dist/）。用于在构建产物位于非默认目录时做验证，
// 避免为了一次验证去批量删除 dist/ 触发本机 safe-delete shim。
const DIST = path.resolve(process.env.DIST || "dist");
const PORT = Number(process.env.PORT || 8848);
const API = process.env.API_TARGET || "http://127.0.0.1:3000";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8"
};

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // /api 反向代理到后端
  // /assets 也代理（站点上传的 Logo / favicon 由后端托管，见 ADR-008）
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/assets")) {
    const target = new URL(url.pathname + url.search, API);
    const proxied = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: req.method,
        headers: { ...req.headers, host: target.host }
      },
      upstream => {
        res.writeHead(upstream.statusCode, upstream.headers);
        upstream.pipe(res);
      }
    );
    proxied.on("error", e => {
      res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ success: false, message: "proxy error: " + e.message }));
    });
    req.pipe(proxied);
    return;
  }

  // 静态资源：先按路径找文件，找不到回落到 index.html（hash 路由只需根路径即可）
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const candidate = path.join(DIST, rel);
  if (!candidate.startsWith(DIST)) {
    res.writeHead(403).end("403");
    return;
  }
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    sendFile(res, candidate);
  } else if (path.extname(rel) === "") {
    sendFile(res, path.join(DIST, "index.html"));
  } else {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 " + rel);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[static+proxy] http://127.0.0.1:${PORT}  →  dist/ , /api → ${API}`);
});
