import { describe, expect, it } from "vitest";

import { PLATFORM_LIMITS, runQualityGate } from "../../server/lib/quality-rules.js";

describe("runQualityGate — verdict boundaries", () => {
  it("passes on clean text", () => {
    const r = runQualityGate({ text: "今天天气不错，出门走走吧。" });
    expect(r.verdict).toBe("pass");
    expect(r.score).toBe(100);
    expect(r.issues).toHaveLength(0);
    expect(r.stats.charCount).toBeGreaterThan(0);
    expect(r.stats.lineCount).toBe(1);
    expect(r.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("verdict=warn when only warn-level issues exist", () => {
    const r = runQualityGate({ text: "综上所述，这是最佳方案。" });
    expect(r.verdict).toBe("warn");
    expect(r.score).toBeLessThan(100);
    expect(r.score).toBeGreaterThan(0);
    const blockCount = r.issues.filter((i) => i.level === "block").length;
    const warnCount = r.issues.filter((i) => i.level === "warn").length;
    expect(blockCount).toBe(0);
    expect(warnCount).toBeGreaterThan(0);
  });

  it("verdict=block when any block-level issue exists (even with warns)", () => {
    const r = runQualityGate({
      text: "密钥是 sk-abcdefghijklmnop1234567890 ，综上所述很重要。",
    });
    expect(r.verdict).toBe("block");
    const blockCount = r.issues.filter((i) => i.level === "block").length;
    const warnCount = r.issues.filter((i) => i.level === "warn").length;
    expect(blockCount).toBeGreaterThan(0);
    expect(warnCount).toBeGreaterThan(0);
  });

  it("score decreases with more issues (block = 40, warn = 8)", () => {
    const clean = runQualityGate({ text: "hello" });
    expect(clean.score).toBe(100);

    const oneWarn = runQualityGate({ text: "综上所述" });
    expect(oneWarn.score).toBe(92); // 100 - 8

    const oneBlock = runQualityGate({
      text: "sk-abcdefghijklmnop1234567890",
    });
    expect(oneBlock.score).toBe(60); // 100 - 40

    const twoBlocks = runQualityGate({
      text: "sk-abcdefghijklmnop1234567890 and localhost:3000",
    });
    expect(twoBlocks.score).toBe(20); // 100 - 80

    // Score floors at 0
    const manyBlocks = runQualityGate({
      text: "sk-abcdefghijklmnop1234567890 localhost:3000 192.168.1.1 /Users/test/data/ file:///path",
    });
    expect(manyBlocks.score).toBe(0);
    expect(manyBlocks.score).toBeGreaterThanOrEqual(0);
  });
});

describe("BLOCK — empty content", () => {
  it("blocks empty string", () => {
    const r = runQualityGate({ text: "" });
    expect(r.verdict).toBe("block");
    expect(r.issues.some((i) => i.rule === "empty-content")).toBe(true);
  });

  it("blocks whitespace-only string", () => {
    const r = runQualityGate({ text: "   \n  \t  " });
    expect(r.verdict).toBe("block");
    expect(r.issues.some((i) => i.rule === "empty-content")).toBe(true);
  });
});

describe("BLOCK — secret patterns", () => {
  it("detects sk- API key", () => {
    const r = runQualityGate({
      text: "配置: sk-ant-abcdefghijklmnopqrstuvwxyz01234567890",
    });
    expect(r.issues.find((i) => i.rule === "secret-api-key")).toBeDefined();
    expect(r.verdict).toBe("block");
  });

  it("detects GitHub token (ghp_)", () => {
    const r = runQualityGate({
      text: "token: ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });
    expect(r.issues.find((i) => i.rule === "secret-github-token")).toBeDefined();
  });

  it("detects Bearer token", () => {
    const r = runQualityGate({
      text: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789",
    });
    expect(r.issues.find((i) => i.rule === "secret-bearer")).toBeDefined();
  });

  it("detects Bearer token case-insensitively", () => {
    const r = runQualityGate({
      text: "authorization: bearer abcdefghijklmnopqrstuvwxyz0123456789",
    });
    expect(r.issues.find((i) => i.rule === "secret-bearer")).toBeDefined();
  });

  it("detects secret assignment (API_KEY=...)", () => {
    const r = runQualityGate({
      text: "API_KEY=mysecretkeyvalue123",
    });
    expect(r.issues.find((i) => i.rule === "secret-assignment")).toBeDefined();
  });

  it("detects secret assignment with PASSWORD:", () => {
    const r = runQualityGate({
      text: 'PASSWORD: "mypassword12345"',
    });
    expect(r.issues.find((i) => i.rule === "secret-assignment")).toBeDefined();
  });

  it("detects JWT token", () => {
    const r = runQualityGate({
      text: "token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    });
    expect(r.issues.find((i) => i.rule === "secret-jwt")).toBeDefined();
  });

  it("does NOT flag short random strings as secrets", () => {
    const r = runQualityGate({ text: "my key is sk-short" });
    expect(r.issues.find((i) => i.rule === "secret-api-key")).toBeUndefined();
  });
});

describe("BLOCK — leak patterns", () => {
  it("detects localhost", () => {
    const r = runQualityGate({ text: "访问 http://localhost:3000 查看" });
    expect(r.issues.find((i) => i.rule === "leak-localhost")).toBeDefined();
  });

  it("detects 127.0.0.1", () => {
    const r = runQualityGate({ text: "服务运行在 127.0.0.1:8080" });
    expect(r.issues.find((i) => i.rule === "leak-localhost")).toBeDefined();
  });

  it("detects 0.0.0.0", () => {
    const r = runQualityGate({ text: "绑定 0.0.0.0:5173" });
    expect(r.issues.find((i) => i.rule === "leak-localhost")).toBeDefined();
  });

  it("detects 10.x private IP", () => {
    const r = runQualityGate({ text: "内网地址 10.0.0.1" });
    expect(r.issues.find((i) => i.rule === "leak-private-ip")).toBeDefined();
  });

  it("detects 192.168.x private IP", () => {
    const r = runQualityGate({ text: "路由器地址 192.168.1.1" });
    expect(r.issues.find((i) => i.rule === "leak-private-ip")).toBeDefined();
  });

  it("detects 172.16-31.x private IP", () => {
    const r = runQualityGate({ text: "Docker 网络 172.17.0.1" });
    expect(r.issues.find((i) => i.rule === "leak-private-ip")).toBeDefined();
  });

  it("does NOT flag 172.32.x as private IP (out of range)", () => {
    const r = runQualityGate({ text: "公网地址 172.32.0.1" });
    expect(r.issues.find((i) => i.rule === "leak-private-ip")).toBeUndefined();
  });

  it("detects file:// URL", () => {
    const r = runQualityGate({ text: "本地文件 file:///Users/doc/test.md" });
    expect(r.issues.find((i) => i.rule === "leak-file-url")).toBeDefined();
  });

  it("detects Unix absolute path (/Users/...)", () => {
    const r = runQualityGate({ text: "文件路径 /Users/john/Documents/notes.md" });
    expect(r.issues.find((i) => i.rule === "leak-abs-path-unix")).toBeDefined();
  });

  it("detects Unix absolute path (/home/...)", () => {
    const r = runQualityGate({ text: "位于 /home/user/project/src/" });
    expect(r.issues.find((i) => i.rule === "leak-abs-path-unix")).toBeDefined();
  });

  it("detects Windows absolute path", () => {
    const r = runQualityGate({ text: "路径 C:\\Users\\Admin\\Documents\\" });
    expect(r.issues.find((i) => i.rule === "leak-abs-path-win")).toBeDefined();
  });
});

describe("WARN — AI flavor phrases", () => {
  const aiPhrases = [
    "综上所述",
    "总而言之",
    "总的来说",
    "值得注意的是",
    "不难发现",
    "在当今",
    "随着科技的发展",
    "让我们一起",
    "希望对你有所帮助",
    "赋能",
    "抓手",
    "闭环",
    "颠覆认知",
    "干货满满",
    "码住",
    "速速收藏",
    "首先，",
    "其次，",
    "最后，",
    "delve into",
    "In today's fast-paced",
    "unlock the power of",
    "game-changer",
  ];

  it.each(aiPhrases)('flags AI phrase: "%s"', (phrase) => {
    const r = runQualityGate({ text: `这篇文章${phrase}很重要。` });
    const aiIssues = r.issues.filter((i) => i.rule === "ai-flavor");
    expect(aiIssues.length).toBeGreaterThan(0);
    expect(aiIssues[0].level).toBe("warn");
    expect(aiIssues[0].suggestion).toBeDefined();
  });

  it("does not flag normal text as AI flavor", () => {
    const r = runQualityGate({
      text: "我今天买了一杯咖啡，味道还不错。下午去公园散了会步。",
    });
    expect(r.issues.filter((i) => i.rule === "ai-flavor")).toHaveLength(0);
  });
});

describe("WARN — absolute claims", () => {
  const claims = [
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

  it.each(claims)('flags absolute claim: "%s"', (claim) => {
    const r = runQualityGate({ text: `我们的产品${claim}效果。` });
    const claimIssues = r.issues.filter((i) => i.rule === "absolute-claim");
    expect(claimIssues.length).toBeGreaterThan(0);
    expect(claimIssues[0].level).toBe("warn");
  });

  it("is case-insensitive for English claims", () => {
    const r = runQualityGate({ text: "This is GUARANTEED to work." });
    expect(r.issues.filter((i) => i.rule === "absolute-claim").length).toBeGreaterThan(0);
  });
});

describe("WARN — platform length limits", () => {
  it("warns when text exceeds xiaohongshu limit (1000 chars)", () => {
    const longText = "字".repeat(1001);
    const r = runQualityGate({ text: longText, platform: "xiaohongshu" });
    const lenIssue = r.issues.find((i) => i.rule === "platform-length");
    expect(lenIssue).toBeDefined();
    expect(lenIssue?.level).toBe("warn");
    expect(r.stats.platform).toBe("xiaohongshu");
    expect(r.stats.platformLimit).toBe(1000);
  });

  it("passes when text is under platform limit", () => {
    const text = "字".repeat(500);
    const r = runQualityGate({ text, platform: "xiaohongshu" });
    expect(r.issues.find((i) => i.rule === "platform-length")).toBeUndefined();
    expect(r.verdict).toBe("pass");
  });

  it("boundary: exactly at limit passes", () => {
    const text = "字".repeat(1000);
    const r = runQualityGate({ text, platform: "xiaohongshu" });
    expect(r.issues.find((i) => i.rule === "platform-length")).toBeUndefined();
  });

  it("boundary: one over limit triggers warn", () => {
    const text = "字".repeat(1001);
    const r = runQualityGate({ text, platform: "xiaohongshu" });
    expect(r.issues.find((i) => i.rule === "platform-length")).toBeDefined();
  });

  it("zhihu has much higher limit (50000)", () => {
    const text = "字".repeat(1000);
    const r = runQualityGate({ text, platform: "zhihu" });
    expect(r.issues.find((i) => i.rule === "platform-length")).toBeUndefined();
    expect(r.stats.platformLimit).toBe(50_000);
  });

  it("does not check length when platform is not provided", () => {
    const longText = "字".repeat(10000);
    const r = runQualityGate({ text: longText });
    expect(r.issues.find((i) => i.rule === "platform-length")).toBeUndefined();
    expect(r.stats.platform).toBeUndefined();
    expect(r.stats.platformLimit).toBeUndefined();
  });

  it("all defined platforms have positive limits", () => {
    expect(PLATFORM_LIMITS.length).toBeGreaterThan(0);
    for (const p of PLATFORM_LIMITS) {
      expect(p.limit).toBeGreaterThan(0);
      expect(p.key).toBeTruthy();
      expect(p.label).toBeTruthy();
    }
  });
});

describe("INFO — no-structure hint", () => {
  it("suggests line breaks for long unbroken text (no platform)", () => {
    const longPara = "这是一段很长的文字。".repeat(10); // > 40 chars, no newlines
    const r = runQualityGate({ text: longPara });
    expect(r.issues.find((i) => i.rule === "no-structure")).toBeDefined();
    expect(r.issues.find((i) => i.rule === "no-structure")?.level).toBe("info");
  });

  it("does not suggest when text has line breaks", () => {
    const text = "第一段内容。\n第二段内容。\n第三段内容。".repeat(5);
    const r = runQualityGate({ text });
    expect(r.issues.find((i) => i.rule === "no-structure")).toBeUndefined();
  });

  it("does not suggest for short text", () => {
    const r = runQualityGate({ text: "短文本" });
    expect(r.issues.find((i) => i.rule === "no-structure")).toBeUndefined();
  });

  it("does not suggest when platform is provided (length is checked instead)", () => {
    const longPara = "这是一段很长的文字。".repeat(10);
    const r = runQualityGate({ text: longPara, platform: "weibo" });
    expect(r.issues.find((i) => i.rule === "no-structure")).toBeUndefined();
  });

  it("boundary: 39 chars does NOT trigger", () => {
    const text = "字".repeat(39);
    const r = runQualityGate({ text });
    expect(r.issues.find((i) => i.rule === "no-structure")).toBeUndefined();
  });

  it("boundary: 40 chars triggers no-structure", () => {
    const text = "字".repeat(40);
    const r = runQualityGate({ text });
    expect(r.issues.find((i) => i.rule === "no-structure")).toBeDefined();
  });
});

describe("stats accuracy", () => {
  it("counts characters correctly (including CJK)", () => {
    const r = runQualityGate({ text: "你好世界" });
    expect(r.stats.charCount).toBe(4);
  });

  it("counts lines correctly", () => {
    const r = runQualityGate({ text: "line1\nline2\nline3" });
    expect(r.stats.lineCount).toBe(3);
  });

  it("handles CRLF line endings", () => {
    const r = runQualityGate({ text: "line1\r\nline2" });
    expect(r.stats.lineCount).toBe(2);
  });
});

describe("edge cases", () => {
  it("handles null-like text gracefully (undefined → empty)", () => {
    // @ts-expect-error testing runtime resilience
    const r = runQualityGate({ text: undefined });
    expect(r.verdict).toBe("block"); // empty-content
  });

  it("handles very long text without crashing", () => {
    const longText = "a".repeat(100_000);
    const r = runQualityGate({ text: longText });
    expect(r.stats.charCount).toBe(100_000);
    expect(r.verdict).toBe("pass");
  });

  it("issue objects carry suggestion for block and warn rules", () => {
    const r = runQualityGate({
      text: "sk-abcdefghijklmnop1234567890 综上所述",
    });
    for (const issue of r.issues) {
      if (issue.level === "block" || issue.level === "warn") {
        expect(issue.suggestion).toBeDefined();
        expect(typeof issue.suggestion).toBe("string");
      }
    }
  });

  it("multiple issues of the same rule type each get recorded", () => {
    const r = runQualityGate({
      text: "综上所述，总的来说，这是最佳的方案，也是最好的选择。",
    });
    const aiFlavorCount = r.issues.filter((i) => i.rule === "ai-flavor").length;
    const absoluteCount = r.issues.filter((i) => i.rule === "absolute-claim").length;
    expect(aiFlavorCount).toBe(2);
    expect(absoluteCount).toBe(2);
  });
});
