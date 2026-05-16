#!/usr/bin/env node
/**
 * Post-codegen barrel fixup.
 *
 * Orval auto-rewrites the workspace-level `index.ts` for each output, assuming
 * mode "split" produces both `api.ts` and `api.schemas.ts`. That assumption is
 * true for the react-query client, but the zod client emits everything into a
 * single `api.ts`, so the auto-generated re-export of `./generated/api.schemas`
 * dangles and breaks both the build and typecheck.
 *
 * This script normalizes each barrel file based on what generated files
 * actually exist on disk. Run after `orval` and before `tsc --build`.
 */
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");

/**
 * Each entry: barrel = the file orval rewrites; extra = any hand-maintained
 * trailing lines we want to preserve (e.g. custom-fetch re-exports for the
 * react-query client).
 */
const barrels = [
  {
    barrel: resolve(root, "lib/api-zod/src/index.ts"),
    extra: "",
  },
  {
    barrel: resolve(root, "lib/api-client-react/src/index.ts"),
    extra: [
      'export { setBaseUrl, setAuthTokenGetter, ApiError } from "./custom-fetch";',
      'export type { AuthTokenGetter, ErrorType } from "./custom-fetch";',
      "",
    ].join("\n"),
  },
];

for (const { barrel, extra } of barrels) {
  if (!existsSync(barrel)) continue;
  const generatedDir = resolve(dirname(barrel), "generated");
  const lines = ["// Auto-fixed by lib/api-spec/scripts/fix-barrels.mjs"];
  if (existsSync(resolve(generatedDir, "api.ts"))) {
    lines.push('export * from "./generated/api";');
  }
  if (existsSync(resolve(generatedDir, "api.schemas.ts"))) {
    lines.push('export * from "./generated/api.schemas";');
  }
  const next = lines.join("\n") + "\n" + (extra ? extra + "\n" : "");
  const prev = readFileSync(barrel, "utf8");
  if (prev !== next) {
    writeFileSync(barrel, next);
    console.log(`fix-barrels: rewrote ${barrel}`);
  }
}
