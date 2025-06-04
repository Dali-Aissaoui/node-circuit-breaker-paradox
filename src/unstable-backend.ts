import express from "express";
import { logger } from "./utils/logger";
import { requestCounter, responseTimeHistogram } from "./utils/metrics";
import promBundle from "express-prom-bundle";

const app = express();
const PORT = 3001;

app.use(
  promBundle({
    includeMethod: true,
    includePath: true,
    promClient: { collectDefaultMetrics: {} },
  })
);

const FAILURE_RATE = 0.3; // 30% failure rate
const MAX_DELAY_MS = 1000; // up to 1000ms delay

/**
 * helper function to sleep for a given number of milliseconds
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * random delay generator
 */
const getRandomDelay = (): number => Math.floor(Math.random() * MAX_DELAY_MS);

/**
 * random boolean generator based on failure rate
 */
const shouldFail = (): boolean => Math.random() < FAILURE_RATE;

// health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// unstable endpoint that will randomly delay and fail
app.get("/api/data", async (req, res) => {
  const startTime = process.hrtime();

  try {
    // generate a random delay
    const delay = getRandomDelay();

    // log the delay
    logger.info({ delay }, "Delaying response");

    // simulate processing delay
    await sleep(delay);

    // randomly fail based on failure rate
    if (shouldFail()) {
      logger.warn("Simulating service failure");

      // record metrics for failure
      const [seconds, nanoseconds] = process.hrtime(startTime);
      const duration = seconds + nanoseconds / 1e9;
      responseTimeHistogram.observe(
        { service: "unstable_backend", status: "error", endpoint: "/api/data" },
        duration
      );
      requestCounter.inc({
        service: "unstable_backend",
        status: "error",
        endpoint: "/api/data",
      });

      // return error response
      res.status(500).json({ error: "Service temporarily unavailable" });
    } else {
      // record metrics for success
      const [seconds, nanoseconds] = process.hrtime(startTime);
      const duration = seconds + nanoseconds / 1e9;
      responseTimeHistogram.observe(
        {
          service: "unstable_backend",
          status: "success",
          endpoint: "/api/data",
        },
        duration
      );
      requestCounter.inc({
        service: "unstable_backend",
        status: "success",
        endpoint: "/api/data",
      });

      // return success response with timestamp
      res.status(200).json({
        message: "Data retrieved successfully",
        timestamp: new Date().toISOString(),
        processingTimeMs: delay,
      });
    }
  } catch (error) {
    logger.error({ error }, "unexpected error in backend service");

    // record metrics for unexpected error
    const [seconds, nanoseconds] = process.hrtime(startTime);
    const duration = seconds + nanoseconds / 1e9;
    responseTimeHistogram.observe(
      { service: "unstable_backend", status: "error", endpoint: "/api/data" },
      duration
    );
    requestCounter.inc({
      service: "unstable_backend",
      status: "error",
      endpoint: "/api/data",
    });

    res.status(500).json({ error: "Internal server error" });
  }
});

// start the server
app.listen(PORT, () => {
  logger.info(`Unstable backend service listening on port ${PORT}`);
  logger.info(
    `Configuration: Failure rate=${
      FAILURE_RATE * 100
    }%, Max delay=${MAX_DELAY_MS}ms`
  );
});
