import { describe, expect, it } from "vitest";

import { runQualityGate } from "../../server/lib/quality-rules.js";

/**
 * 套话/AI 味启发式 (2026-09-25 试用反馈新增):
 * 反馈实测一篇 100/100 通过的文案 agent 自述「有几处略像套话」—
 * 泛化开头、通用劝告、收藏型 CTA 此前不在确定性规则里, 现在补上 (warn 级)。
 */

describe("WARN — generic opening (泛化开头)", () => {
  const openings = [
    "在这个信息爆炸的时代，每个人都可以做内容。",
    "在当今社会，短视频已经成为主流。",
    "随着短视频平台的爆发，越来越多人开始做自媒体。",
    "大家好，今天给大家分享一下我的经验。",
    "你有没有发现，身边做副业的人越来越多了？",
  ];

  it.each(openings)("flags generic opening: %s", (opening) => {
    const r = runQualityGate({ text: `${opening}\n\n正文里全是具体的做法和数字。` });
    const issues = r.issues.filter((i) => i.rule === "generic-opening");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.level).toBe("warn");
    expect(issues[0]!.suggestion).toBeDefined();
  });

  it("does not flag an opening that goes straight to the point", () => {
    const r = runQualityGate({
      text: "连续 30 天早上 6 点发笔记，我的收藏率翻了 3 倍。\n\n具体做法如下：",
    });
    expect(r.issues.filter((i) => i.rule === "generic-opening")).toHaveLength(0);
  });

  it("only checks the first 60 chars (mid-text 在这个 doesn't trigger)", () => {
    const body = `开头直接讲一个具体案例，铺垫足够多的具体细节。${"正文内容。".repeat(10)}在这个时间点回头看。`;
    const r = runQualityGate({ text: body });
    expect(r.issues.filter((i) => i.rule === "generic-opening")).toHaveLength(0);
  });
});

describe("WARN — generic advice (通用劝告)", () => {
  it("flags 空泛的要坚持句式", () => {
    const r = runQualityGate({
      text: "做自媒体不容易，所以大家一定要坚持，不要放弃。\n\n（正文别无其他问题）",
    });
    const issues = r.issues.filter((i) => i.rule === "generic-advice");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.level).toBe("warn");
  });

  it("does not flag advice pointing at a concrete action", () => {
    const r = runQualityGate({
      text: "坚持每天 9 点发一条，连续 7 天看后台数据变化，这比什么都不做强。",
    });
    expect(r.issues.filter((i) => i.rule === "generic-advice")).toHaveLength(0);
  });
});

describe("WARN — collect CTA (收藏型/索互动 CTA)", () => {
  const ctas = [
    "建议收藏起来慢慢看。",
    "码住，怕以后找不到。",
    "先收藏，备考的时候翻出来复习。",
    "点赞收藏，关注不迷路。",
    "觉得有用的话求点赞。",
  ];

  it.each(ctas)("flags collect CTA: %s", (cta) => {
    const r = runQualityGate({ text: `干货正文，含具体步骤一二三。\n\n${cta}` });
    const issues = r.issues.filter((i) => i.rule === "collect-cta");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.level).toBe("warn");
  });

  it("flags 收藏型 CTA exactly once per phrase (moved out of ai-flavor)", () => {
    const r = runQualityGate({ text: "这篇值得收藏起来反复看。" });
    expect(r.issues.filter((i) => i.rule === "collect-cta").length).toBe(1);
    // 「收藏起来」不再是 ai-flavor 词表成员, 不允许同词双报。
    expect(r.issues.filter((i) => i.rule === "ai-flavor")).toHaveLength(0);
  });

  it("does not flag normal closing without begging CTA", () => {
    const r = runQualityGate({
      text: "以上就是完整的操作步骤。下篇写进阶版，有问题评论区聊。",
    });
    expect(r.issues.filter((i) => i.rule === "collect-cta")).toHaveLength(0);
  });
});

describe("反馈复盘案例 — 之前 100/100 的套话文案现在 warn", () => {
  it("the exact feedback case (泛化开头+通用劝告+收藏CTA) no longer passes clean", () => {
    const text = [
      "在这个快节奏的时代，越来越多的人想做自媒体。",
      "做号没有捷径，大家一定要坚持。",
      "这篇干货建议收藏，怕以后找不到。",
    ].join("\n");
    const r = runQualityGate({ text });
    expect(r.verdict).toBe("warn");
    expect(r.score).toBeLessThan(100);
    const rules = new Set(r.issues.map((i) => i.rule));
    expect(rules.has("generic-opening")).toBe(true);
    expect(rules.has("generic-advice")).toBe(true);
    expect(rules.has("collect-cta")).toBe(true);
  });

  it("clean concrete copy still passes 100/100", () => {
    const r = runQualityGate({
      text: "上周把主页简介从「分享干货」改成「帮职场新人写周报」，一周涨了 214 个精准粉。\n\n改法放图 2，直接抄。",
    });
    expect(r.verdict).toBe("pass");
    expect(r.score).toBe(100);
  });
});
