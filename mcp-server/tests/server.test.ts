import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/server';

describe('GET /health', () => {
  it('responds with ok status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
