import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconCheck, IconDots, IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { askAgent } from "@/lib/easel";
import { cn } from "@/lib/utils";

export function meta() {
  return [{ title: `画像 — ${APP_TITLE}` }];
}

const DIMENSIONS: Array<{ key: string; label: string }> = [
  { key: "hasIdentity", label: "定位" },
  { key: "hasStyle", label: "风格" },
  { key: "hasAudience", label: "受众" },
  { key: "hasPlatforms", label: "平台" },
  { key: "hasPreferences", label: "红线" },
  { key: "hasMemory", label: "记忆" },
];

export default function ProfileRoute() {
  useSetPageTitle("画像");
  const query = useActionQuery("profiles", {});
  const setActive = useActionMutation("profile-set-active");
  const remove = useActionMutation("profile-delete");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const profiles = query.data?.profiles ?? [];
  const busy = setActive.isPending || remove.isPending;

  function confirmDelete() {
    if (!deletingId) return;
    remove.mutate(
      { id: deletingId },
      {
        onSuccess: () => setDeletingId(null),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4 lg:p-6">
      <div>
        <Button
          onClick={() =>
            askAgent(
              "用 profile-builder 技能引导我新建一个账号画像：依次问清定位、风格、受众、平台、偏好红线，整理成六维后用 profile-save 保存并设为激活。",
              "easel:new-profile",
            )
          }
        >
          <IconPlus className="size-4" strokeWidth={1.8} />
          新建画像
        </Button>
      </div>

      {query.isPending ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : query.isError ? (
        <p className="text-muted-foreground text-sm">画像读取失败，请刷新重试。</p>
      ) : profiles.length === 0 ? (
        <div className="border-border rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground text-sm">
            还没有画像 — 定位、风格、受众等六维信息会作为全层创作的依据。
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {profiles.map((profile) => (
            <Card key={profile.id}>
              <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="min-w-0 truncate text-base">
                  {profile.name}
                </CardTitle>
                <div className="flex shrink-0 items-center gap-1">
                  {profile.active ? (
                    <Badge>激活</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        setActive.mutate(
                          { id: profile.id },
                          { onError: (error) => toast.error(error.message) },
                        )
                      }
                    >
                      激活
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`管理 ${profile.name}`}
                        className="text-muted-foreground size-7 p-0"
                      >
                        <IconDots className="size-4" strokeWidth={1.8} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() =>
                          askAgent(
                            `请编辑画像「${profile.name}」：读取它的六维内容，问我需要调整哪些维度，整理后用 profile-save（id: ${profile.id}）更新。`,
                            "easel:edit-profile",
                          )
                        }
                      >
                        编辑画像
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => setDeletingId(profile.id)}
                      >
                        删除画像
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  {DIMENSIONS.map((dimension) => {
                    const filled = Boolean(
                      profile[dimension.key as keyof typeof profile],
                    );
                    return (
                      <span
                        key={dimension.key}
                        className={cn(
                          "inline-flex items-center gap-1",
                          filled
                            ? "text-foreground"
                            : "text-muted-foreground/50",
                        )}
                      >
                        <IconCheck
                          className={cn("size-3", !filled && "opacity-30")}
                          strokeWidth={1.8}
                        />
                        {dimension.label}
                      </span>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog
        open={deletingId !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这个画像？</AlertDialogTitle>
            <AlertDialogDescription>
              {profiles.find((profile) => profile.id === deletingId)?.name}
              的六维内容会一并删除，且不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className={cn("bg-destructive text-white hover:bg-destructive/90")}
            >
              <IconTrash className="size-4" strokeWidth={1.8} />
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
