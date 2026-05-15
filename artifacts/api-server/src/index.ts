import app from "./app";
import { logger } from "./lib/logger";
import { startBoxScoreReminderScheduler } from "./lib/box-score-reminder-scheduler";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // Start the GameChanger box-score reminder scheduler. Safe to call
  // when VAPID keys are missing — the scheduler will log + no-op.
  startBoxScoreReminderScheduler();
});
