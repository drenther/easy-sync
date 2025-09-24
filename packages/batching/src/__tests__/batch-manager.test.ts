import { beforeEach, describe, expect, test, vi } from 'vitest';
import { BatchCancellationError, BatchManager } from '..';
import { createArrayIndexResolver, createKeyResolver } from '../resolvers';
import {
  createDebouncedScheduler,
  createFixedWindowScheduler,
} from '../schedulers';

interface TestData {
  value: string;
}

interface TestPayload {
  data: string;
}

describe('BatchManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();

    // Note: Many tests in this file intentionally cause promise rejections
    // (cancel, abort, processor errors, resolver errors). These will show up as
    // unhandled rejection warnings in the test output, which is expected.
  });

  describe('instantiation', () => {
    test('should create instance with required options', () => {
      const processor = async () => ({ a: 1 });
      const resolver = () => 1;
      const batchManager = new BatchManager({ processor, resolver });

      expect(batchManager).toBeInstanceOf(BatchManager);
    });

    test('should create instance with custom scheduler', () => {
      const processor = async () => ({ a: 1 });
      const resolver = () => 1;
      const scheduler = createFixedWindowScheduler(1000);
      const batchManager = new BatchManager({ processor, resolver, scheduler });

      expect(batchManager).toBeInstanceOf(BatchManager);
    });
  });

  describe('enqueue', () => {
    test('should handle string id input', async () => {
      const mockProcessor = vi
        .fn()
        .mockResolvedValue({ '1': { value: 'test' } });
      const batchManager = new BatchManager<
        Record<string, TestData>,
        TestData,
        string
      >({
        processor: mockProcessor,
        resolver: createKeyResolver(),
        scheduler: createFixedWindowScheduler(1), // Use 1ms scheduler for faster tests
      });

      const promise = batchManager.enqueue('1');
      await vi.advanceTimersToNextTimerAsync();
      const result = await promise;

      expect(result).toEqual({ value: 'test' });
      expect(mockProcessor).toHaveBeenCalledWith([
        { id: '1', payload: undefined },
      ]);
    });

    test('should handle payload with auto-generated id', async () => {
      const mockProcessor = vi.fn().mockResolvedValue({ result: 'test' });
      const mockResolver = vi.fn().mockReturnValue('test');
      const batchManager = new BatchManager<
        unknown,
        string,
        undefined,
        TestPayload
      >({
        processor: mockProcessor,
        resolver: mockResolver,
        scheduler: createFixedWindowScheduler(1),
      });

      const promise = batchManager.enqueue({ payload: { data: 'test' } });
      await vi.advanceTimersToNextTimerAsync();
      await promise;

      expect(mockProcessor).toHaveBeenCalledWith([
        expect.objectContaining({ payload: { data: 'test' } }),
      ]);
    });

    test('should handle payload with custom id', async () => {
      const mockProcessor = vi
        .fn()
        .mockResolvedValue({ '1': { value: 'test' } });
      const batchManager = new BatchManager<
        Record<string, TestData>,
        TestData,
        string,
        TestPayload
      >({
        processor: mockProcessor,
        resolver: createKeyResolver(),
        scheduler: createFixedWindowScheduler(1),
      });

      const promise = batchManager.enqueue({
        id: '1',
        payload: { data: 'test' },
      });
      await vi.advanceTimersToNextTimerAsync();
      const result = await promise;

      expect(result).toEqual({ value: 'test' });
      expect(mockProcessor).toHaveBeenCalledWith([
        { id: '1', payload: { data: 'test' } },
      ]);
    });
  });

  describe('cancellation', () => {
    test('should cancel individual request', async () => {
      const mockProcessor = vi.fn();
      const batchManager = new BatchManager<
        Record<string, TestData>,
        TestData,
        string
      >({
        processor: mockProcessor,
        resolver: createKeyResolver(),
        scheduler: createFixedWindowScheduler(1),
      });

      const promise = batchManager.enqueue('1');

      const assertRejection = expect(promise).rejects.toThrow(
        BatchCancellationError,
      );

      promise.cancel();
      await vi.advanceTimersToNextTimerAsync();

      await assertRejection;
      expect(mockProcessor).not.toHaveBeenCalled();
    });

    test('should cancel all requests', async () => {
      const mockProcessor = vi.fn();
      const batchManager = new BatchManager<
        Record<string, TestData>,
        TestData,
        string
      >({
        processor: mockProcessor,
        resolver: createKeyResolver(),
        scheduler: createFixedWindowScheduler(1),
      });

      const promise1 = batchManager.enqueue('1');
      const promise2 = batchManager.enqueue('2');

      const assertRejection1 = expect(promise1).rejects.toThrow(
        BatchCancellationError,
      );
      const assertRejection2 = expect(promise2).rejects.toThrow(
        BatchCancellationError,
      );

      batchManager.cancel();
      await vi.advanceTimersToNextTimerAsync();

      await assertRejection1;
      await assertRejection2;
      expect(mockProcessor).not.toHaveBeenCalled();
    });

    test('should handle AbortSignal cancellation', async () => {
      const mockProcessor = vi.fn();
      const batchManager = new BatchManager<
        Record<string, TestData>,
        TestData,
        string
      >({
        processor: mockProcessor,
        resolver: createKeyResolver(),
        scheduler: createFixedWindowScheduler(1),
      });

      const controller = new AbortController();
      const promise = batchManager.enqueue('1', controller.signal);

      const assertRejection = expect(promise).rejects.toThrow(
        expect.objectContaining({
          name: 'AbortError',
        }),
      );

      controller.abort();
      await vi.advanceTimersToNextTimerAsync();

      await assertRejection;
      expect(mockProcessor).not.toHaveBeenCalled();
    });
  });

  describe('schedulers', () => {
    test('should batch requests within fixed window', async () => {
      const mockProcessor = vi.fn().mockResolvedValue({
        '1': { value: 'test1' },
        '2': { value: 'test2' },
      });
      const batchManager = new BatchManager<
        Record<string, TestData>,
        TestData,
        string
      >({
        processor: mockProcessor,
        resolver: createKeyResolver(),
        scheduler: createFixedWindowScheduler(1000),
      });

      const promise1 = batchManager.enqueue('1');
      const promise2 = batchManager.enqueue('2');

      await vi.advanceTimersByTimeAsync(500);
      expect(mockProcessor).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(500);
      await Promise.all([promise1, promise2]);

      expect(mockProcessor).toHaveBeenCalledTimes(1);
      expect(mockProcessor).toHaveBeenCalledWith([
        { id: '1', payload: undefined },
        { id: '2', payload: undefined },
      ]);
    });

    test('should batch requests with debounced scheduler', async () => {
      const mockProcessor = vi.fn().mockResolvedValue({
        '1': { value: 'test1' },
        '2': { value: 'test2' },
      });
      const batchManager = new BatchManager<
        Record<string, TestData>,
        TestData,
        string
      >({
        processor: mockProcessor,
        resolver: createKeyResolver(),
        scheduler: createDebouncedScheduler(1000, 5000),
      });

      const promise1 = batchManager.enqueue('1');
      await vi.advanceTimersByTimeAsync(500);
      const promise2 = batchManager.enqueue('2');

      await vi.advanceTimersByTimeAsync(1000);
      await Promise.all([promise1, promise2]);

      expect(mockProcessor).toHaveBeenCalledTimes(1);
      expect(mockProcessor).toHaveBeenCalledWith([
        { id: '1', payload: undefined },
        { id: '2', payload: undefined },
      ]);
    });
  });

  describe('resolvers', () => {
    test('should resolve using key resolver', async () => {
      const mockProcessor = vi.fn().mockResolvedValue({
        '1': { value: 'test1' },
        '2': { value: 'test2' },
      });
      const batchManager = new BatchManager<
        Record<string, TestData>,
        TestData,
        string
      >({
        processor: mockProcessor,
        resolver: createKeyResolver(),
        scheduler: createFixedWindowScheduler(1),
      });

      const promise1 = batchManager.enqueue('1');
      const promise2 = batchManager.enqueue('2');

      await vi.advanceTimersToNextTimerAsync();
      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toEqual({ value: 'test1' });
      expect(result2).toEqual({ value: 'test2' });
    });

    test('should resolve using array index resolver', async () => {
      const mockProcessor = vi
        .fn()
        .mockResolvedValue([{ value: 'test1' }, { value: 'test2' }]);
      const batchManager = new BatchManager<TestData[], TestData, number>({
        processor: mockProcessor,
        resolver: createArrayIndexResolver(),
        scheduler: createFixedWindowScheduler(1),
      });

      const promise1 = batchManager.enqueue(0);
      const promise2 = batchManager.enqueue(1);

      await vi.advanceTimersToNextTimerAsync();
      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toEqual({ value: 'test1' });
      expect(result2).toEqual({ value: 'test2' });
    });
  });

  describe('error handling', () => {
    test('should handle processor errors', async () => {
      const error = new Error('Processor error');
      const mockProcessor = vi.fn().mockRejectedValue(error);
      const batchManager = new BatchManager<
        Record<string, TestData>,
        TestData,
        string
      >({
        processor: mockProcessor,
        resolver: createKeyResolver(),
        scheduler: createFixedWindowScheduler(1),
      });

      const promise = batchManager.enqueue('1');
      const assertRejection = expect(promise).rejects.toThrow(error);
      await vi.advanceTimersToNextTimerAsync();

      await assertRejection;
    });

    test('should handle resolver errors', async () => {
      const error = new Error('Resolver error');
      const mockProcessor = vi
        .fn()
        .mockResolvedValue({ '1': { value: 'test' } });
      const mockResolver = vi.fn().mockImplementation(() => {
        throw error;
      });
      const batchManager = new BatchManager<
        Record<string, TestData>,
        TestData,
        string
      >({
        processor: mockProcessor,
        resolver: mockResolver,
        scheduler: createFixedWindowScheduler(1),
      });

      const promise = batchManager.enqueue('1');
      const assertRejection = expect(promise).rejects.toThrow(error);
      await vi.advanceTimersToNextTimerAsync();

      await assertRejection;
    });
  });

  describe('deduplication', () => {
    test('should deduplicate requests with same id', async () => {
      const mockProcessor = vi.fn().mockResolvedValue({
        '1': { value: 'test' },
      });
      const batchManager = new BatchManager<
        Record<string, TestData>,
        TestData,
        string
      >({
        processor: mockProcessor,
        resolver: createKeyResolver(),
        scheduler: createFixedWindowScheduler(1),
      });

      const promise1 = batchManager.enqueue('1');
      const promise2 = batchManager.enqueue('1');

      await vi.advanceTimersToNextTimerAsync();
      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toEqual({ value: 'test' });
      expect(result2).toEqual({ value: 'test' });
      expect(mockProcessor).toHaveBeenCalledTimes(1);
      expect(mockProcessor).toHaveBeenCalledWith([
        { id: '1', payload: undefined },
      ]);
    });

    test('should handle cancellation of deduplicated requests independently', async () => {
      const mockProcessor = vi.fn().mockResolvedValue({
        '1': { value: 'test' },
      });
      const batchManager = new BatchManager<
        Record<string, TestData>,
        TestData,
        string
      >({
        processor: mockProcessor,
        resolver: createKeyResolver(),
        scheduler: createFixedWindowScheduler(1),
      });

      const promise1 = batchManager.enqueue('1');
      const promise2 = batchManager.enqueue('1');

      const assertRejection = expect(promise1).rejects.toThrow(
        BatchCancellationError,
      );

      promise1.cancel();
      await vi.advanceTimersToNextTimerAsync();

      await assertRejection;

      const result2 = await promise2;
      expect(result2).toEqual({ value: 'test' });
      expect(mockProcessor).toHaveBeenCalledTimes(1);
    });
  });
});
