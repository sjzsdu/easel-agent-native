import { useActionMutation } from "@agent-native/core/client/hooks";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconCheck, IconLoader2 } from "@tabler/icons-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { APP_TITLE } from "@/lib/app-config";
import { askAgent } from "@/lib/easel";

export function meta() {
  return [{ title: `质检 — ${APP_TITLE}` }];
}

const PLATFORMS = [
  { key: "xiaohongshu", label: "小红书（1000 字）" },
  { key: "weibo", label: "微博（2000 字）" },
  { key: "douyin", label: "抖音（1000 字）" },
  { key: "bilibili", label: "B站（2000 字）" },
  { key: "zhihu", label: "知乎（50000 字）" },
  { key: "kuaishou", label: "快手（1000 字）" },
  { key: "wechat-channels", label: "视频号（1000 字）" },
  { key: "wechat-oa", label: "公众号（30000 字）" },
] as const;

type PlatformKey = (typeof PLATFORMS)[number]["key"];

const VERDICT_LABELS: Record<string, string> = {
  pass: "通过",
  warn: "需复核",
  block: "禁止发布",
};

export default function QualityRoute() {
  useSetPageTitle("质检");
  const [text, setText] = useState("");
  const [platform, setPlatform] = useState("none");
  const gate = useActionMutation("quality-gate");

  const result = gate.data;
  const charCount = [...text].length;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 lg:p-6">
      <Card>
        <CardHeader>
          <CardTitle>待发布文案</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={10}
            placeholder="粘贴要发布的正文…"
            className="resize-y font-mono text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="目标平台（可选）" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">不限平台</SelectItem>
                {PLATFORMS.map((item) => (
                  <SelectItem key={item.key} value={item.key}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground text-xs tabular-nums">
              {charCount} 字
            </span>
            <Button
              className="ml-auto"
              disabled={gate.isPending || !text.trim()}
              onClick={() =>
                gate.mutate({
                  text,
                  platform:
                    platform === "none" ? undefined : (platform as PlatformKey),
                })
              }
            >
              {gate.isPending ? (
                <IconLoader2 className="size-4 animate-spin" strokeWidth={1.8} />
              ) : (
                <IconCheck className="size-4" strokeWidth={1.8} />
              )}
              运行门禁
            </Button>
          </div>
          {gate.isError ? (
            <p className="text-destructive text-sm">
              门禁运行失败：{gate.error.message}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {result ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">
              {VERDICT_LABELS[result.verdict] ?? result.verdict}
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm tabular-nums">
                {result.score} 分
              </span>
              <Badge
                variant={
                  result.verdict === "block"
                    ? "destructive"
                    : result.verdict === "warn"
                      ? "secondary"
                      : "outline"
                }
              >
                {result.verdict === "pass" ? "可发布" : `${result.issues.length} 个问题`}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-muted-foreground text-xs tabular-nums">
              {result.stats.charCount} 字 · {result.stats.lineCount} 行
              {result.stats.platformLimit
                ? ` · 限制 ${result.stats.platformLimit} 字`
                : ""}
            </div>
            {result.issues.length === 0 ? (
              <p className="text-sm">没有发现确定性规则问题。</p>
            ) : (
              <ul className="space-y-2">
                {result.issues.map((issue, index) => (
                  <li key={`${issue.rule}-${index}`} className="flex items-start gap-2 text-sm">
                    <Badge
                      variant={
                        issue.level === "block"
                          ? "destructive"
                          : issue.level === "warn"
                            ? "secondary"
                            : "outline"
                      }
                      className="mt-0.5 shrink-0"
                    >
                      {issue.level === "block"
                        ? "硬拦"
                        : issue.level === "warn"
                          ? "警告"
                          : "建议"}
                    </Badge>
                    <span className="min-w-0">
                      {issue.message}
                      {issue.suggestion ? (
                        <span className="text-muted-foreground block text-xs">
                          {issue.suggestion}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {result.verdict !== "pass" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  askAgent(
                    `我的文案触发了门禁（verdict=${result.verdict}）：\n\n${text}\n\n请逐条修复列出的问题（保留原意与平台风格），改完后重新跑 quality-gate 直到 verdict=pass。`,
                    "easel:fix-gate",
                  )
                }
              >
                让 Agent 修复这些问题
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
