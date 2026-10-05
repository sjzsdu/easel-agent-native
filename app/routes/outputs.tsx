import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconDots } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { APP_TITLE } from "@/lib/app-config";
import { askAgent, timestampLabel } from "@/lib/easel";

export function meta() {
  return [{ title: `内容库 — ${APP_TITLE}` }];
}

interface MediaPreviewFile {
  path: string;
  name: string;
  kind: "image" | "audio" | "video";
  bytes: number;
}

/**
 * 媒体预览 URL。listMediaFiles 返回的 path 是「项目内相对路径」(不含主题目录),
 * 预览路由是 /outputs/<主题>/<path>, 所以这里要把主题拼回去, 并逐段做
 * URL 编码 — 主题名常含中文与空格, 不编码在部分浏览器/代理下会 400。
 */
function mediaUrl(topic: string, file: MediaPreviewFile): string {
  const rel = `${topic}/${file.path}`;
  return `/outputs/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

function MediaPreview({
  topic,
  files,
}: {
  topic: string;
  files: MediaPreviewFile[];
}) {
  if (!files.length) return null;
  const images = files.filter((f) => f.kind === "image");
  const videos = files.filter((f) => f.kind === "video");
  const audios = files.filter((f) => f.kind === "audio");
  return (
    <div className="space-y-2">
      {images.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {images.map((file) => (
            <a key={file.path} href={mediaUrl(topic, file)} target="_blank" rel="noreferrer">
              <img
                src={mediaUrl(topic, file)}
                alt={file.name}
                loading="lazy"
                className="border-border h-24 w-full rounded-md border object-cover transition-opacity hover:opacity-80"
              />
            </a>
          ))}
        </div>
      ) : null}
      {videos.map((file) => (
        <video
          key={file.path}
          src={mediaUrl(topic, file)}
          controls
          preload="metadata"
          className="border-border max-h-56 w-full rounded-md border"
        />
      ))}
      {audios.map((file) => (
        <audio
          key={file.path}
          src={mediaUrl(topic, file)}
          controls
          preload="none"
          className="w-full"
        />
      ))}
    </div>
  );
}

export default function OutputsRoute() {
  const t = useT();
  useSetPageTitle(t("easel.nav.outputs"));
  const [status, setStatus] = useState("all");
  const query = useActionQuery("outputs", {});

  const projects = (query.data?.projects ?? []).filter(
    (project) =>
      status === "all" || (project.manifest.status ?? "draft") === status,
  );
  const statusKeys = Object.keys(query.data?.statusCounts ?? {});

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center gap-1">
        {["all", ...statusKeys].map((key) => (
          <Button
            key={key}
            size="sm"
            variant={status === key ? "secondary" : "ghost"}
            onClick={() => setStatus(key)}
          >
            {key === "all"
              ? t("easel.common.all")
              : t(`easel.status.${key}`, { defaultValue: key })}
            {key === "all"
              ? ` ${query.data?.total ?? 0}`
              : ` ${(query.data?.statusCounts ?? {})[key] ?? 0}`}
          </Button>
        ))}
      </div>

      {query.isPending ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : query.isError ? (
        <p className="text-muted-foreground text-sm">{t("easel.outputs.fetchFailed")}</p>
      ) : (query.data?.total ?? 0) === 0 ? (
        <div className="border-border rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground mb-4 text-sm">
            {t("easel.outputs.empty")}
          </p>
          <Button asChild>
            <Link to="/home">{t("easel.outputs.openChat")}</Link>
          </Button>
        </div>
      ) : projects.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("easel.outputs.noStatusProjects")}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects.map((project) => {
            const manifest = project.manifest;
            const title = manifest.title || project.topic;
            return (
              <Card key={project.topic}>
                <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
                  <CardTitle className="min-w-0 text-base break-words">
                    {title}
                  </CardTitle>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("easel.outputs.manage", { title })}
                        className="text-muted-foreground size-7 shrink-0 p-0"
                      >
                        <IconDots className="size-4" strokeWidth={1.8} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() =>
                          askAgent(
                            `继续加工内容项目 outputs/${project.topic}（标题「${title}」${manifest.summary ? `，摘要：${manifest.summary}` : ""}）：先读它的 .easel.json 和已有文件，从上次的 steps 接着推进，完成后用 output-manifest 记录这一步。`,
                            "easel:continue-project",
                          )
                        }
                      >
                        {t("easel.outputs.continueProject")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          askAgent(
                            `对内容项目 outputs/${project.topic}（「${title}」）的全部成品文件跑 quality-gate 质检：逐个文件读取正文检查，block 项必须修复后重新写回，并用 output-manifest 记录结果。`,
                            "easel:gate-project",
                          )
                        }
                      >
                        {t("easel.outputs.gateProject")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          askAgent(
                            `用 content-postmortem 技能对内容项目 outputs/${project.topic}（「${title}」）做复盘：总结本次流程中的经验与坑，把可复用的结论写回激活画像的 memory，并用 output-manifest 记录复盘步骤。`,
                            "easel:postmortem",
                          )
                        }
                      >
                        {t("easel.outputs.postmortem")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent className="space-y-2">
                  <MediaPreview topic={project.topic} files={project.mediaFiles ?? []} />
                  {manifest.summary ? (
                    <p className="text-muted-foreground line-clamp-2 text-sm">
                      {manifest.summary}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary">
                      {t(`easel.status.${manifest.status ?? "draft"}`, { defaultValue: manifest.status ?? "draft" })}
                    </Badge>
                    {manifest.platform ? (
                      <Badge variant="outline" className="text-muted-foreground">
                        {manifest.platform}
                      </Badge>
                    ) : null}
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {t("easel.outputs.files", { count: project.fileCount })}
                      {manifest.updated
                        ? ` · ${timestampLabel(manifest.updated)}`
                        : ""}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
