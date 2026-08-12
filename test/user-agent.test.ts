import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KNOWN_USER_AGENTS, pickUserAgent } from '../src/input/user-agent.js';

test('pickUserAgent always returns a known user agent', () => {
  for (let i = 0; i < 50; i++) {
    assert.ok(KNOWN_USER_AGENTS.includes(pickUserAgent()));
  }
});
