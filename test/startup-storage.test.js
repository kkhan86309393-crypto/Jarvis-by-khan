import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import {
  DEFAULT_LAB_PREFERENCES,
  loadLabPreferences,
} from '../public/lab-personalize.js';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('startup passes the safe localStorage result to the LAB preference loader', () => {
  const helper = app.match(/function getLocalStorageSafely\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper, 'the guarded localStorage helper should be defined');
  assert.match(app, /labPreferences: loadLabPreferences\(getLocalStorageSafely\(\)\)/);

  const storage = runInNewContext(
    `${helper}\nloadLabPreferences(getLocalStorageSafely());`,
    {
      get localStorage() {
        throw new Error('Storage access is blocked.');
      },
      loadLabPreferences: (value) => value,
    },
  );

  assert.equal(storage, null);
  assert.deepEqual(loadLabPreferences(storage), DEFAULT_LAB_PREFERENCES);
});
