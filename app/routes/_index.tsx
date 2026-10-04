import { appPath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import { IconArrowRight } from "@tabler/icons-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { APP_TITLE } from "@/lib/app-config";

const SEO_TITLE = `${APP_TITLE} — 私人社媒运营工作台`;
const SEO_DESCRIPTION =
  "从热点发现到内容归因，Easel 把社媒运营的五步流程收进一个工作台：发现、策划、创作、发布、归因。";

export function meta() {
  return [
    { title: SEO_TITLE },
    { name: "description", content: SEO_DESCRIPTION },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: SEO_TITLE },
    { name: "twitter:description", content: SEO_DESCRIPTION },
  ];
}

const LAYERS = [
  { num: "01", nameKey: "easel.landing.layer1Name", descKey: "easel.landing.layer1Desc" },
  { num: "02", nameKey: "easel.landing.layer2Name", descKey: "easel.landing.layer2Desc" },
  { num: "03", nameKey: "easel.landing.layer3Name", descKey: "easel.landing.layer3Desc" },
  { num: "04", nameKey: "easel.landing.layer4Name", descKey: "easel.landing.layer4Desc" },
  { num: "05", nameKey: "easel.landing.layer5Name", descKey: "easel.landing.layer5Desc" },
];

export default function LandingPage() {
  const t = useT();

  return (
    <div className="bg-background text-foreground min-h-dvh">
      <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-6 py-16">
        <header className="flex items-center justify-between">
          <span className="text-lg font-semibold tracking-tight">
            {APP_TITLE}
          </span>
          <Button variant="ghost" size="sm" asChild>
            <Link to={appPath("/sign-in")}>{t("easel.landing.login")}</Link>
          </Button>
        </header>

        <main className="flex flex-1 flex-col justify-center py-20">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            {t("easel.landing.heroTitle")}
          </h1>
          <p className="text-muted-foreground mt-4 max-w-xl text-lg leading-relaxed">
            {t("easel.landing.heroDesc")}
          </p>
          <div className="mt-8 flex items-center gap-3">
            <Button size="lg" asChild>
              <Link to={appPath("/home")}>
                {t("easel.landing.enter")}
                <IconArrowRight className="size-4" strokeWidth={1.8} />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to={appPath("/sign-in")}>{t("easel.landing.signup")}</Link>
            </Button>
          </div>
        </main>

        <section className="border-border border-t pt-12">
          <div className="grid gap-6 sm:grid-cols-5">
            {LAYERS.map((layer) => (
              <div key={layer.num} className="space-y-1.5">
                <div className="text-muted-foreground/50 text-xs tabular-nums">
                  {layer.num}
                </div>
                <div className="font-medium">{t(layer.nameKey)}</div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {t(layer.descKey)}
                </p>
              </div>
            ))}
          </div>
        </section>

        <footer className="text-muted-foreground/50 mt-16 text-xs">
          {t("easel.landing.footer", { app: APP_TITLE })}
        </footer>
      </div>
    </div>
  );
}
