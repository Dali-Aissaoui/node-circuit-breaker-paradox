import axios from "axios";
import { logger } from "./utils/logger";
import { Registry, Gauge, Counter, collectDefaultMetrics } from "prom-client";
import express from "express";

const register = new Registry();
collectDefaultMetrics({ register });

const requestDuration = new Gauge({
  name: "loadtest_request_duration_ms",
  help: "Duration of HTTP requests in ms",
  labelNames: ["status"],
  registers: [register],
});

const eventLoopLagGauge = new Gauge({
  name: "nodejs_eventloop_lag_ms",
  help: "Current event loop lag in milliseconds",
  registers: [register],
});

const memoryUsageGauge = new Gauge({
  name: "nodejs_memory_usage_mb",
  help: "Current memory usage in MB",
  labelNames: ["type"],
  registers: [register],
});

const errorCounter = new Counter({
  name: "loadtest_errors_total",
  help: "Total number of errors",
  labelNames: ["type"],
  registers: [register],
});

const metricsApp = express();
const METRICS_PORT = 9091;

metricsApp.get("/metrics", async (req, res) => {
  try {
    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    res.status(500).end(error);
  }
});

metricsApp.listen(METRICS_PORT, () => {
  logger.info(`Metrics server listening on port ${METRICS_PORT}`);
});

const CONCURRENCY = 200;
const REQUESTS = 5000;
const TARGET_URL = "http://proxy_server:3002";
const ERROR_RATE = 0.4;
const DELAY_PROBABILITY = 0.3;
const MAX_DELAY_MS = 5000;

let successCount = 0;
let errorCount = 0;
let totalLatency = 0;
let memoryUsage: number[] = [];
let eventLoopLag: number[] = [];
let unhandledRejections = 0;

process.on("unhandledRejection", (reason, promise) => {
  unhandledRejections++;
  logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

setInterval(() => {
  const memUsage = process.memoryUsage();
  const heapUsed = memUsage.heapUsed / 1024 / 1024; // MB
  memoryUsage.push(heapUsed);

  memoryUsageGauge.labels("heap").set(heapUsed);
  memoryUsageGauge.labels("rss").set(memUsage.rss / 1024 / 1024);

  const start = process.hrtime();
  setImmediate(() => {
    const diff = process.hrtime(start);
    const lag = diff[0] * 1e3 + diff[1] / 1e6; // Convert to ms
    eventLoopLag.push(lag);
    eventLoopLagGauge.set(lag);
  });
}, 1000);

// function to simulate CPU-intensive work
function blockEventLoop(ms: number) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // block the event loop
  }
}

// function to make a single request
async function makeRequest() {
  const start = Date.now();
  const shouldError = Math.random() < ERROR_RATE;
  const shouldDelay = Math.random() < DELAY_PROBABILITY;

  // sometimes block the event loop to simulate CPU-bound work
  if (shouldDelay) {
    const delay = Math.random() * MAX_DELAY_MS;
    blockEventLoop(delay);
  }

  const url = shouldError
    ? `${TARGET_URL}/api/data?forceError=true`
    : `${TARGET_URL}/api/data`;

  try {
    const response = await axios.get(url, {
      timeout: 2000,
      validateStatus: () => true,
    });

    const latency = Date.now() - start;
    totalLatency += latency;

    requestDuration.labels(String(response.status)).set(latency);

    if (response.status === 200) {
      successCount++;
    } else {
      errorCount++;
      errorCounter.inc({ type: `http_${response.status}` });
      logger.warn(`Request failed with status ${response.status}`);
    }

    return { success: response.status === 200, latency };
  } catch (error: unknown) {
    errorCount++;
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    errorCounter.inc({ type: "request_error" });
    logger.error(`Request failed: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
}

// function to run multiple requests in parallel
async function runLoadTest() {
  logger.info(`Starting load test with ${CONCURRENCY} concurrent requests`);

  const promises = [];

  for (let i = 0; i < REQUESTS; i++) {
    if (i > 0 && i % CONCURRENCY === 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    promises.push(
      makeRequest().then(() => {
        if ((successCount + errorCount) % 100 === 0) {
          const total = successCount + errorCount;
          const errorRate = (errorCount / total) * 100;
          logger.info(
            `progress: ${total}/${REQUESTS} (${(
              (total / REQUESTS) *
              100
            ).toFixed(
              1
            )}%) - success: ${successCount}, errors: ${errorCount} (${errorRate.toFixed(
              1
            )}%)`
          );
        }
      })
    );

    // start new batch of concurrent requests
    if (promises.length >= CONCURRENCY) {
      await Promise.all(promises);
      promises.length = 0;
    }
  }

  // wait for any remaining requests
  await Promise.all(promises);

  // calculate statistics
  const total = successCount + errorCount;
  const errorRate = (errorCount / total) * 100;

  if (errorRate > 30) {
    logger.warn(
      "high error rate detected. the circuit breaker should have been triggered."
    );
  }

  if (errorRate > 30) {
    logger.warn(
      "high error rate detected. the circuit breaker should have been triggered."
    );
  } else {
    logger.info(
      "the circuit breaker did not trip. try increasing the error rate or test duration."
    );
  }
}

runLoadTest().catch((error) => {
  logger.error(`load test failed: ${error.message}`);
  process.exit(1);
});

// Handle graceful shutdown
process.on("SIGINT", () => {
  logger.info("\nLoad test interrupted. Final results:");
  const total = successCount + errorCount;
  const errorRate = total > 0 ? (errorCount / total) * 100 : 0;
  logger.info(`total requests: ${total}`);
  logger.info(`success: ${successCount} (${(100 - errorRate).toFixed(1)}%)`);
  logger.info(`errors: ${errorCount} (${errorRate.toFixed(1)}%)`);
  process.exit(0);
});

export { runLoadTest };
