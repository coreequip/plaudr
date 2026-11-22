import { afterEach, expect, test, vi } from 'vitest';
import { resumeWithin } from './resume';

afterEach(() => vi.useRealTimers());

test('gibt true, wenn resume sofort läuft', async () => {
  const ctx = { state: 'suspended', resume: async () => { ctx.state = 'running'; } };
  expect(await resumeWithin(ctx, 300)).toBe(true);
});

test('gibt nach 300 ms false, wenn resume nie fertig wird', async () => {
  vi.useFakeTimers();
  const ctx = { state: 'suspended', resume: () => new Promise<void>(() => {}) };
  const p = resumeWithin(ctx, 300);
  await vi.advanceTimersByTimeAsync(300);
  expect(await p).toBe(false);
});
