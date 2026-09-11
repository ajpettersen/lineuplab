import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const LineupLab = service("Lineup Lab", {
    source: github("ajpettersen/lineuplab", { checkSuites: false }),
    build:
      'pnpm run typecheck && pnpm --filter "...@workspace/api-server" --filter "...@workspace/baseball-lineup" run build && BASE_PATH=/promo-video/ pnpm --filter "@workspace/promo-video" run build',
    start: "node artifacts/api-server/dist/index.mjs",
    replicas: { "sfo": 1 },
    networking: { privateNetworkEndpoint: "web" },
    env: { AI_INTEGRATIONS_OPENAI_API_KEY: preserve(), AI_INTEGRATIONS_OPENAI_BASE_URL: preserve(), BASE_PATH: preserve(), CLERK_PUBLISHABLE_KEY: preserve(), CLERK_SECRET_KEY: preserve(), DATABASE_URL: preserve(), MASTER_ADMIN_USER_IDS: preserve(), NODE_ENV: preserve(), PORT: preserve(), VAPID_PUBLIC_KEY: preserve(), VAPID_SUBJECT: preserve(), VITE_CLERK_PUBLISHABLE_KEY: preserve() },
  });

  return project("lineuplab", {
    resources: [LineupLab],
  });
});
