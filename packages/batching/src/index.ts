import type { RequestResolver } from './resolvers';
import { createFixedWindowScheduler, type Scheduler } from './schedulers';

export type BatchProcessor<Payload, Id, CombinedResponse> = (
  requests: Array<{ id: Id; payload: Payload }>,
) => Promise<CombinedResponse>;

export type RequestId = string | number | symbol;

export interface BatchRequestHandle<Id, Result> extends Promise<Result> {
  /** The id of this request (possibly auto-generated if not provided) */
  id: Id;
  /** Cancel this individual request (if the batch has not yet been executed) */
  cancel: (reason?: unknown) => void;
}

// Custom error type for cancellations
export class BatchCancellationError extends Error {
  constructor(message = 'Batch request cancelled') {
    super(message);
    this.name = 'BatchCancellationError';
  }
}

type Timer = ReturnType<typeof setTimeout>;

// The BatchManager class
export class BatchManager<
  Payload,
  Id extends RequestId,
  CombinedResponse,
  Result,
> {
  private processor: BatchProcessor<Payload, Id, CombinedResponse>;
  private resolver: RequestResolver<Payload, Id, CombinedResponse, Result>;
  private scheduler: Scheduler;

  // Map of pending unique requests (by id) to their grouped entry
  private pending: Map<
    Id,
    {
      id: Id;
      payload: Payload;
      requests: Array<{
        promise: Promise<Result>;
        resolve: (value: Result) => void;
        reject: (reason?: unknown) => void;
        cancelled: boolean;
      }>;
    }
  > = new Map();

  private firstRequestTime: number | null = null;
  private lastRequestTime: number | null = null;
  private timer: Timer | null = null; // handle for scheduled batch (from setTimeout)

  constructor(options: {
    processor: BatchProcessor<Payload, Id, CombinedResponse>;
    resolver: RequestResolver<Payload, Id, CombinedResponse, Result>;
    scheduler?: Scheduler;
  }) {
    this.processor = options.processor;
    this.resolver = options.resolver;
    // Default to an immediate scheduler (0 ms window) if none provided
    this.scheduler = options.scheduler || createFixedWindowScheduler(10_000);
  }

  /**
   * Enqueue a new request into the batch. Returns a promise handle that can be awaited for the result,
   * with a cancel() method and id property for cancellation or reference.
   */
  enqueue(
    request: Id | { payload: Payload; id?: Id },
    signal?: AbortSignal,
  ): BatchRequestHandle<Id, Result> {
    // Determine request id (use provided or generate unique)
    let reqId: Id;
    if (typeof request === 'object') {
      // If an id is provided, use it, otherwise generate a unique Symbol
      reqId = request.id ?? (Symbol() as unknown as Id);
    } else {
      reqId = request;
    }

    // Determine request payload (use provided or undefined)
    const payload =
      typeof request === 'object' && 'payload' in request
        ? request.payload
        : undefined;

    // Check if this id is already in the batch (deduplication)
    let entry = this.pending.get(reqId);
    if (entry) {
      // Deduplicate: reuse existing entry for this id
      const { promise, resolve, reject, handle } = this.createPromiseHandle(
        reqId,
        signal,
      );

      // Add the new request to the entry's list of requests
      entry.requests.push({ promise, resolve, reject, cancelled: false });

      this.manageTimersAndScheduler();
      return handle;
    }

    // Process new unique request for this batch
    const { promise, resolve, reject, handle } = this.createPromiseHandle(
      reqId,
      signal,
    );
    entry = {
      id: reqId,
      payload: payload as Payload,
      requests: [{ promise, resolve, reject, cancelled: false }],
    };
    // Add the new request to the pending map
    this.pending.set(reqId, entry);

    this.manageTimersAndScheduler();
    return handle;
  }

  /**
   * Cancel a pending request or the entire batch.
   * @param id If provided, cancels the request(s) with this id. If omitted, cancels all pending requests.
   *
   * Cancelling a request rejects its promise with a BatchCancellationError.
   * (Requests already being processed in a batch cannot be cancelled via this method.)
   */
  cancel(id?: Id): void {
    if (id === undefined) {
      // Cancel all pending requests
      for (const entry of this.pending.values()) {
        for (const req of entry.requests) {
          if (!req.cancelled) {
            req.cancelled = true;
            req.reject(new BatchCancellationError());
          }
        }
      }
      this.resetCurrentBatch();
    } else {
      // Cancel request with this id
      const entry = this.pending.get(id);
      if (!entry) {
        return;
      }
      // Cancel all requests under this id
      for (const req of entry.requests) {
        if (!req.cancelled) {
          req.cancelled = true;
          req.reject(new BatchCancellationError());
        }
      }
      this.pending.delete(id);
      if (this.pending.size === 0) {
        this.resetCurrentBatch();
      }
    }
  }

  /**
   * --Internal Helper--
   * Create a promise handle for a new request
   * - Create a promise
   * - Extend the promise with id and cancel properties
   * - Return the promise handle
   *
   * @param reqId The id of the request
   * @param signal The signal
   * @returns The promise handle
   */
  private createPromiseHandle(reqId: Id, signal?: AbortSignal) {
    let resolveFn!: (value: Result) => void;
    let rejectFn!: (reason?: unknown) => void;
    const promise = new Promise<Result>((res, rej) => {
      resolveFn = res;
      rejectFn = rej;
    });
    const handle = promise as BatchRequestHandle<Id, Result>;
    handle.id = reqId;
    handle.cancel = (reason?: unknown) => {
      const entry = this.pending.get(reqId);
      if (!entry) {
        return;
      }

      // Find this particular request in the entry's list
      const idx = entry.requests.findIndex((r) => r.promise === promise);
      if (idx !== -1) {
        const req = entry.requests[idx];
        // Only reject if the request is not cancelled
        if (req && !req.cancelled) {
          req.cancelled = true;
          req.reject(reason ?? new BatchCancellationError());
        }
        // Remove this request from the batch entry
        entry.requests.splice(idx, 1);
        if (entry.requests.length === 0) {
          // Remove the Request ID entry entirely if no requests remain for this id
          this.pending.delete(reqId);
        }
        if (this.pending.size === 0) {
          // If no pending requests left, reset the batch
          this.resetCurrentBatch();
        }
      }
    };

    // Handle abort signal based cancellation
    if (signal) {
      // if the signal is already aborted, cancel the request
      if (signal.aborted) {
        handle.cancel(signal.reason);
      } else {
        // otherwise, add a listener to the signal
        function handleAbort() {
          if (signal) {
            handle.cancel(signal.reason);
            signal.removeEventListener('abort', handleAbort);
          }
        }
        signal.addEventListener('abort', handleAbort);
      }
    }
    return { promise, resolve: resolveFn, reject: rejectFn, handle };
  }

  /**
   * --Internal Helper--
   * Manage timers and scheduler for the batch (for when a new request is enqueued)
   *
   * @param options { firstRequestTime: number }
   */
  private manageTimersAndScheduler(): void {
    const now = Date.now();
    // Update firstRequestTime if not already set
    this.firstRequestTime = this.firstRequestTime ?? now;
    // Update lastRequestTime
    this.lastRequestTime = now;

    // Compute the delay
    const delay = this.scheduler(
      // assumed to be set at this point
      this.firstRequestTime,
      this.lastRequestTime,
      this.pending.size,
    );

    // Clear any existing timer and set a new one
    this.clearExistingTimer();
    this.timer = setTimeout(this.triggerBatch, Math.max(0, delay));
  }

  /**
   * --Internal Helper--
   * Clear any existing timer
   */
  private clearExistingTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * --Internal Helper--
   * Reset the current batch
   */
  private resetCurrentBatch(): void {
    this.pending.clear();
    this.clearExistingTimer();
    this.firstRequestTime = null;
    this.lastRequestTime = null;
  }

  /**
   * --Internal Helper--
   * Trigger the batch execution
   */
  private async triggerBatch(): Promise<void> {
    const currentBatchEntries = Array.from(this.pending.values());
    this.resetCurrentBatch();

    if (currentBatchEntries.length === 0) {
      return;
    }

    let combinedResponse: CombinedResponse;
    try {
      const requestList = currentBatchEntries.map((entries) => ({
        id: entries.id,
        payload: entries.payload,
      }));
      combinedResponse = await this.processor(requestList);
    } catch (error) {
      // If the processor fails, reject all promises in this batch with the error
      for (const entry of currentBatchEntries) {
        for (const req of entry.requests) {
          if (!req.cancelled) {
            req.reject(error);
          }
        }
      }
      return;
    }

    // Map the combined response to each individual request result using the resolver
    for (const entry of currentBatchEntries) {
      if (entry.requests.every((req) => req.cancelled)) {
        // Skip this entry if all requests were cancelled under this id
        continue;
      }
      let entryResult: Result | undefined;
      let entryError: unknown | undefined;
      try {
        entryResult = this.resolver(combinedResponse, {
          id: entry.id,
          payload: entry.payload,
        });
      } catch (err) {
        entryError = err;
      }
      // Resolve or reject each pending request under this entry
      for (const req of entry.requests) {
        if (req.cancelled) {
          continue;
        }
        if (entryError !== undefined) {
          req.reject(entryError);
        } else {
          req.resolve(entryResult as Result);
        }
      }
    }
  }
}
