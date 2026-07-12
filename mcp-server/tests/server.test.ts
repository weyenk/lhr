import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.stubEnv('AUTHOR_GITHUB_USERNAME', 'test-author');

const { default: app } = await import('../src/server');

describe('GET /health', () => {
  it('responds with ok status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
