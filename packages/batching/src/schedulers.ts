export type Scheduler = (
  firstRequestTime: number,
  lastRequestTime: number,
  batchSize: number,
) => number;

/**
 * Scheduler that batches all requests within a fixed time window (from the first request).
 * If a maxBatchSize is provided and the batch size reaches that size, it triggers immediately.
 * @param windowMs - The time window in milliseconds.
 * @param maxBatchSize - The maximum batch size.
 *
 * @returns The scheduler function.
 */
export function createFixedWindowScheduler(
  windowMs: number,
  maxBatchSize?: number,
): Scheduler {
  return (firstRequestTime, _lastRequestTime, batchSize) => {
    if (maxBatchSize !== undefined && batchSize >= maxBatchSize) {
      return 0;
    }
    const elapsed = Date.now() - firstRequestTime;
    const remaining = windowMs - elapsed;
    return Math.max(0, remaining);
  };
}

/**
 * Scheduler that waits for a quiet period (debounce) with a maximum wait time.
 * It waits for `delayMs` since the last request, but will trigger no later than `maxWaitMs` after the first request.
 * If a maxBatchSize is provided and the batch size reaches that size, it triggers immediately.
 *
 * @param delayMs - The delay in milliseconds.
 * @param maxWaitMs - The maximum wait time in milliseconds.
 * @param maxBatchSize - The maximum batch size.
 * @returns The scheduler function.
 */
export function createDebouncedScheduler(
  delayMs: number,
  maxWaitMs: number,
  maxBatchSize?: number,
): Scheduler {
  return (firstRequestTime, lastRequestTime, batchSize) => {
    if (maxBatchSize !== undefined && batchSize >= maxBatchSize) {
      return 0;
    }
    const now = Date.now();
    const timeSinceLast = now - lastRequestTime;
    const timeSinceFirst = now - firstRequestTime;
    const maxWaitRemaining = maxWaitMs - timeSinceFirst;
    const debounceRemaining = delayMs - timeSinceLast;
    const remaining = Math.min(maxWaitRemaining, debounceRemaining);
    return Math.max(0, remaining);
  };
}
