import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import {
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconPlus,
  IconSend,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { APP_TITLE } from "@/lib/app-config";
import { askAgent } from "@/lib/easel";
import { cn } from "@/lib/utils";

export function meta() {
  return [{ title: `选题库 — ${APP_TITLE}` }];
}

type IdeaStatus = "pending" | "doing" | "done";

const COLUMNS: Array<{ key: IdeaStatus; labelKey: string }> = [
  { key: "pending", labelKey: "easel.ideas.columnPending" },
  { key: "doing", labelKey: "easel.ideas.columnDoing" },
  { key: "done", labelKey: "easel.ideas.columnDone" },
];

const NEXT_STATUS: Record<IdeaStatus, IdeaStatus | null> = {
  pending: "doing",
  doing: "done",
  done: null,
};

const PREV_STATUS: Record<IdeaStatus, IdeaStatus | null> = {
  pending: null,
  doing: "pending",
  done: "doing",
};

function ActionButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="text-muted-foreground hover:text-foreground size-7 p-0"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export default function IdeasRoute() {
  const t = useT();
  useSetPageTitle(t("easel.nav.ideas"));
  const query = useActionQuery("ideas", {});
  const save = useActionMutation("idea-save");
  const remove = useActionMutation("idea-delete");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const ideas = query.data?.ideas ?? [];
  const busy = save.isPending || remove.isPending;

  function submitNewIdea() {
    const title = draft.trim();
    if (!title) return;
    save.mutate(
      { title, status: "pending" },
      {
        onSuccess: () => {
          setDraft("");
          setAdding(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function move(id: string, status: IdeaStatus) {
    const idea = ideas.find((item) => item.id === id);
    if (!idea) return;
    save.mutate(
      { id, title: idea.title, status },
      { onError: (error) => toast.error(error.message) },
    );
  }

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
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() =>
            askAgent(
              "跑 trending-topics 获取今日热榜，结合激活画像和选题库现有选题（避免重复），出 3 条新选题，用 idea-save 存进选题库待做列。",
              "easel:topics-from-trends",
            )
          }
        >
          {t("easel.ideas.fromTrends")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAdding((value) => !value)}
        >
          {adding ? <IconX className="size-4" strokeWidth={1.8} /> : <IconPlus className="size-4" strokeWidth={1.8} />}
          {adding ? t("easel.common.cancel") : t("easel.ideas.addIdea")}
        </Button>
        {adding ? (
          <div className="flex min-w-64 flex-1 items-center gap-2">
            <Input
              autoFocus
              value={draft}
              placeholder={t("easel.ideas.titlePlaceholder")}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitNewIdea();
              }}
            />
            <Button size="sm" disabled={busy || !draft.trim()} onClick={submitNewIdea}>
              {t("easel.common.save")}
            </Button>
          </div>
        ) : null}
      </div>

      {query.isPending ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : query.isError ? (
        <p className="text-muted-foreground text-sm">{t("easel.ideas.fetchFailed")}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {COLUMNS.map((column) => {
            const columnIdeas = ideas.filter((idea) => idea.status === column.key);
            return (
              <section key={column.key} className="min-w-0">
                <div className="text-muted-foreground mb-2 flex items-baseline px-1 text-xs font-medium">
                  {t(column.labelKey)}
                  <span className="ml-2 tabular-nums">{columnIdeas.length}</span>
                </div>
                <div className="space-y-2">
                  {columnIdeas.length === 0 ? (
                    <p className="text-muted-foreground/70 border-border rounded-lg border border-dashed p-4 text-center text-sm">
                      {t("easel.ideas.empty")}
                    </p>
                  ) : null}
                  {columnIdeas.map((idea) => (
                    <article
                      key={idea.id}
                      className="border-border bg-card rounded-lg border p-3"
                    >
                      <p className="text-sm font-medium break-words">{idea.title}</p>
                      {idea.note ? (
                        <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                          {idea.note}
                        </p>
                      ) : null}
                      <div className="mt-2 flex items-center gap-1">
                        {idea.scheduledDate ? (
                          <span className="text-muted-foreground mr-auto inline-flex items-center gap-1 text-xs tabular-nums">
                            <IconClock className="size-3" strokeWidth={1.8} />
                            {idea.scheduledDate}
                          </span>
                        ) : (
                          <span className="mr-auto" />
                        )}
                        <ActionButton
                          label={t("easel.ideas.moveBack")}
                          disabled={busy || PREV_STATUS[idea.status] === null}
                          onClick={() =>
                            PREV_STATUS[idea.status] &&
                            move(idea.id, PREV_STATUS[idea.status]!)
                          }
                        >
                          <IconChevronLeft className="size-4" strokeWidth={1.8} />
                        </ActionButton>
                        <ActionButton
                          label={t("easel.ideas.advance")}
                          disabled={busy || NEXT_STATUS[idea.status] === null}
                          onClick={() =>
                            NEXT_STATUS[idea.status] &&
                            move(idea.id, NEXT_STATUS[idea.status]!)
                          }
                        >
                          <IconChevronRight className="size-4" strokeWidth={1.8} />
                        </ActionButton>
                        <ActionButton
                          label={t("easel.ideas.produce")}
                          disabled={busy}
                          onClick={() =>
                            askAgent(
                              `请为选题「${idea.title}」${idea.note ? `（切入点：${idea.note}）` : ""} 创作一版初稿：先确认目标平台与画像风格，产出文案后跑 quality-gate，把成品归档到 outputs/。`,
                              "easel:produce-from-idea",
                            )
                          }
                        >
                          <IconSend className="size-4" strokeWidth={1.8} />
                        </ActionButton>
                        <ActionButton
                          label={t("easel.ideas.deleteIdea")}
                          disabled={busy}
                          onClick={() => setDeletingId(idea.id)}
                        >
                          <IconTrash className="size-4" strokeWidth={1.8} />
                        </ActionButton>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
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
            <AlertDialogTitle>{t("easel.ideas.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {ideas.find((idea) => idea.id === deletingId)?.title}
              {t("easel.ideas.deleteDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("easel.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className={cn("bg-destructive text-white hover:bg-destructive/90")}
            >
              {t("easel.common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
