import { appPath } from "@agent-native/core/client/api-path";
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
  {
    num: "01",
    name: "发现",
    desc: "多平台热点雷达，按画像过滤 relevancy。",
  },
  {
    num: "02",
    name: "策划",
    desc: "选题库看板管理，排期日历一目了然。",
  },
  {
    num: "03",
    name: "创作",
    desc: "Agent 按画像六维生成文案，质检门禁卡位。",
  },
  {
    num: "04",
    name: "发布",
    desc: "多平台队列发布，状态可追踪、可重试。",
  },
  {
    num: "05",
    name: "归因",
    desc: "发布记录留痕，为后续复盘积累数据。",
  },
];

export default function LandingPage() {
  return (
    <div className="bg-background text-foreground min-h-dvh">
      <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-6 py-16">
        <header className="flex items-center justify-between">
          <span className="text-lg font-semibold tracking-tight">
            {APP_TITLE}
          </span>
          <Button variant="ghost" size="sm" asChild>
            <Link to={appPath("/sign-in")}>登录</Link>
          </Button>
        </header>

        <main className="flex flex-1 flex-col justify-center py-20">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            私人社媒运营工作台
          </h1>
          <p className="text-muted-foreground mt-4 max-w-xl text-lg leading-relaxed">
            从热点发现到内容归因，把社媒运营的五步流程收进一个工作台。
            Agent 在侧边栏随时待命，页面承载持久状态。
          </p>
          <div className="mt-8 flex items-center gap-3">
            <Button size="lg" asChild>
              <Link to={appPath("/home")}>
                进入工作台
                <IconArrowRight className="size-4" strokeWidth={1.8} />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to={appPath("/sign-in")}>注册账号</Link>
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
                <div className="font-medium">{layer.name}</div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {layer.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        <footer className="text-muted-foreground/50 mt-16 text-xs">
          {APP_TITLE} — 单用户 · 本地优先 · Agent 驱动
        </footer>
      </div>
    </div>
  );
}
