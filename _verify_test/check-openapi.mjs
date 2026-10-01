/**
 * openapi.yaml 契约门禁：可解析性 + 引用完整性 + growth 端点覆盖。
 *
 * 为什么需要：契约文件"改坏了"不会让任何测试失败，
 * 只会在未来对接方那里炸。按项目方法论「先验能否解析，再比字段」。
 */
import fs from "node:fs";
import YAML from "yaml";

// ★ 2026-09-23 修正：契约文件实际在 docs/04-API/ 下，脚本原来写的是 docs/openapi.yaml（已不存在的旧路径），
//   导致门禁一跑就是 ENOENT。路径漂移与「死了就静默」是同一类问题，故直接改准。
const p = "docs/04-API/openapi.yaml";
const raw = fs.readFileSync(p, "utf8");

let d;
try {
  d = YAML.parse(raw);
} catch (e) {
  console.log("FAIL 解析失败:", e.message);
  process.exit(1);
}
console.log("OK: YAML 可解析");

const paths = Object.keys(d.paths || {});
console.log("openapi:", d.openapi, "| 路径总数:", paths.length);

const g = paths.filter(k => k.startsWith("/api/growth"));
// 8 个路径 = 9 个端点（/thresholds 一个路径含 GET+PUT）
console.log("growth 路径数:", g.length, "(期望 8)");
for (const k of g.sort()) {
  console.log("  ", k, "->", Object.keys(d.paths[k]).join(",").toUpperCase());
}

const sch = Object.keys(d.components?.schemas || {});
console.log("schemas 总数:", sch.length);
const expect = [
  "KnowledgePoint",
  "GrowthEvalForm",
  "ClassEvalInput",
  "KpAssessmentInput",
  "StudentTimeline",
  "StudentGrowth",
  "ClassGrowth",
  "GrowthThresholds"
];
let missing = 0;
for (const s of expect) {
  const ok = sch.includes(s);
  if (!ok) missing++;
  console.log("  ", s, ok ? "OK" : "MISSING");
}

console.log("tags:", (d.tags || []).map(t => t.name).join(" / "));

// 引用完整性：所有 $ref 是否都能解析到
const refs = [
  ...new Set(
    [...raw.matchAll(/\$ref:\s*"#\/components\/(\w+)\/(\w+)"/g)].map(m => [m[1], m[2]])
  )
];
let bad = 0;
for (const [grp, name] of refs) {
  if (!d.components?.[grp]?.[name]) {
    console.log("  x 悬空引用:", grp, name);
    bad++;
  }
}
console.log(bad ? `FAIL: ${bad} 个悬空 $ref` : `OK: ${refs.length} 个 $ref 全部可解析`);

process.exit(bad || missing || g.length !== 8 ? 1 : 0);
