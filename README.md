# @romatech/orm-providers-memory

[![npm](https://img.shields.io/npm/v/@romatech%2Form-providers-memory)](https://www.npmjs.com/package/@romatech/orm-providers-memory)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/RomaTech-LTDA/orm-providers-memory/blob/main/LICENSE)

<p align="center">
  <img src="logo.png" width="120" alt="RomaTech ORM – Memory Provider" />
</p>

In-memory provider for [@romatech/orm](https://www.npmjs.com/package/@romatech/orm).

Ideal for **unit tests**, **integration tests**, and **rapid prototyping** without spinning up a real database.

---

## Installation

```bash
npm install @romatech/orm @romatech/orm-providers-memory reflect-metadata
```

---

## Quick Start

```ts
import 'reflect-metadata';
import { DbContext, DbContextOptions, Entity, PrimaryKey, Column } from '@romatech/orm';
import { MemoryProvider } from '@romatech/orm-providers-memory';

@Entity('Users')
class User {
    @PrimaryKey() id!: number;
    @Column() name!: string;
    @Column() email!: string;
}

class TestDbContext extends DbContext {
    users = this.set(User);

    constructor() {
        super(new DbContextOptions().useProvider(new MemoryProvider()));
    }
}

// In your test
const db = new TestDbContext();

db.users.add({ id: 1, name: 'Alice', email: 'alice@example.com' });
await db.saveChanges();

const users = await db.users.ToList();
console.log(users); // [{ id: 1, name: 'Alice', email: 'alice@example.com' }]

const alice = await db.users.FirstOrDefault(u => u.name === 'Alice');
console.log(alice?.email); // 'alice@example.com'
```

---

## How It Works

The MemoryProvider stores entities in plain JavaScript `Map` and `Array` structures.
All operations (add, update, remove, query) happen synchronously in memory — no I/O.

Features:
- Primary key uniqueness enforcement
- Full QueryBuilder support (where, orderBy, skip, take, select, etc.)
- Migration history tracking (in-memory)
- Schema management (createTable, dropTable, addColumn, removeColumn)
- `clear()` method to reset all data between tests

---

## Usage in Tests

### Creating a fresh context per test

```ts
describe('UserService', () => {
    let db: TestDbContext;

    beforeEach(() => {
        db = new TestDbContext(); // fresh in-memory database each time
    });

    it('should create a user', async () => {
        db.users.add({ id: 1, name: 'Bob', email: 'bob@x.com' });
        await db.saveChanges();

        const count = await db.users.Count();
        expect(count).toBe(1);
    });

    it('should query users by name', async () => {
        db.users.addRange([
            { id: 1, name: 'Alice', email: 'a@x.com' },
            { id: 2, name: 'Bob', email: 'b@x.com' }
        ]);
        await db.saveChanges();

        const result = await db.users
            .Where(u => u.name === 'Alice')
            .FirstOrDefault();

        expect(result?.email).toBe('a@x.com');
    });
});
```

### Resetting state

If you share a provider instance, use `clear()`:

```ts
const provider = new MemoryProvider();

afterEach(() => {
    provider.clear(); // wipes all tables and migration history
});
```

---

## Differences from Real Providers

| Aspect | Memory Provider | Real Providers |
|--------|-----------------|----------------|
| Persistence | None — data is lost on process exit | Durable |
| Transactions | Not supported | Provider-dependent |
| SQL execution | Simulated (regex-based FROM parsing) | Native driver |
| Concurrency | Single-threaded | Database-managed |
| Performance | O(n) scans | Index-driven |

---

## API Extensions

The MemoryProvider exposes one additional method not on `IDbProvider`:

```ts
/** Clears all tables and migration history. */
clear(): void;
```

---

## Requirements

- Node.js >= 18
- No external dependencies (zero-cost)

---

## License

MIT © RomaTech / Leandro Romanelli
