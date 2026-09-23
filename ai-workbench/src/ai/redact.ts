/**
 * 出网脱敏（工作台侧，与服务端 server/src/utils/redact.js 保持同一套规则）
 *
 * 说明：真正的最后一道闸门在服务端 —— 工作台是独立部署的静态应用，
 * 任何人都能改这里的代码，所以前端过滤只是「尽量少发」，不作为安全保证。
 *
 * 规则与 2026-09-14 的安全修复一致：**键名归一化 + 语义匹配**，
 * 而不是精确键名黑名单（后者漏过 focusStudentNames，导致学生姓名出网）。
 */

function normalizeKey(key: string): string {
  return String(key).toLowerCase().replace(/[_\-\s]/g, "");
}

/** 出现即剔除（值一定是敏感信息）：家长/电话/金额/证件/地址/邮箱 */
const HARD_ROOTS =
  /(phone|mobile|tel|amount|money|fee|balance|price|idcard|address|email|parent)/;
/** 中文语义上的「姓名类」前缀：这些开头的 name/names 一律剔除 */
const PERSON_PREFIX =
  /^(name|names|student|focus|teacher|staff|member|child|kid|guardian)/;
/** 明确安全的「名称」前缀：教学实体的名称必须保留，否则模型会失去上下文 */
const SAFE_NAME_PREFIX =
  /^(kp|unit|class|lesson|course|subject|exam|paper|material|question|topic|weak|latest|chapter|term)/;
/** 课时数量：按既有决策（D5）不出网 */
const HOURS_KEYS = new Set(["remainhours", "totalhours", "hours", "consumedhours"]);

export function isForbiddenKey(key: string): boolean {
  const k = normalizeKey(key);

  if (HARD_ROOTS.test(k)) return true;
  if (k === "name" || k === "names") return true;
  if (PERSON_PREFIX.test(k) && k.includes("name")) return true;
  if ((k.endsWith("name") || k.endsWith("names")) && !SAFE_NAME_PREFIX.test(k)) {
    return true;
  }
  if (HOURS_KEYS.has(k)) return true;

  return false;
}

/** 金额类的文本（值出现即整段替换） */
const MONEY_HINT = /(¥|元$|￥)/;

const CODE = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/** 学生代号：内部 ID 决定，稳定可复现，但不含身份信息 */
export function studentCode(internalId: number): string {
  const i = internalId % CODE.length;
  const j = Math.floor(internalId / CODE.length) % CODE.length;
  return `学员${CODE[i]}${CODE[j]}`;
}

export interface RedactResult<T = Record<string, unknown>> {
  safe: T;
  /** 被剔除的字段路径，用于界面展示与审计 */
  removed: string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 递归脱敏。返回安全副本与被剔除字段清单（不改动入参）。
 */
export function redact(input: unknown): RedactResult {
  const removed: string[] = [];

  function walk(node: unknown, path: string): unknown {
    if (Array.isArray(node)) {
      return node.map((item, i) => walk(item, `${path}[${i}]`));
    }
    if (isPlainObject(node)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        const childPath = path ? `${path}.${k}` : k;
        if (isForbiddenKey(k)) {
          removed.push(childPath);
          continue;
        }
        out[k] = walk(v, childPath);
      }
      return out;
    }
    if (typeof node === "string" && MONEY_HINT.test(node)) {
      removed.push(path);
      return "[已脱敏]";
    }
    return node;
  }

  const safe = walk(input, "") as Record<string, unknown>;
  return { safe, removed };
}

/** 统计一次载荷里敏感项的命中情况（演示用） */
export function redactReport(input: unknown) {
  const { safe, removed } = redact(input);
  return {
    safe,
    removed,
    removedCount: removed.length,
    ok: removed.length === 0
  };
}
