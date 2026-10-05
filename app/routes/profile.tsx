import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
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

const DIMENSIONS: Array<{ key: string; labelKey: string }> = [
  { key: "hasIdentity", labelKey: "easel.profile.dimIdentity" },
  { key: "hasStyle", labelKey: "easel.profile.dimStyle" },
  { key: "hasAudience", labelKey: "easel.profile.dimAudience" },
  { key: "hasPlatforms", labelKey: "easel.profile.dimPlatforms" },
  { key: "hasPreferences", labelKey: "easel.profile.dimPreferences" },
  { key: "hasMemory", labelKey: "easel.profile.dimMemory" },
];

export default function ProfileRoute() {
  const t = useT();
  useSetPageTitle(t("easel.nav.profile"));
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
          {t("easel.profile.newProfile")}
        </Button>
      </div>

      {query.isPending ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : query.isError ? (
        <p className="text-muted-foreground text-sm">{t("easel.profile.fetchFailed")}</p>
      ) : profiles.length === 0 ? (
        <div className="border-border rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground text-sm">
            {t("easel.profile.empty")}
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
                    <Badge>{t("easel.profile.activeBadge")}</Badge>
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
                      {t("easel.profile.activate")}
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("easel.profile.manage", { name: profile.name })}
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
                        {t("easel.profile.editProfile")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => setDeletingId(profile.id)}
                      >
                        {t("easel.profile.deleteProfile")}
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
                        {t(dimension.labelKey)}
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
            <AlertDialogTitle>{t("easel.profile.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("easel.profile.deleteDesc", {
                name: profiles.find((profile) => profile.id === deletingId)?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("easel.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className={cn("bg-destructive text-white hover:bg-destructive/90")}
            >
              <IconTrash className="size-4" strokeWidth={1.8} />
              {t("easel.common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
