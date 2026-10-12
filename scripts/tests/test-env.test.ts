import assert from 'node:assert/strict';
import { test } from 'node:test';

test('the test environment runs in UTC whatever the machine', () => {
  assert.equal(process.env['TZ'], 'UTC');
  assert.equal(new Date(Date.UTC(2026, 2, 29, 12)).getTimezoneOffset(), 0);
  assert.equal(new Date(2026, 6, 1).getHours(), 0);
  assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, 'UTC');
});
