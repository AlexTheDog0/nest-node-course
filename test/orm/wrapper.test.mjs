import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('SKIP_VAULT forwards arguments without treating dev as the command', () => {
  const result = spawnSync(
    'bash',
    [
      'scripts/with-secrets.sh',
      'dev',
      process.execPath,
      '-e',
      'console.log(process.argv[1]); process.exit(7)',
      'two words',
    ],
    {
      env: { ...process.env, SKIP_VAULT: '1' },
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 7, result.stderr);
  assert.equal(result.stdout.trim(), 'two words');
});
