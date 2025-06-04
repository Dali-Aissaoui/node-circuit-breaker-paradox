import { logger } from "./utils/logger";

/**
 * this module simulates event loop pressure by periodically running CPU-intensive
 * operations that block the event loop, similar to what might happen during
 * garbage collection or heavy computation.
 */

// configuration
const PRESSURE_INTERVAL_MS = 5000; // how often to inject pressure
const PRESSURE_DURATION_MS = 300; // how long each pressure injection lasts
const PRESSURE_INTENSITY = 0.8; // 0-1 scale, higher means more pressure

/**
 * performs a CPU-intensive operation to block the event loop
 * @param durationMs how long to block the event loop
 * @param intensity how intensive the blocking should be (0-1)
 */
function injectEventLoopPressure(durationMs: number, intensity: number): void {
  const startTime = Date.now();
  logger.warn(
    `Injecting event loop pressure for ${durationMs}ms with intensity ${intensity}`
  );

  // calculate how many iterations we need based on intensity
  const iterationsPerMs = 10000 * intensity;
  const totalIterations = iterationsPerMs * durationMs;

  // perform a CPU-intensive operation
  let counter = 0;
  while (counter < totalIterations) {
    counter++;

    // add some randomness to make it harder to optimize
    if (Math.random() > 0.9999) {
      counter += 1000;
    }

    // check if we've exceeded the requested duration
    if (counter % 100000 === 0) {
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs >= durationMs) {
        break;
      }
    }
  }

  const actualDuration = Date.now() - startTime;
  logger.warn(
    `event loop pressure complete actual duration: ${actualDuration}ms`
  );
}

function startPressureInjection(): void {
  logger.info(
    `starting event loop pressure injection every ${PRESSURE_INTERVAL_MS}ms for ${PRESSURE_DURATION_MS}ms with intensity ${PRESSURE_INTENSITY}`
  );

  setInterval(() => {
    injectEventLoopPressure(PRESSURE_DURATION_MS, PRESSURE_INTENSITY);
  }, PRESSURE_INTERVAL_MS);
}

if (require.main === module) {
  startPressureInjection();
}

export { startPressureInjection, injectEventLoopPressure };
