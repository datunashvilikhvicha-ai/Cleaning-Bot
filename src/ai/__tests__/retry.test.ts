import { describe, expect, it, vi } from 'vitest';
import { executeWithRetry } from '../retry';

describe('executeWithRetry', () => {
  it('returns the result when the operation succeeds first try', async () => {
    const op = vi.fn().mockResolvedValue('ok');
    const result = await executeWithRetry(op);
    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries after failure and eventually succeeds', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce('recovered');

    vi.useFakeTimers();
    const promise = executeWithRetry(op, { initialDelayMs: 10 });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe('recovered');
    expect(op).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('throws the final error when all retries fail', async () => {
    const op = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(executeWithRetry(op, { maxAttempts: 3, initialDelayMs: 0, backoffFactor: 1 })).rejects.toThrow(
      'boom',
    );
    expect(op).toHaveBeenCalledTimes(3);
  });
});
