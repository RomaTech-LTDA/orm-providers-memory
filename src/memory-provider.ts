/**
 * @module memory-provider
 *
 * In-memory implementation of {@link IDbProvider} for testing and prototyping.
 *
 * Data is stored in plain JavaScript Maps and Arrays. No I/O is performed —
 * all operations are synchronous under the hood (wrapped in Promises for
 * interface compatibility).
 *
 * This provider enforces primary key uniqueness and supports all query
 * operations via the client-side query evaluator from `@romatech/orm`.
 */

import { applyClientSideQuery, IDbProvider, QueryObject, TableColumnInfo } from '@romatech/orm';

/**
 * Internal state for a single table: column definitions + row storage.
 */
interface TableState {
    /** Column metadata (names, types, PK flag). */
    columns: TableColumnInfo[];
    /** Name of the primary key column (if any). */
    primaryKey?: string;
    /** Array of row objects stored in insertion order. */
    rows: any[];
}

/**
 * An in-memory database provider that stores all data in process memory.
 *
 * Ideal for:
 * - Unit tests (no database required)
 * - Integration tests (fast, isolated)
 * - Prototyping and demos
 *
 * @example
 * ```ts
 * import { MemoryProvider } from '@romatech/orm-providers-memory';
 *
 * const provider = new MemoryProvider();
 * // Use with DbContext:
 * new DbContextOptions().useProvider(provider);
 * ```
 */
export class MemoryProvider implements IDbProvider {
    /** Map of table name → table state. */
    private tables = new Map<string, TableState>();

    /** Map of migration name → migration script content. */
    private migrations = new Map<string, string>();

    /** State captured by `BEGIN`, restored by `ROLLBACK` (see executeQuery). */
    private snapshot?: { tables: Map<string, TableState>; migrations: Map<string, string> };

    // ─── Connection Lifecycle ────────────────────────────────────────────────────
    // No-ops for in-memory — there's nothing to connect to.

    /** No-op. In-memory provider is always "connected". */
    async connect(_connectionString = ''): Promise<void> {
        return;
    }

    /** No-op. Nothing to disconnect from. */
    async disconnect(): Promise<void> {
        return;
    }

    // ─── CRUD Operations ─────────────────────────────────────────────────────────

    /**
     * Inserts an entity into the table's row array.
     * Throws if an entity with the same primary key already exists.
     */
    async add<T>(entity: T, tableName: string): Promise<void> {
        const table = this.ensureTable(tableName);
        const key = this.getEntityKey(table, entity);

        if (key !== undefined && table.rows.some(row => this.getEntityKey(table, row) === key)) {
            throw new Error(`Entity with key '${String(key)}' already exists in '${tableName}'.`);
        }

        table.rows.push(entity);
    }

    /** Inserts multiple entities one by one. */
    async addRange<T>(entities: T[], tableName: string): Promise<void> {
        for (const entity of entities) {
            await this.add(entity, tableName);
        }
    }

    /**
     * Replaces the existing row with the same primary key.
     * Throws if no matching row is found.
     */
    async update<T>(entity: T, tableName: string): Promise<void> {
        const table = this.ensureTable(tableName);
        const index = this.findEntityIndex(table, entity);

        if (index === -1) {
            throw new Error(`Entity not found in '${tableName}'.`);
        }

        table.rows[index] = entity;
    }

    /** Removes the row matching the entity's primary key (or by reference). */
    async remove<T>(entity: T, tableName: string): Promise<void> {
        const table = this.ensureTable(tableName);
        const index = this.findEntityIndex(table, entity);

        if (index !== -1) {
            table.rows.splice(index, 1);
        }
    }

    /** Removes multiple entities. */
    async removeRange<T>(entities: T[], tableName: string): Promise<void> {
        for (const entity of entities) {
            await this.remove(entity, tableName);
        }
    }

    /** Finds an entity by primary key. Returns undefined if not found. */
    async find<T>(entity: T, tableName: string): Promise<T | undefined> {
        const table = this.ensureTable(tableName);
        const index = this.findEntityIndex(table, entity);
        return index === -1 ? undefined : table.rows[index] as T;
    }

    /** Returns a shallow copy of all rows in the table. */
    async getAll<T>(tableName: string): Promise<T[]> {
        return [...this.ensureTable(tableName).rows] as T[];
    }

    /** No-op — changes are applied immediately in memory. */
    async saveChanges(): Promise<void> {
        return;
    }

    // ─── Migration History ───────────────────────────────────────────────────────

    /** Records a migration as applied. */
    async addMigration(migrationName: string, migrationScript: string): Promise<void> {
        this.migrations.set(migrationName, migrationScript);
    }

    /** Removes a migration from the history. */
    async removeMigration(migrationName: string): Promise<void> {
        this.migrations.delete(migrationName);
    }

    /** No-op. */
    async applyMigrations(): Promise<void> {
        return;
    }

    /** Returns all migration names in insertion order. */
    async getMigrations(): Promise<string[]> {
        return Array.from(this.migrations.keys());
    }

    /** Alias for getMigrations(). */
    async getMigrationHistory(): Promise<string[]> {
        return this.getMigrations();
    }

    /** No-op — migrations are managed externally via MigrationService. */
    async updateDatabase(_targetMigration?: string): Promise<void> {
        return;
    }

    /** No-op — migrations are managed externally via MigrationService. */
    async downgradeDatabase(_targetMigration?: string): Promise<void> {
        return;
    }

    // ─── Schema Management ───────────────────────────────────────────────────────

    /** Creates a new table in the in-memory store. */
    async createTable(input: { tableName: string; columns: TableColumnInfo[]; primaryKey?: string }): Promise<void> {
        const primaryKey = input.primaryKey || input.columns.find(column => column.primaryKey)?.name;
        this.tables.set(input.tableName, {
            columns: [...input.columns],
            primaryKey,
            rows: []
        });
    }

    /** Removes a table from the in-memory store. */
    async dropTable(tableName: string): Promise<void> {
        this.tables.delete(tableName);
    }

    /** Adds a column definition to the table and sets undefined on all existing rows. */
    async addColumn(tableName: string, column: TableColumnInfo): Promise<void> {
        const table = this.ensureTable(tableName);
        table.columns.push(column);

        if (column.primaryKey) {
            table.primaryKey = column.name;
        }

        // Backfill existing rows with undefined for the new column
        for (const row of table.rows) {
            row[column.name] = undefined;
        }
    }

    /** Removes a column definition and deletes the property from all rows. */
    async removeColumn(tableName: string, columnName: string): Promise<void> {
        const table = this.ensureTable(tableName);
        table.columns = table.columns.filter(column => column.name !== columnName);

        if (table.primaryKey === columnName) {
            table.primaryKey = table.columns.find(column => column.primaryKey)?.name;
        }

        for (const row of table.rows) {
            delete row[columnName];
        }
    }

    // ─── Scaffold / Introspection ────────────────────────────────────────────────

    /** No-op. */
    async scaffold(_connectionString: string): Promise<void> {
        return;
    }

    /** Returns all table names. */
    async getTables(): Promise<string[]> {
        return Array.from(this.tables.keys());
    }

    /** Returns column metadata for a table. */
    async getColumnsForTable(table: string): Promise<TableColumnInfo[]> {
        return [...(this.tables.get(table)?.columns || [])];
    }

    // ─── Query Execution ─────────────────────────────────────────────────────────

    /**
     * Overloaded query execution:
     * - With `string, any[]` → supports the raw statements the ORM itself
     *   issues: `BEGIN` / `COMMIT` / `ROLLBACK` (snapshot transactions used by
     *   `DbContext.beginTransaction()`) and `SELECT * FROM <table>`. Any other
     *   SQL throws instead of returning unfiltered rows or silently doing
     *   nothing.
     * - With `string, QueryObject` → uses the client-side query evaluator.
     */
    async executeQuery<T = any>(query: string, params?: any[]): Promise<T[]>;
    async executeQuery<T, TResult = T>(entityName: string, query: QueryObject<T, TResult>): Promise<TResult[]>;
    async executeQuery<T, TResult = T>(
        queryOrEntityName: string,
        paramsOrQuery: any[] | QueryObject<T, TResult> = []
    ): Promise<T[] | TResult[]> {
        if (Array.isArray(paramsOrQuery)) {
            return this.executeSqlLikeQuery<T>(queryOrEntityName);
        }

        return this.executeObjectQuery<T, TResult>(queryOrEntityName, paramsOrQuery);
    }

    // ─── Public Utility ──────────────────────────────────────────────────────────

    /**
     * Clears all tables and migration history.
     * Useful in test teardown to reset state between tests.
     */
    clear(): void {
        this.tables.clear();
        this.migrations.clear();
        this.snapshot = undefined;
    }

    // ─── Private Helpers ─────────────────────────────────────────────────────────

    /**
     * Executes a structured query object using the client-side evaluator
     * from @romatech/orm (filter, sort, page, project in memory).
     */
    private executeObjectQuery<T, TResult = T>(tableName: string, query: QueryObject<T, TResult>): TResult[] {
        const rows = [...this.ensureTable(tableName).rows] as T[];
        return applyClientSideQuery(rows, query);
    }

    /**
     * Minimal raw-SQL support. Only statements whose result can be produced
     * exactly are accepted; everything else (WHERE clauses, UPDATE, DELETE,
     * ...) throws, because returning all rows or doing nothing would make
     * tests pass against behaviour a real database would not have.
     */
    private executeSqlLikeQuery<T>(sql: string): T[] {
        const statement = sql.trim().replace(/;\s*$/, '');

        if (/^(BEGIN|START)(\s+TRANSACTION)?$/i.test(statement)) {
            if (this.snapshot) {
                throw new Error('A transaction is already active.');
            }
            this.snapshot = { tables: cloneTables(this.tables), migrations: new Map(this.migrations) };
            return [];
        }

        if (/^COMMIT(\s+TRANSACTION)?$/i.test(statement)) {
            this.snapshot = undefined;
            return [];
        }

        if (/^ROLLBACK(\s+TRANSACTION)?$/i.test(statement)) {
            if (this.snapshot) {
                this.tables = this.snapshot.tables;
                this.migrations = this.snapshot.migrations;
                this.snapshot = undefined;
            }
            return [];
        }

        const select = statement.match(/^SELECT\s+\*\s+FROM\s+(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][\w$]*))$/i);
        if (select) {
            const tableName = select[1] ?? select[2] ?? select[3] ?? select[4];
            return [...this.ensureTable(tableName).rows] as T[];
        }

        throw new Error(
            `MemoryProvider cannot execute raw SQL: "${statement}". ` +
            'Only BEGIN, COMMIT, ROLLBACK and "SELECT * FROM <table>" are supported; use the query API instead.'
        );
    }

    /**
     * Gets or creates the table state for a given table name.
     * If the table does not exist yet, creates an empty one.
     */
    private ensureTable(tableName: string): TableState {
        let table = this.tables.get(tableName);

        if (!table) {
            table = { columns: [], rows: [] };
            this.tables.set(tableName, table);
        }

        return table;
    }

    /**
     * Finds the index of an entity in the table's row array by primary key
     * (or by reference equality if no PK is defined).
     */
    private findEntityIndex<T>(table: TableState, entity: T): number {
        const key = this.getEntityKey(table, entity);

        if (key !== undefined) {
            return table.rows.findIndex(row => this.getEntityKey(table, row) === key);
        }

        // Fall back to reference equality
        return table.rows.findIndex(row => row === entity);
    }

    /**
     * Extracts the primary key value from an entity object. Tables without a
     * declared key use `id`, like the SQL providers do. Returns undefined if
     * the entity is not an object or has no key value.
     */
    private getEntityKey<T>(table: TableState, entity: T): unknown {
        if (!entity || typeof entity !== 'object') {
            return undefined;
        }

        return (entity as Record<string, unknown>)[table.primaryKey ?? 'id'] ?? undefined;
    }
}

/**
 * Copies every table so later writes (including in-place mutation of stored
 * rows and of the arrays, objects and dates they hold) do not leak into the
 * snapshot. Values are copied deeply; objects keep their prototype and
 * shared or cyclic references keep their shape.
 */
function cloneTables(tables: Map<string, TableState>): Map<string, TableState> {
    const seen = new Map<object, unknown>();
    const copy = new Map<string, TableState>();
    for (const [name, table] of tables) {
        copy.set(name, {
            columns: [...table.columns],
            primaryKey: table.primaryKey,
            rows: table.rows.map(row => cloneValue(row, seen))
        });
    }
    return copy;
}

function cloneValue(value: any, seen: Map<object, unknown>): any {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (seen.has(value)) {
        return seen.get(value);
    }
    if (value instanceof Date) {
        const date = new Date(value.getTime());
        seen.set(value, date);
        return date;
    }
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
        const buffer = typeof (value as any).slice === 'function' ? (value as any).slice(0) : value;
        seen.set(value, buffer);
        return buffer;
    }
    if (value instanceof Map) {
        const map = new Map();
        seen.set(value, map);
        for (const [key, entry] of value) map.set(cloneValue(key, seen), cloneValue(entry, seen));
        return map;
    }
    if (value instanceof Set) {
        const set = new Set();
        seen.set(value, set);
        for (const entry of value) set.add(cloneValue(entry, seen));
        return set;
    }
    if (Array.isArray(value)) {
        const array: unknown[] = [];
        seen.set(value, array);
        for (const entry of value) array.push(cloneValue(entry, seen));
        return array;
    }
    const object = Object.create(Object.getPrototypeOf(value));
    seen.set(value, object);
    for (const key of Object.keys(value)) {
        object[key] = cloneValue(value[key], seen);
    }
    return object;
}
