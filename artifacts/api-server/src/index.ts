import app from "./app";
import { logger } from "./lib/logger";
import { startGradingSweeper } from "./services/grading-sweeper";

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

  // Started after the port is bound, not at import time: a sweep runs real
  // grading, and doing that while the process is still coming up would compete
  // with the requests it is meant to be ready for.
  startGradingSweeper();
});
