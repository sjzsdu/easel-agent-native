/**
 * 发布质量门禁 (Easel quality-gate + content_guard 的确定性部分).
 *
 * BLOCK 级 (密钥/内网地址/本地路径等敏感信息) → verdict=block, 硬拦发布.
 * WARN 级 (AI 味措辞/绝对化用语/超平台字数) → verdict=warn, 提醒人工复核.
 * 纯本地规则, 不调模型 — Agent 侧的语义质量评估由 skill 补充.
 */

export interface QualityIssue {
  level: "block" | "warn" | "info";
  rule: string;
  message: string;
  suggestion?: string;
}

export interface PlatformLimit {
  key: string;
  label: string;
  limit: number;
}

export const PLATFORM_LIMITS: PlatformLimit[] = [
  { key: "xiaohongshu", label: "小红书", limit: 1000 },
  { key: "weibo", label: "微博", limit: 2000 },
  { key: "douyin", label: "抖音", limit: 1000 },
  { key: "bilibili", label: "B站", limit: 2000 },
  { key: "zhihu", label: "知乎", limit: 50_000 },
  { key: "kuaishou", label: "快手", limit: 1000 },
  { key: "wechat-channels", label: "视频号", limit: 1000 },
  { key: "wechat-oa", label: "公众号", limit: 30_000 },
];

/** BLOCK: 疑似密钥/凭证. */
const SECRET_PATTERNS: Array<{ rule: string; re: RegExp; message: string }> = [
  { rule: "secret-api-key", re: /\bsk-[A-Za-z0-9_-]{16,}\b/, message: "疑似 API Key (sk-...)" },
  { rule: "secret-github-token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/, message: "疑似 GitHub Token" },
  { rule: "secret-bearer", re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i, message: "疑似 Bearer 凭证" },
  { rule: "secret-assignment", re: /\b(?:API_KEY|APIKEY|SECRET|PASSWORD|TOKEN|PRIVATE_KEY)\s*[=:]\s*["']?[^\s"']{8,}/i, message: "疑似明文密钥赋值" },
  { rule: "secret-jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, message: "疑似 JWT 令牌" },
];

/** BLOCK: 内网/本机地址与本地文件路径. */
const LEAK_PATTERNS: Array<{ rule: string; re: RegExp; message: string }> = [
  { rule: "leak-localhost", re: /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?\b/i, message: "本机地址泄漏" },
  { rule: "leak-private-ip", re: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/, message: "内网 IP 泄漏" },
  { rule: "leak-file-url", re: /\bfile:\/\/\//i, message: "本地文件 URL 泄漏" },
  { rule: "leak-abs-path-unix", re: /\/(?:Users|home|var|etc|root)\/[A-Za-z0-9._-]+\/[^\s]*\//, message: "本地绝对路径泄漏" },
  { rule: "leak-abs-path-win", re: /\b[A-Za-z]:\\[^\s]+\\/, message: "Windows 本地路径泄漏" },
];

/** WARN: AI 味模板措辞 (去 AI 感改写的触发点). */
const AI_FLAVOR_PHRASES: string[] = [
  "综上所述",
  "总而言之",
  "总的来说",
  "值得注意的是",
  "不难发现",
  "在当今",
  "在这个日新月异",
  "随着科技的发展",
  "随着时代的",
  "让我们一起",
  "希望对你有所帮助",
  "亲爱的读者",
  "赋能",
  "抓手",
  "闭环",
  "颠覆认知",
  "干货满满",
  "满满的干货",
  "码住",
  "速速收藏",
  "不懂就问",
  "首先，",
  "其次，",
  "最后，",
  "delve into",
  "In today's fast-paced",
  "unlock the power of",
  "game-changer",
];

/** WARN: 绝对化/违禁风险用语 (广告法与平台规则高风险词). */
const ABSOLUTE_CLAIMS: string[] = [
  "最佳",
  "最好",
  "最优",
  "第一品牌",
  "全网第一",
  "顶级",
  "绝对",
  "100%",
  "百分之百",
  "永不",
  "永久有效",
  "包治",
  "保过",
  " guaranteed ",
];

/**
 * WARN: 金融/投资诱导用语 (收益承诺与劝购话术), 财经类账号的红线词.
 * 短语匹配见 matchPhrase — 不做裸 includes, 避免正常句误报.
 */
const FINANCIAL_CLAIMS: string[] = [
  "稳赚",
  "稳赚不赔",
  "翻倍",
  "闭眼买",
  "闭眼入",
  "无脑买",
  "无脑入",
  "保本",
  "零风险",
  "稳赚不亏",
  "躺赚",
  "暴富",
  "必涨",
  "必赚",
  "包赚",
  "只涨不跌",
  "抄底稳赢",
  " guaranteed returns ",
  "risk-free",
  "get rich quick",
];

/**
 * 短语级匹配 (替代裸 text.includes):
 * - ASCII 词 (guaranteed / risk-free...) 用字母数字边界, 避免命中其他单词内部;
 * - CJK 短语找每个出现位置, 落在 isBenignClaimOccurrence 认定的无害搭配里则跳过
 *   (例: 「你最好看看」是建议语, 不是「最好」的绝对化宣传).
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isBenignClaimOccurrence(
  claim: string,
  before: string,
  after: string,
): boolean {
  // 「你最好看看」「最好先想想」这类建议语境 — 前面紧跟劝导对象, 且不是
  // 「最好用的…」式定语 (后接「的」是典型宣传用法, 要报).
  if (claim === "最好") {
    const adviceBefore = /(?:你|您|我|咱|大家|还是|建议|不如)$/.test(before);
    return adviceBefore && !after.startsWith("的");
  }
  return false;
}

interface ClaimHit {
  claim: string;
  start: number;
  end: number;
}

/** 收集 claims 在 text 里的全部命中 (含出现位置), 并做重叠去重。 */
function collectClaimHits(text: string, claims: string[]): ClaimHit[] {
  const haystack = text.toLowerCase();
  const hits: ClaimHit[] = [];
  for (const claim of claims) {
    const needle = claim.trim().toLowerCase();
    if (!needle) continue;
    // 纯 ASCII (含空格/连字符的英文短语): 前后不能紧贴字母数字。
    if (/^[\x20-\x7e]+$/.test(needle)) {
      const re = new RegExp(
        `(?<![a-z0-9])${escapeRegExp(needle)}(?![a-z0-9])`,
        "gi",
      );
      for (const m of haystack.matchAll(re)) {
        hits.push({ claim, start: m.index, end: m.index + needle.length });
      }
      continue;
    }
    let from = 0;
    for (;;) {
      const idx = haystack.indexOf(needle, from);
      if (idx < 0) break;
      const before = text.slice(Math.max(0, idx - 6), idx);
      const after = text.slice(idx + needle.length, idx + needle.length + 6);
      if (!isBenignClaimOccurrence(needle, before, after)) {
        hits.push({ claim, start: idx, end: idx + needle.length });
      }
      from = idx + 1;
    }
  }
  // 重叠去重: 短针命中区间被长针完全包含时丢弃 (例: 「稳赚不赔」同时命中
  // 「稳赚」), 避免同处重复告警与 score 双重扣分。非包含关系的多次出现仍分别报。
  const byLengthDesc = [...hits].sort(
    (a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start,
  );
  const kept: ClaimHit[] = [];
  for (const hit of byLengthDesc) {
    const contained = kept.some(
      (k) => hit.start >= k.start && hit.end <= k.end,
    );
    if (!contained) kept.push(hit);
  }
  return kept.sort((a, b) => a.start - b.start);
}

export interface QualityGateResult {
  verdict: "pass" | "warn" | "block";
  score: number;
  issues: QualityIssue[];
  stats: {
    charCount: number;
    lineCount: number;
    platform?: string;
    platformLimit?: number;
  };
  checkedAt: string;
}

export function runQualityGate(input: {
  text: string;
  platform?: string;
}): QualityGateResult {
  const text = input.text ?? "";
  const issues: QualityIssue[] = [];

  const trimmed = text.trim();
  if (!trimmed) {
    issues.push({
      level: "block",
      rule: "empty-content",
      message: "内容为空",
    });
  }

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.re.test(text)) {
      issues.push({
        level: "block",
        rule: pattern.rule,
        message: `${pattern.message}, 发布前必须移除`,
        suggestion: "删除该凭证并轮换密钥",
      });
    }
  }
  for (const pattern of LEAK_PATTERNS) {
    if (pattern.re.test(text)) {
      issues.push({
        level: "block",
        rule: pattern.rule,
        message: `${pattern.message}, 发布前必须移除`,
        suggestion: "移除内部地址/路径信息",
      });
    }
  }

  for (const phrase of AI_FLAVOR_PHRASES) {
    if (text.includes(phrase)) {
      issues.push({
        level: "warn",
        rule: "ai-flavor",
        message: `AI 味措辞: 「${phrase.trim()}」`,
        suggestion: "改写成更口语化、具体的表达",
      });
    }
  }
  for (const hit of collectClaimHits(text, ABSOLUTE_CLAIMS)) {
    issues.push({
      level: "warn",
      rule: "absolute-claim",
      message: `绝对化/高风险用语: 「${hit.claim.trim()}」`,
      suggestion: "改为有边界的表述, 降低合规风险",
    });
  }
  for (const hit of collectClaimHits(text, FINANCIAL_CLAIMS)) {
    issues.push({
      level: "warn",
      rule: "financial-claim",
      message: `金融诱导/收益承诺用语: 「${hit.claim.trim()}」`,
      suggestion: "删除收益承诺与劝购表述, 财经内容需加风险提示",
    });
  }

  const charCount = [...text].length;
  const lineCount = text.split(/\r?\n/).length;
  const platformDef = input.platform
    ? PLATFORM_LIMITS.find((p) => p.key === input.platform)
    : undefined;

  if (platformDef && charCount > platformDef.limit) {
    issues.push({
      level: "warn",
      rule: "platform-length",
      message: `${platformDef.label}正文 ${charCount} 字, 超出 ${platformDef.limit} 字限制`,
      suggestion: "精简正文或使用平台支持的折叠/长文形态",
    });
  }

  const hasLineBreaks = /\n/.test(trimmed);
  if (trimmed.length >= 40 && !hasLineBreaks && !platformDef) {
    issues.push({
      level: "info",
      rule: "no-structure",
      message: "长段落无换行, 建议分段提升可读性",
    });
  }

  const blockCount = issues.filter((i) => i.level === "block").length;
  const warnCount = issues.filter((i) => i.level === "warn").length;
  const verdict = blockCount > 0 ? "block" : warnCount > 0 ? "warn" : "pass";
  const score = Math.max(0, Math.min(100, 100 - blockCount * 40 - warnCount * 8));

  return {
    verdict,
    score,
    issues,
    stats: {
      charCount,
      lineCount,
      platform: platformDef?.key,
      platformLimit: platformDef?.limit,
    },
    checkedAt: new Date().toISOString(),
  };
}
