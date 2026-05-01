import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

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
app.use(cors());

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

app.use("/api", router);

export default app;
