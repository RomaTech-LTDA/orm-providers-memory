# Changelog

All notable changes to @romatech/orm-providers-memory will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [2.1.0] - 2026-11-11

### Fixed
- Raw SQL `WHERE` was ignored: `executeQuery('SELECT * FROM t WHERE ...', params)` (and `DbContext.rawQuery`) returned every row of the table, so code under test could pass against results a real database would never return.
- Raw `DELETE`/`UPDATE` (including `DbContext.deleteWhere`/`updateWhere`) were silent no-ops.
- `ROLLBACK` kept every change. `BEGIN`/`COMMIT`/`ROLLBACK` (what `DbContext.beginTransaction()` and `Transaction.commit()/rollback()` send) now implement snapshot transactions: `ROLLBACK` restores the tables and migration history captured at `BEGIN`, including in-place edits of stored rows and of the arrays, objects, `Map`/`Set` and `Date` values they hold (the snapshot is a deep copy that keeps each row's class). A nested `BEGIN` throws.
- Tables without a declared primary key now use `id`, like the SQL providers: `update` of a fresh object with an existing `id` threw "Entity not found", and duplicate `id` values were accepted.

### Changed
- **Behaviour change (raw SQL):** only `BEGIN`/`START TRANSACTION`, `COMMIT`, `ROLLBACK` and `SELECT * FROM <table>` (bare, `"quoted"`, `` `quoted` `` or `[quoted]`) are accepted. Any other statement, including `DbContext.deleteWhere`/`updateWhere`/`rawExecute`, now throws `MemoryProvider cannot execute raw SQL` instead of returning unfiltered rows or doing nothing. Use the query API (`where`, `remove`, `update`) in code that must run on this provider.
- **Behaviour change (keys):** on tables without a declared primary key, `add` now rejects a second row with the same `id`, and `update`/`remove`/`find` match rows by `id` (reference equality is still used for rows without an `id`).
- Standardized `index.html` landing page (GitHub Pages; not part of the npm package).

### Build / CI
- `package-lock.json` re-synced with `package.json` (it still pinned `@romatech/orm@1.2.0`, so `npm ci` failed).
- CI runs `npm ci`, build, tests, `npm audit --omit=dev` and `npm pack --dry-run` on Node 22 and 24, with read-only `contents` permission.
- The publish workflow installs with `npm ci` on Node 22 and no longer rewrites the `@romatech/orm` range in `package.json` at publish time: the package is published with the range committed in the repository and tested against the locked core version.
- Added `npm test` (Node test runner, runs against `dist/`, so build first).

## [2.0.0] - 2026-06-26

### Changed
- Requires `@romatech/orm` `^2.0.0` (peer dependency). The details of this release were not recorded in this changelog at the time.

## [1.3.0] - 2026-06-18

### Added
- First release recorded in this changelog (this section was previously labelled 1.2.0, a version of this package that was never published; 1.0.0 was published on 2026-06-15 without changelog notes).
