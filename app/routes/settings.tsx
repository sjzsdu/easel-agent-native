import { LanguagePicker, useT } from "@agent-native/core/client/i18n";
import {
  AccountSettingsCard,
  SettingsGroup,
  SettingsRow,
  SettingsTabsPage,
  useAgentSettingsTabs,
  type SettingsSearchEntry,
  type SettingsTabItem,
} from "@agent-native/core/client/settings";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconCheck, IconMinus } from "@tabler/icons-react";
import { useMemo } from "react";

import { useActionQuery } from "@agent-native/core/client/hooks";
import { Badge } from "@/components/ui/badge";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `设置 — ${APP_TITLE}` }];
}

function PublishAccountsCard() {
  const t = useT();
  const { data, isLoading } = useActionQuery("publish-capabilities", {});

  const platforms = data?.platforms ?? [];

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <h3 className="text-lg font-medium">{t("easel.settings.publishAccounts")}</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("easel.settings.publishAccountsDesc")}
        </p>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm">{t("easel.settings.loading")}</div>
      ) : (
        <div className="space-y-3">
          {platforms.map((p: { platform: string; label: string; capabilities: { autoPublish: boolean; authRequired: boolean; howToConnect: string; note: string } }) => {
            const connected = p.capabilities.autoPublish && p.capabilities.authRequired;
            return (
              <div
                key={p.platform}
                className="flex items-center justify-between gap-4 rounded-lg border border-border p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.label}</span>
                    {connected ? (
                      <Badge variant="secondary" className="gap-1">
                        <IconCheck className="size-3" strokeWidth={1.8} />
                        {t("easel.settings.connected")}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1">
                        <IconMinus className="size-3" strokeWidth={1.8} />
                        {t("easel.settings.notConnected")}
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                    {p.capabilities.howToConnect}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function SettingsRoute() {
  const t = useT();
  const agentSettingsTabs = useAgentSettingsTabs();
  useSetPageTitle(t("settings.title"));

  const publishTab: SettingsTabItem = {
    id: "publish-accounts",
    label: t("easel.settings.publishAccounts"),
    content: <PublishAccountsCard />,
  };

  const allExtraTabs = [...agentSettingsTabs, publishTab];

  const generalSearchEntries = useMemo<SettingsSearchEntry[]>(
    () => [
      {
        id: "chat-language",
        label: t("settings.languageTitle"),
        keywords: "language locale translation i18n",
        hash: "language",
      },
    ],
    [t],
  );

  return (
    <SettingsTabsPage
      account={<AccountSettingsCard />}
      extraTabs={allExtraTabs}
      generalSearchEntries={generalSearchEntries}
      general={
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <p className="text-sm leading-6 text-muted-foreground">
            {t("settings.description")}
          </p>

          <SettingsGroup>
            <SettingsRow
              id="language"
              label={t("settings.languageTitle")}
              description={t("settings.languageDescription")}
              control={
                <div className="w-56">
                  <LanguagePicker label={t("settings.languageLabel")} />
                </div>
              }
            />
          </SettingsGroup>
        </div>
      }
    />
  );
}
