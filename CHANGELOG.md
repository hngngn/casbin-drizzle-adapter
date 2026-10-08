# casbin-drizzle-adapter

## 1.3.0

### Minor Changes

- d2b04d2: Implement `BatchAdapter` and `FilteredAdapter`, and widen driver support.

    - `addPolicies` and `removePolicies` are implemented, so `e.addPolicies()`,
      `e.addPoliciesEx()` and `e.removePolicies()` work. They previously threw
      `cannot to save policy, the adapter does not implement the BatchAdapter`. Each
      validates every rule before writing, runs in one transaction, and chunks its
      statements. An empty batch is a no-op — in particular `removePolicies(sec,
ptype, [])` cannot render a `DELETE` without a `WHERE` clause.
    - `loadFilteredPolicy` and `isFiltered` are implemented, so `e.loadFilteredPolicy()`
      works instead of throwing. The filter is pushed into SQL rather than applied in
      memory: rules are selected per ptype by position, `""` matches anything, and a
      ptype the filter does not name is read in full. `savePolicy` now refuses to run
      after a filtered load, which would otherwise delete every rule outside the filter.
    - `loadPolicy` carries an `@deprecated` tag pointing at `loadFilteredPolicy`. It
      remains supported and correct — casbin's `Adapter` interface requires it and
      `newEnforcer` calls it — but it reads the whole table into memory.
    - Postgres and MySQL are typed against drizzle's dialect base classes instead of
      `NodePgDatabase` and `MySql2Database`, so postgres.js, neon, vercel-postgres,
      PGlite and planetscale are accepted. `better-sqlite3` is still excluded: it runs
      transaction callbacks synchronously and would not await the adapter's writes.
    - New subpath exports `casbin-drizzle-adapter/pg`, `/mysql` and `/sqlite` export
      `pgCasbinTable`, `mysqlCasbinTable` and `sqliteCasbinTable`, which build a
      correctly shaped table and index `(ptype, v0, v1)`. They are separate entry
      points so a Postgres user does not load the MySQL and SQLite dialect code.
    - The package now declares an `exports` map and `"sideEffects": false`. Deep
      imports into `casbin-drizzle-adapter/dist/*` no longer resolve; use the package
      entry or one of the subpaths.
    - MySQL and SQLite are now covered by tests rather than types alone, and a smoke
      test loads the built package through every entry point in both module formats.
    - `casbin` and `drizzle-orm` are declared as peer dependencies. They are required
      at runtime but were listed nowhere, so installing the package pulled in neither.

- d2b04d2: Make the table types catch a wrong casbin table at compile time.

    - `TCasbinSchema` now requires the table to expose `ptype` and `v0..v5`. Passing a
      table without them was already rejected by the constructor at runtime; it is now
      a type error, and the message names the missing columns.
    - The `v0..v5` columns must be nullable text. A NOT NULL policy column cannot store
      a rule shorter than six values, and `updatePolicy` clears unused columns by
      writing NULL, so such a table failed on its first short rule. It no longer
      compiles. `ptype` is written on every row and may stay NOT NULL.
    - The row types no longer claim an `id` column. The adapter never reads or writes
      one, so a table without `id` is typed honestly, and `ptype` is now required
      rather than optional on the value the adapter writes.
    - The row and column types are derived from a single list of policy columns, so
      they cannot drift from the columns the adapter actually touches.

    Only the property keys are constrained, never the SQL names: the table and each of
    its columns may still be named anything in the database.

### Patch Changes

- d2b04d2: Emit type declarations with `tsc` instead of tsup's dts pass.

    tsup forces `baseUrl` onto the compiler when it generates declarations
    (`baseUrl: compilerOptions.baseUrl || "."`, in its rollup worker). `baseUrl` is
    deprecated: TypeScript 6 errors on it and TypeScript 7 removes it, so `pnpm build`
    failed outright on TS 6 with `TS5101`. No tsconfig setting prevents the injection,
    because tsup overrides whatever the tsconfig says. The previous workaround —
    `"ignoreDeprecations": "6.0"` in `tsconfig.json` — silences the error for exactly
    one major version and stops being accepted on the next.

    - `tsup` now builds JavaScript only; `tsc -p tsconfig.build.json` emits the
      declarations, and `scripts/copy-declarations.mjs` writes the `.d.mts` twin each
      ESM entry needs. A `.d.ts` in a `"type": "commonjs"` package is read as
      CommonJS, which would type the `.mjs` output as CommonJS for consumers.
    - Declarations are no longer bundled into one file per entry, so `dist/types.d.ts`
      now ships alongside them. Both are covered by the existing `"files": ["dist"]`.
    - The two relative imports in `src` are written with an explicit `.js` extension.
      Rolled-up declarations had no relative specifiers at all; emitted ones do, and
      an extensionless specifier is an error for consumers on `node16`/`nodenext`
      module resolution who do not set `skipLibCheck`.

## 1.2.0

### Minor Changes

- 7ee0e60: Fix policy statements matching on `v0` only, and several related correctness bugs.

    - `removePolicy`, `removeFilteredPolicy` and `updatePolicy` passed six conditions to
      Drizzle's `where()`, which takes one — every condition after `eq(v0, ...)` was
      silently discarded, and `ptype` was never part of the clause at all. Removing a
      single `p` rule deleted every rule in the table sharing that subject, across
      ptypes; `updatePolicy` overwrote them. The conditions are now combined with
      `and()`, scoped to `ptype`, and use `IS NULL` for columns the rule does not
      use (`column = NULL` is never true in SQL).
    - `removeFilteredPolicy` now leaves columns outside the requested range
      unconstrained and treats an empty string as casbin's "match anything" wildcard,
      and rejects a field range that runs past the six policy columns.
    - `updatePolicy` clears columns the new rule no longer uses instead of leaving
      values behind from the old rule.
    - `savePolicy` no longer throws on a model without a `[role_definition]` section.
      It previously dereferenced a missing `"g"` section _after_ deleting every row,
      leaving the policy table empty.
    - `savePolicy` now runs in a transaction, validates every rule before writing, and
      inserts in batches instead of one statement per rule.
    - `loadPolicy` no longer drops empty-string values from the middle of a rule (which
      silently changed the rule's arity) and no longer round-trips values through CSV,
      so values containing commas, quotes or surrounding whitespace survive.
    - `loadPolicy` reads through the table passed to the constructor instead of a
      hardcoded `db.query.casbinTable`, so the table no longer has to be registered
      under that name in the Drizzle client's relational schema.
    - Rules longer than the six policy columns now throw instead of being silently
      truncated.
    - The constructor validates that the table defines `ptype` and `v0..v5`, and
      reports which columns are missing.
    - Errors are classified from the driver's SQLSTATE / `errno` before falling back to
      substring matching, and always carry the original error as `cause`. Previously a
      MySQL "Lock wait timeout exceeded" was reported as a connection failure, because
      the generic `"timeout"` needle shadowed the lock category.
    - SQLite databases are now accepted by the type signature. `schema` already
      accepted an `SQLiteTable`, but the database parameter did not, so the documented
      SQLite support was unreachable. Only async-transaction drivers (libsql, D1) are
      accepted; `better-sqlite3` runs transaction callbacks synchronously.

### Patch Changes

- 28384dc: Update all dev dependencies to their latest supported versions and attach the original error as `cause` when policy parsing fails.

    Toolchain changes (no effect on published API):

    - Migrate ESLint config to flat config (`eslint.config.mjs`) for ESLint 10
    - Migrate `drizzle.config.ts` to the `dialect`/`url` format for drizzle-kit 0.31, and `push:pg` -> `push`
    - Move `moduleResolution` off the removed `node10` setting
    - Bump CI to Node 22 and pnpm 10

## 1.1.2

### Patch Changes

- 5d19b06: ## Bug Fixes

    - Add comprehensive error handling for database operations with 8 distinct error categories (connection, permission, constraint violations, etc.)
    - Fix hardcoded table name bug in `savePolicy` method
    - Add input validation on all adapter methods
    - Provide clear, actionable error messages for better debugging

## 1.1.1

### Patch Changes

- 38cd042: Update README

## 1.1.0

### Minor Changes

- 82c918a: ## New Features

    - Implement `UpdatableAdapter` to support update policy

    ## Breaking Changes:
    - Change `casbinRule` to `casbinTable`

    ## Bug Fixes
    - Add missing type for `MySQL` and add `SQLite` type for `schema`

## 1.0.0

### Major Changes

- be8cab5: version `1.0.0`

## 1.0.0

### Major Changes

- 183c987: version: `1.0.0`
