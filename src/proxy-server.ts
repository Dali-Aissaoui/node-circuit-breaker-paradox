import express, { Request, Response } from "express";
import CircuitBreaker from "opossum";
import axios from "axios";
import { logger } from "./utils/logger";
import {
  requestCounter,
  responseTimeHistogram,
  circuitBreakerStateGauge,
  circuitBreakerEventsCounter,
  register,
  initializeMetrics,
} from "./utils/metrics";

const app = express();
const PORT = 3002;
const BACKEND_URL = "http://unstable_backend:3001";

// circuit breaker options
const CIRCUIT_BREAKER_OPTIONS = {
  timeout: 2000, // 2 second timeout for requests
  errorThresholdPercentage: 30, // trip circuit when 30% of requests fail
  resetTimeout: 30000, // after 30 seconds, try again
  rollingCountTimeout: 10000, // keep stats for 10 seconds
  rollingCountBuckets: 5, // 5 buckets of 2 seconds each
  name: "backendCircuit",
  // enable more detailed logging for debugging
  debug: true,
};

// initialize metrics
initializeMetrics();

const backendCircuitBreaker = new CircuitBreaker(async () => {
  const response = await axios.get(`${BACKEND_URL}/api/data`);
  return response.data;
}, CIRCUIT_BREAKER_OPTIONS);

// circuit breaker event handlers
backendCircuitBreaker.on("open", () => {
  logger.warn("Circuit breaker opened - backend service appears to be failing");
  circuitBreakerStateGauge.set({ name: "backendCircuit" }, 1);
  circuitBreakerEventsCounter.inc({
    name: "backendCircuit",
    event: "open",
  });
});

backendCircuitBreaker.on("close", () => {
  logger.info("Circuit breaker closed - backend service appears to be working");
  circuitBreakerStateGauge.set({ name: "backendCircuit" }, 0);
  circuitBreakerEventsCounter.inc({
    name: "backendCircuit",
    event: "close",
  });
});

backendCircuitBreaker.on("halfOpen", () => {
  logger.info(
    "Circuit breaker half-open - testing if backend service is working"
  );
  circuitBreakerEventsCounter.inc({
    name: "backendCircuit",
    event: "halfOpen",
  });
});

backendCircuitBreaker.on("fallback", () => {
  logger.info("Circuit breaker fallback - returning fallback response");
  circuitBreakerEventsCounter.inc({
    name: "backendCircuit",
    event: "fallback",
  });
});

backendCircuitBreaker.on("timeout", () => {
  logger.warn("Circuit breaker timeout - request took too long");
  circuitBreakerEventsCounter.inc({
    name: "backendCircuit",
    event: "timeout",
  });
});

backendCircuitBreaker.on("reject", () => {
  logger.warn(
    "Circuit breaker reject - circuit is open and request was rejected"
  );
  circuitBreakerEventsCounter.inc({
    name: "backendCircuit",
    event: "reject",
  });
});

backendCircuitBreaker.on("success", () => {
  logger.debug("Circuit breaker success - request completed successfully");
  circuitBreakerEventsCounter.inc({
    name: "backendCircuit",
    event: "success",
  });
});

backendCircuitBreaker.on("failure", () => {
  logger.warn("Circuit breaker failure - request failed");
  circuitBreakerEventsCounter.inc({
    name: "backendCircuit",
    event: "failure",
  });
});

// fallback function for when the circuit is open
backendCircuitBreaker.fallback(() => ({
  message: "Fallback response - service is currently unavailable",
  timestamp: new Date().toISOString(),
  circuit: "open",
}));

// health check endpoint
app.get("/health", (req, res) => {
  const circuitState = backendCircuitBreaker.status;

  res.status(200).json({
    status: "ok",
    circuit: circuitState,
    stats: {
      successful: backendCircuitBreaker.stats.successes,
      failed: backendCircuitBreaker.stats.failures,
      rejected: backendCircuitBreaker.stats.rejects,
      timeout: backendCircuitBreaker.stats.timeouts,
      fallbacks: backendCircuitBreaker.stats.fallbacks,
    },
  });
});

// metrics endpoint for prometheus
app.get("/metrics", async (req, res) => {
  try {
    res.set("Content-Type", register.contentType);
    const metrics = await register.metrics();
    res.end(metrics);
  } catch (error) {
    logger.error({ error }, "error generating metrics");
    res.status(500).end();
  }
});

// proxy endpoint to backend service
app.get("/api/data", async (req: Request, res: Response) => {
  const startTime = process.hrtime();

  try {
    // execute request through circuit breaker
    const result = await backendCircuitBreaker.fire();

    // record metrics for success
    const [seconds, nanoseconds] = process.hrtime(startTime);
    const duration = seconds + nanoseconds / 1e9;
    responseTimeHistogram.observe(
      { service: "proxy", status: "success", endpoint: "/api/data" },
      duration
    );
    requestCounter.inc({
      service: "proxy",
      status: "success",
      endpoint: "/api/data",
    });

    // return response from backend (or fallback)
    res.status(200).json(result);
  } catch (error) {
    logger.error({ error }, "error proxying request to backend");

    // record metrics for error
    const [seconds, nanoseconds] = process.hrtime(startTime);
    const duration = seconds + nanoseconds / 1e9;
    responseTimeHistogram.observe(
      { service: "proxy", status: "error", endpoint: "/api/data" },
      duration
    );
    requestCounter.inc({
      service: "proxy",
      status: "error",
      endpoint: "/api/data",
    });

    res.status(500).json({
      error: "Failed to get data from backend service",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// circuit breaker status endpoint
app.get("/circuit-status", (req, res) => {
  res.json({
    state: backendCircuitBreaker.status,
    stats: backendCircuitBreaker.stats,
    options: CIRCUIT_BREAKER_OPTIONS,
  });
});

// start the server
app.listen(PORT, () => {
  logger.info(`proxy server with circuit breaker listening on port ${PORT}`);
  logger.info(
    `circuit breaker options: ${JSON.stringify(CIRCUIT_BREAKER_OPTIONS)}`
  );

  // set initial circuit breaker state metric
  circuitBreakerStateGauge.set({ name: "backendCircuit" }, 0);
});
