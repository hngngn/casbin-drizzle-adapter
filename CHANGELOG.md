# casbin-drizzle-adapter

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
