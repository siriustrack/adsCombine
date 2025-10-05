import { withRetry } from '../retry';

describe('withRetry', () => {
  const mockFn = jest.fn();
  const options = {
    maxAttempts: 3,
    baseDelay: 100,
    agentId: 'test-agent',
    userId: 'test-user',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return result on first attempt', async () => {
    mockFn.mockResolvedValue('success');

    const result = await withRetry(mockFn, options);

    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and succeed', async () => {
    mockFn
      .mockRejectedValueOnce(new Error('fail1'))
      .mockResolvedValue('success');

    const result = await withRetry(mockFn, options);

    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it('should fail after max attempts', async () => {
    const error = new Error('persistent failure');
    mockFn.mockRejectedValue(error);

    await expect(withRetry(mockFn, options)).rejects.toThrow('persistent failure');
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it('should respect exponential backoff', async () => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    mockFn
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('success');

    await withRetry(mockFn, options);

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 100); // First retry: 100ms
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 200); // Second retry: 200ms

    setTimeoutSpy.mockRestore();
  });
});