'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { MemoryProvider } = require('../dist');

describe('primary key fallback (same contract as the SQL providers)', () => {
  test('tables without a declared key match entities by `id`', async () => {
    const provider = new MemoryProvider();
    await provider.add({ id: 1, name: 'a' }, 'users');
    await provider.update({ id: 1, name: 'b' }, 'users');
    assert.deepEqual(await provider.find({ id: 1 }, 'users'), { id: 1, name: 'b' });
    await provider.remove({ id: 1 }, 'users');
    assert.deepEqual(await provider.getAll('users'), []);
  });

  test('duplicate `id` values are rejected like a primary key violation', async () => {
    const provider = new MemoryProvider();
    await provider.add({ id: 1 }, 'users');
    await assert.rejects(() => provider.add({ id: 1 }, 'users'), /already exists/);
  });

  test('entities without a key still fall back to reference equality', async () => {
    const provider = new MemoryProvider();
    const row = { name: 'no key' };
    await provider.add(row, 'notes');
    await provider.remove(row, 'notes');
    assert.deepEqual(await provider.getAll('notes'), []);
  });
});

describe('raw SQL', () => {
  test('SELECT * FROM <table> returns the rows (quoted or bare names)', async () => {
    const provider = new MemoryProvider();
    await provider.add({ id: 1 }, 'users');
    for (const sql of ['SELECT * FROM users', 'SELECT * FROM "users";', 'select * from [users]', 'SELECT * FROM `users`']) {
      assert.deepEqual(await provider.executeQuery(sql, []), [{ id: 1 }], sql);
    }
  });

  test('statements that cannot be evaluated exactly throw instead of returning every row', async () => {
    const provider = new MemoryProvider();
    await provider.addRange([{ id: 1 }, { id: 2 }], 'users');
    await assert.rejects(() => provider.executeQuery('SELECT * FROM users WHERE id = ?', [1]), /cannot execute raw SQL/);
    await assert.rejects(() => provider.executeQuery('DELETE FROM "users" WHERE id = ?', [1]), /cannot execute raw SQL/);
    assert.equal((await provider.getAll('users')).length, 2);
  });
});

describe('transactions driven by DbContext (BEGIN / COMMIT / ROLLBACK)', () => {
  test('ROLLBACK restores the state captured at BEGIN, including in-place edits', async () => {
    const provider = new MemoryProvider();
    await provider.add({ id: 1, name: 'a' }, 'users');
    await provider.executeQuery('BEGIN', []);
    const [stored] = await provider.getAll('users');
    stored.name = 'mutated';
    await provider.update(stored, 'users');
    await provider.add({ id: 2, name: 'b' }, 'users');
    await provider.addMigration('m1', '');
    await provider.executeQuery('ROLLBACK', []);
    assert.deepEqual(await provider.getAll('users'), [{ id: 1, name: 'a' }]);
    assert.deepEqual(await provider.getMigrations(), []);
  });

  test('COMMIT keeps the changes and a nested BEGIN is rejected', async () => {
    const provider = new MemoryProvider();
    await provider.executeQuery('BEGIN', []);
    await assert.rejects(() => provider.executeQuery('BEGIN', []), /already active/);
    await provider.add({ id: 1 }, 'users');
    await provider.executeQuery('COMMIT', []);
    await provider.executeQuery('ROLLBACK', []);
    assert.deepEqual(await provider.getAll('users'), [{ id: 1 }]);
  });
});
