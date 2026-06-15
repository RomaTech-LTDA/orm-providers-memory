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
     * - With `string, any[]` → simulates SQL by parsing the FROM clause.
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
     * Minimal SQL-like query simulator. Parses the FROM clause to find the
     * table name, then returns all rows. Used when raw SQL strings are passed
     * (e.g. for migration history queries).
     */
    private executeSqlLikeQuery<T>(sql: string): T[] {
        const match = sql.match(/FROM\s+["'`\[]?([a-zA-Z0-9_]+)/i);
        if (!match) {
            return [];
        }

        return [...this.ensureTable(match[1]).rows] as T[];
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
     * Extracts the primary key value from an entity object.
     * Returns undefined if no PK is defined or the entity is not an object.
     */
    private getEntityKey<T>(table: TableState, entity: T): unknown {
        if (!entity || typeof entity !== 'object' || !table.primaryKey) {
            return undefined;
        }

        return (entity as Record<string, unknown>)[table.primaryKey];
    }
}
