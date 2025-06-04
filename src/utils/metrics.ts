import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from "prom-client";
import { logger } from "./logger";

export const register = new Registry();

export function initializeMetrics() {
  collectDefaultMetrics({
    register,
    prefix: "node_",
    gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
  });

  logger.info("Metrics initialized");
}

export const requestCounter = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["service", "status", "endpoint"] as const,
  registers: [register],
});

export const responseTimeHistogram = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["service", "status", "endpoint"] as const,
  buckets: [0.01, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1, 2, 5],
  registers: [register],
});

export const circuitBreakerStateGauge = new Gauge({
  name: "circuit_breaker_state",
  help: "Circuit breaker state (1 = open, 0 = closed)",
  labelNames: ["name"] as const,
  registers: [register],
});

export const circuitBreakerEventsCounter = new Counter({
  name: "circuit_breaker_events_total",
  help: "Total number of circuit breaker events",
  labelNames: ["name", "event"] as const,
  registers: [register],
});

export const eventLoopLagHistogram = new Histogram({
  name: "event_loop_lag_seconds",
  help: "Event loop lag in seconds",
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  registers: [register],
});

logger.info("metrics initialized");
