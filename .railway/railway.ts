import { defineRailway, github, project, service } from "railway/iac";

export default defineRailway(() => {
  const web = service("web", {
    source: github("ajpettersen/lineuplab"),
    build: "pnpm run build",
    start: "node artifacts/api-server/dist/index.mjs",
  });

  return project("lineuplab", {
    resources: [web],
  });
});
