#!/usr/bin/env node
/**
 * 课时台账重算 —— 修复「orders.remain_hours」与「hour_consumptions 流水净扣」不一致。
 *
 * 背景（2026-10-18 深度测试 P2-2 / P2-9b）：
 *   v11 之前手工改剩余课时不留流水；v29 之前的流水还混用过「1 节=2 课时」的老口径。
 *   结果：历史订单的 `total_hours - remain_hours`（已耗课时）≠ `Σ扣减 - Σ回补`（流水净扣），
 *   报表「课消收入」与「课时流水」两套算法各说各话，且没有自动修复路径。
 *   本脚本就是那条修复路径：**默认 dry-run**，只有 `--apply` 才写库。
 *
 * 口径（★ 修复方向很重要，别反过来）：
 *   - **以 `orders.remain_hours` 为准**：它是全项目最热的数据点（界面/预警/报表都用），
 *     也是历史上「真的改过」的那个值；流水只是缺记，不是余额的权威。
 *   - 不一致时补一条差额流水，让「流水净扣」追上「已耗课时」：
 *       需要的净扣 = total_hours - remain_hours
 *       差额       = 需要的净扣 - 当前净扣
 *       差额 > 0 → 补「扣减」；差额 < 0 → 补「回补」；source = 手工调整
 *   - **绝不去改 remain_hours**：若反过来按流水改 remain，遇到 net < 0 的历史单会算出
 *     remain > total_hours（超过课时包上限），反而制造非法数据。
 *
 * 安全设计：
 *   1. 默认 dry-run：只打印不一致清单与建议修正量，不写任何数据；
 *   2. `--apply` 写入前先 `VACUUM INTO` 做一份完整快照备份（不停机、快照一致）；
 *   3. 写入在 `BEGIN IMMEDIATE` 事务里，失败整体回滚；写后二次核对，仍有差异则回滚退出；
 *   4. 幂等：修完再跑一次，清单为空、不会重复补流水。
 *
 * 用法：
 *   node server/scripts/reconcile-hours-ledger.mjs                 # dry-run（默认）
 *   node server/scripts/reconcile-hours-ledger.mjs --json          # dry-run + JSON 输出（给脚本消费）
 *   node server/scripts/reconcile-hours-ledger.mjs --apply         # 真正写库（先自动备份）
 *   node server/scripts/reconcile-hours-ledger.mjs --db <path>     # 指定库（默认 DATA_DIR/attendance.db）
 *
 * 退出码：0 = 正常（dry-run 发现差异也算正常）；1 = 参数/数据库/写入错误。
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const hasFlag = f => argv.includes(f);
const getOpt = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

if (hasFlag("--help") || hasFlag("-h")) {
  console.log(`用法：node server/scripts/reconcile-hours-ledger.mjs [--dry-run] [--apply] [--json] [--db <path>]

默认 dry-run：只输出不一致清单与建议修正量，不写库。
--apply   ：写库（写前自动 VACUUM INTO 备份，写后二次核对）
--json    ：以 JSON 输出结果（便于 CI/验证脚本消费）
--db <p>  ：数据库路径（默认：$DATA_DIR/attendance.db，否则 server/data/attendance.db）`);
  process.exit(0);
}

const APPLY = hasFlag("--apply");
const JSON_OUT = hasFlag("--json");
const THRESHOLD = 0.001; // 课时为整数；留一点浮点余量

function resolveDbPath() {
  const explicit = getOpt("--db") || process.env.DB_PATH;
  if (explicit) return path.resolve(explicit);
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR, "attendance.db");
  return path.resolve(__dirname, "..", "data", "attendance.db");
}

const dbPath = resolveDbPath();
if (!existsSync(dbPath)) {
  console.error(`✗ 找不到数据库：${dbPath}`);
  process.exit(1);
}

/** 单引号转义，供 VACUUM INTO '...' 用 */
const sqlQuote = s => `'${String(s).replace(/'/g, "''")}'`;

/** 查询全部台账不一致订单（与 db-integrity 报告的 SQL 同口径） */
const INCONSISTENT_SQL = `
  SELECT o.id AS order_id, o.student_id, s.student_no, s.name AS student_name,
         o.course_id, o.class_id, o.status,
         o.total_hours, o.remain_hours,
         COALESCE(SUM(CASE WHEN hc.type = '扣减' THEN hc.hours
                           WHEN hc.type = '回补' THEN -hc.hours
                           ELSE 0 END), 0) AS net_consumed,
         COUNT(hc.id) AS flow_count
  FROM orders o
  JOIN students s ON s.id = o.student_id
  LEFT JOIN hour_consumptions hc ON hc.order_id = o.id
  GROUP BY o.id
  HAVING ABS((o.total_hours - o.remain_hours) - net_consumed) > ?
  ORDER BY ABS((o.total_hours - o.remain_hours) - net_consumed) DESC, o.id
`;

/** 把一行差异翻译成「建议补写的流水」；null 表示不需要修 */
function toFix(row) {
  const total = Number(row.total_hours) || 0;
  const remain = Number(row.remain_hours) || 0;
  const net = Number(row.net_consumed) || 0;
  const neededNet = total - remain; // 已耗课时（以 remain 为准）
  const delta = neededNet - net; // 需要补的净扣
  if (Math.abs(delta) <= THRESHOLD) return null;
  return {
    order_id: Number(row.order_id),
    student_id: Number(row.student_id),
    student_no: row.student_no,
    student_name: row.student_name,
    course_id: row.course_id,
    class_id: row.class_id,
    status: row.status,
    total_hours: total,
    remain_hours: remain,
    net_consumed: Number(net.toFixed(3)),
    needed_net: Number(neededNet.toFixed(3)),
    delta: Number(delta.toFixed(3)),
    type: delta > 0 ? "扣减" : "回补",
    hours: Number(Math.abs(delta).toFixed(3))
  };
}

function scan(db) {
  return db
    .prepare(INCONSISTENT_SQL)
    .all(THRESHOLD)
    .map(toFix)
    .filter(Boolean);
}

function summarize(fixes) {
  const deduct = fixes.filter(f => f.type === "扣减");
  const refund = fixes.filter(f => f.type === "回补");
  const sum = list => Number(list.reduce((s, f) => s + f.hours, 0).toFixed(3));
  return {
    count: fixes.length,
    deduct_count: deduct.length,
    deduct_hours: sum(deduct),
    refund_count: refund.length,
    refund_hours: sum(refund),
    absorb: Number((sum(deduct) - sum(refund)).toFixed(3))
  };
}

function printFixTable(fixes) {
  if (fixes.length === 0) {
    console.log("✓ 课时台账一致：所有订单 total_hours - remain_hours == 流水净扣");
    return;
  }
  console.log(`不一致订单：${fixes.length} 单\n`);
  const header = ["订单", "学员", "total", "remain", "流水净扣", "应有净扣", "建议修正"];
  const rows = fixes.map(f => [
    `#${f.order_id}`,
    `${f.student_name || "?"}(${f.student_no || "-"})`,
    String(f.total_hours),
    String(f.remain_hours),
    String(f.net_consumed),
    String(f.needed_net),
    `${f.type} ${f.hours}`
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
  const line = r => r.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(line(header));
  console.log(widths.map(w => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(line(r));
}

let db;
try {
  db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
} catch (e) {
  console.error(`✗ 打开数据库失败：${dbPath}\n  ${e.message}`);
  process.exit(1);
}

try {
  const before = scan(db);
  const summary = summarize(before);

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          mode: APPLY ? "apply" : "dry-run",
          db: dbPath,
          consistent: before.length === 0,
          summary,
          fixes: before
        },
        null,
        2
      )
    );
  } else {
    console.log(`=== 课时台账重算（${APPLY ? "APPLY 写库" : "dry-run 只读"}）===`);
    console.log(`DB：${dbPath}`);
    console.log(`扫描：全部订单（阈值 ${THRESHOLD} 课时）\n`);
    printFixTable(before);
    if (before.length > 0) {
      console.log(
        `\n建议：补写流水 ${summary.count} 条，净影响 ${summary.absorb} 课时` +
          `（扣减 ${summary.deduct_hours} / 回补 ${summary.refund_hours}）。` +
          "\n口径：以 orders.remain_hours 为准，让流水净扣追上「已耗课时」，不改 remain_hours。"
      );
    }
    if (!APPLY) {
      console.log("\n这是 dry-run，未写任何数据。确认无误后加 --apply 执行（会自动备份）。");
    }
  }

  if (!APPLY || before.length === 0) {
    db.close();
    process.exit(0);
  }

  // ── ① 备份：VACUUM INTO（必须在事务外）────────────────────────────
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 17); // 到毫秒
  const backupPath = path.join(
    path.dirname(dbPath),
    `attendance-before-hours-reconcile-${stamp}.db`
  );
  if (existsSync(backupPath)) {
    console.error(`✗ 备份文件已存在，拒绝覆盖：${backupPath}`);
    process.exit(1);
  }
  db.exec(`VACUUM INTO ${sqlQuote(backupPath)}`);
  const backupSize = statSync(backupPath).size;
  if (!JSON_OUT) console.log(`\n✓ 已备份：${backupPath}（${backupSize} 字节）`);

  // ── ② 写库：一个事务，失败整体回滚 ────────────────────────────────
  const insert = db.prepare(`
    INSERT INTO hour_consumptions
      (student_id, order_id, course_id, class_id, date, hours, type, source, operator_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, '手工调整', NULL)
  `);
  const today = new Date().toLocaleDateString("sv");
  let written = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const f of before) {
      insert.run(
        f.student_id,
        f.order_id,
        f.course_id ?? null,
        f.class_id ?? null,
        today,
        f.hours,
        f.type
      );
      written++;
    }
    // ③ 写后二次核对：还有差异 → 回滚，绝不带着半套修复退出
    const after = scan(db);
    if (after.length > 0) {
      db.exec("ROLLBACK");
      console.error(`✗ 写入后仍有 ${after.length} 单不一致，已回滚（未改动数据）`);
      process.exit(1);
    }
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* 回滚失败时交给连接关闭 */
    }
    console.error(`✗ 写入失败，已回滚：${e.message}`);
    process.exit(1);
  }

  console.log(
    `✓ 已补写 ${written} 条「手工调整」流水（扣减 ${summary.deduct_hours} / 回补 ${summary.refund_hours} 课时）`
  );
  console.log("✓ 二次核对通过：台账已一致。备份保留在：" + backupPath);
  db.close();
  process.exit(0);
} catch (e) {
  console.error(`✗ 执行失败：${e.message}`);
  try {
    db.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
}
