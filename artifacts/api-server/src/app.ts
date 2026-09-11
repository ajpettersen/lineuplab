import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Clerk proxy must be mounted BEFORE body parsers — it streams raw bytes
// through to the Clerk frontend API.
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));

// Default JSON body parser for all routes except those that handle image
// uploads, which mount their own larger-limit parser at the route level.
// This keeps the global limit small (DoS surface low) while letting the
// few image-upload endpoints accept multi-MB base64 payloads.
const defaultJson = express.json();
app.use((req, res, next) => {
  if (/\/lineup\/from-image$/.test(req.path)) return next();
  return defaultJson(req, res, next);
});
app.use(express.urlencoded({ extended: true }));

// Resolve the publishable key from the incoming request host so the same
// server can serve multiple Clerk custom domains. Falls back to
// CLERK_PUBLISHABLE_KEY when the host doesn't map to a custom domain.
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

// Serve the built frontend from the same origin/process so Clerk's session
// cookie stays first-party (see clerkProxyMiddleware) and the frontend's
// relative /api fetches keep working without CORS or a separate domain.
if (process.env.NODE_ENV === "production") {
  const artifactsDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );

  // The landing page embeds this at /promo-video/ via an iframe; it must be
  // mounted before the SPA catch-all below or that swallows the path first.
  app.use(
    "/promo-video",
    express.static(path.join(artifactsDir, "promo-video/dist/public")),
  );

  const staticDir = path.join(artifactsDir, "baseball-lineup/dist/public");
  app.use(express.static(staticDir));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

export default app;
