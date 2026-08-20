---
"casbin-drizzle-adapter": minor
---

Implement `BatchAdapter` and `FilteredAdapter`, and widen driver support.

-   `addPolicies` and `removePolicies` are implemented, so `e.addPolicies()`,
    `e.addPoliciesEx()` and `e.removePolicies()` work. They previously threw
    `cannot to save policy, the adapter does not implement the BatchAdapter`. Each
    validates every rule before writing, runs in one transaction, and chunks its
    statements. An empty batch is a no-op — in particular `removePolicies(sec,
ptype, [])` cannot render a `DELETE` without a `WHERE` clause.
-   `loadFilteredPolicy` and `isFiltered` are implemented, so `e.loadFilteredPolicy()`
    works instead of throwing. The filter is pushed into SQL rather than applied in
    memory: rules are selected per ptype by position, `""` matches anything, and a
    ptype the filter does not name is read in full. `savePolicy` now refuses to run
    after a filtered load, which would otherwise delete every rule outside the filter.
-   `loadPolicy` carries an `@deprecated` tag pointing at `loadFilteredPolicy`. It
    remains supported and correct — casbin's `Adapter` interface requires it and
    `newEnforcer` calls it — but it reads the whole table into memory.
-   Postgres and MySQL are typed against drizzle's dialect base classes instead of
    `NodePgDatabase` and `MySql2Database`, so postgres.js, neon, vercel-postgres,
    PGlite and planetscale are accepted. `better-sqlite3` is still excluded: it runs
    transaction callbacks synchronously and would not await the adapter's writes.
-   New subpath exports `casbin-drizzle-adapter/pg`, `/mysql` and `/sqlite` export
    `pgCasbinTable`, `mysqlCasbinTable` and `sqliteCasbinTable`, which build a
    correctly shaped table and index `(ptype, v0, v1)`. They are separate entry
    points so a Postgres user does not load the MySQL and SQLite dialect code.
-   The package now declares an `exports` map and `"sideEffects": false`. Deep
    imports into `casbin-drizzle-adapter/dist/*` no longer resolve; use the package
    entry or one of the subpaths.
-   MySQL and SQLite are now covered by tests rather than types alone, and a smoke
    test loads the built package through every entry point in both module formats.
-   `casbin` and `drizzle-orm` are declared as peer dependencies. They are required
    at runtime but were listed nowhere, so installing the package pulled in neither.
