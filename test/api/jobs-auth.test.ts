import { describe, expect, test } from 'bun:test';
import type { Request, Response } from 'express';

process.env.BASE_URL = 'http://localhost:3000';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.OPENAI_MODEL_TEXT = 'gpt-test';
process.env.TOKEN = 'main-token';
process.env.JOBS_TOKEN = 'jobs-token';

type AuthMiddleware = typeof import('../../src/api/middlewares')['handleAuthMiddleware'];

function createResponse() {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };

  return response;
}

async function loadAuthMiddleware(): Promise<AuthMiddleware> {
  const module = await import('../../src/api/middlewares');
  return module.handleAuthMiddleware;
}

async function runAuth(path: string, authorization?: string) {
  const handleAuthMiddleware = await loadAuthMiddleware();
  const req = {
    path,
    headers: authorization ? { authorization } : {},
  } as Request;
  const res = createResponse() as Response & ReturnType<typeof createResponse>;
  let nextCalled = false;

  handleAuthMiddleware(req, res, () => {
    nextCalled = true;
  });

  return { res, nextCalled };
}

describe('jobs route auth', () => {
  test('requires the jobs token for /api/jobs routes', async () => {
    const { res, nextCalled } = await runAuth('/api/jobs/process-message');

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  test('rejects the main token on /api/jobs routes', async () => {
    const { res, nextCalled } = await runAuth('/api/jobs/job-id/status', 'Bearer main-token');

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  test('accepts the jobs token on /api/jobs routes', async () => {
    const { res, nextCalled } = await runAuth('/api/jobs/job-id/result', 'Bearer jobs-token');

    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  test('keeps the legacy /api/process-message route public', async () => {
    const { res, nextCalled } = await runAuth('/api/process-message');

    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
  });
});
