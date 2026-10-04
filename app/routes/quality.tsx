import { useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
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
  { key: "xiaohongshu", limit: 1000 },
  { key: "weibo", limit: 2000 },
  { key: "douyin", limit: 1000 },
  { key: "bilibili", limit: 2000 },
  { key: "zhihu", limit: 50000 },
  { key: "kuaishou", limit: 1000 },
  { key: "wechat-channels", limit: 1000 },
  { key: "wechat-oa", limit: 30000 },
] as const;

type PlatformKey = (typeof PLATFORMS)[number]["key"];

const VERDICT_KEYS: Record<string, string> = {
  pass: "easel.verdict.pass",
  warn: "easel.verdict.warn",
  block: "easel.verdict.block",
};

export default function QualityRoute() {
  const t = useT();
  useSetPageTitle(t("easel.nav.quality"));
  const [text, setText] = useState("");
  const [platform, setPlatform] = useState("none");
  const gate = useActionMutation("quality-gate");

  const result = gate.data;
  const charCount = [...text].length;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 lg:p-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("easel.quality.contentTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={10}
            placeholder={t("easel.quality.placeholder")}
            className="resize-y font-mono text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder={t("easel.quality.platformPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("easel.quality.anyPlatform")}</SelectItem>
                {PLATFORMS.map((item) => (
                  <SelectItem key={item.key} value={item.key}>
                    {t("easel.quality.platformOption", {
                      label: t(`easel.platform.${item.key}`, { defaultValue: item.key }),
                      limit: item.limit.toLocaleString(),
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground text-xs tabular-nums">
              {t("easel.common.charCount", { count: charCount })}
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
              {t("easel.quality.runGate")}
            </Button>
          </div>
          {gate.isError ? (
            <p className="text-destructive text-sm">
              {t("easel.quality.runFailed", { error: gate.error.message })}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {result ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">
              {t(VERDICT_KEYS[result.verdict] ?? "", { defaultValue: result.verdict })}
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm tabular-nums">
                {t("easel.quality.score", { count: result.score })}
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
                {result.verdict === "pass" ? t("easel.quality.publishable") : t("easel.quality.issueCount", { count: result.issues.length })}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-muted-foreground text-xs tabular-nums">
              {t("easel.common.charCount", { count: result.stats.charCount })} · {t("easel.common.lineCount", { count: result.stats.lineCount })}
              {result.stats.platformLimit
                ? ` · ${t("easel.quality.limit", { count: result.stats.platformLimit })}`
                : ""}
            </div>
            {result.issues.length === 0 ? (
              <p className="text-sm">{t("easel.quality.noIssues")}</p>
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
                        ? t("easel.quality.levelBlock")
                        : issue.level === "warn"
                          ? t("easel.quality.levelWarn")
                          : t("easel.quality.levelInfo")}
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
                {t("easel.quality.fixCta")}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
