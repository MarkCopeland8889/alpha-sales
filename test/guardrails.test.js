import './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { action, getGuardrails, saveGuardrails } from '../src/guardrails/index.js';

test('guardrails: LinkedIn page loads wait their own minimum gap, and saved limits keep it', async () => {
  saveGuardrails({ minActionGapMs: 0, limits: { 'linkedin.profile_view': { perDay: 50 }, 'linkedin.job_view': { minGapMs: 300 } } });
  const g = getGuardrails();
  assert.deepEqual(g.limits['linkedin.profile_view'], { perDay: 50, minGapMs: 20000 }, 'a saved daily limit keeps the default gap');
  assert.deepEqual(g.limits['linkedin.job_view'], { perDay: 200, minGapMs: 300 });

  await action('linkedin.job_view', { account: 'gap-test' });
  let t = Date.now();
  await action('other.thing', { account: 'gap-test' });
  assert.ok(Date.now() - t < 150, 'actions without their own gap use the global one');
  t = Date.now();
  await action('linkedin.job_view', { account: 'gap-test' });
  assert.ok(Date.now() - t >= 250, 'a job view waits for its gap after the previous action');
});
