# Drizzle Adapter

This Adapter is based on [Prisma Adapter](https://github.com/node-casbin/prisma-adapter)

Drizzle Adapter is the [Drizzle](https://github.com/drizzle-team/drizzle-orm) adapter for [Node-Casbin](https://github.com/casbin/node-casbin). With this library, Node-Casbin can load policy from a Drizzle-supported database or save policy to it.

Based on [Officially Supported Databases](https://orm.drizzle.team/docs), the current supported databases are:

-   PostgreSQL — any driver (node-postgres, postgres.js, neon, vercel-postgres, PGlite, ...)
-   MySQL — any driver (mysql2, planetscale, ...)
-   SQLite — drivers with **asynchronous** transactions (libsql, D1, ...)

`better-sqlite3` is not supported: it runs transaction callbacks synchronously and
would not await this adapter's writes. The type signature rejects it.

## Installation

```
pnpm add casbin-drizzle-adapter casbin drizzle-orm
```

`casbin` and `drizzle-orm` are peer dependencies, alongside whichever database
driver you already use (`pg`, `mysql2`, `@libsql/client`, ...).

## Getting Started

### 1. Define the table

The quickest way is the bundled helper, which also indexes the columns every
lookup uses:

```ts
import { pgCasbinTable } from "casbin-drizzle-adapter/pg"

export const casbinTable = pgCasbinTable("casbin_rule")
```

`casbin-drizzle-adapter/mysql` and `casbin-drizzle-adapter/sqlite` export
`mysqlCasbinTable` and `sqliteCasbinTable` for the other dialects.

Or define it yourself — the adapter accepts any table with the right shape:

```ts
import { pgTable, serial, varchar } from "drizzle-orm/pg-core"

// Only the property keys matter, never the SQL names: the table may be called
// anything and each column may map to any database column, but the keys ptype
// and v0..v5 must all be present. v0..v5 must be nullable — a rule shorter than
// six values is stored with its unused columns left NULL. Any other column (id
// here) is never written by the adapter, so it must be generated or nullable.
export const casbinTable = pgTable("casbin_rule", {
    id: serial("id").primaryKey().notNull(),
    ptype: varchar("ptype", { length: 254 }),
    v0: varchar("v0", { length: 254 }),
    v1: varchar("v1", { length: 254 }),
    v2: varchar("v2", { length: 254 }),
    v3: varchar("v3", { length: 254 }),
    v4: varchar("v4", { length: 254 }),
    v5: varchar("v5", { length: 254 }),
})
```

A table missing those columns, or declaring `v0..v5` as `NOT NULL`, is a
compile-time error — and still a constructor error for JavaScript callers.

### 2. Create the enforcer

```ts
import casbin from "casbin"
import { DrizzleAdapter } from "casbin-drizzle-adapter"
import { Pool } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { casbinTable } from "./your-table-schema"

async function main() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    })
    const d = drizzle(pool)

    const a = DrizzleAdapter.newAdapter(d, casbinTable)
    const e = await casbin.newEnforcer("examples/rbac_model.conf", a)

    // Check the permission.
    await e.enforce("alice", "data1", "read")

    // Modify the policy.
    // await e.addPolicy(...);
    // await e.removePolicy(...);

    // Save the policy back to DB.
    await e.savePolicy()
}

main()
```

## Batched writes

`addPolicies` and `removePolicies` are implemented, so the enforcer's batch APIs
work. Each validates every rule before writing any of them, runs in a single
transaction, and chunks its statements to stay inside the database's bind
parameter limit:

```ts
await e.addPolicies([
    ["alice", "data1", "read"],
    ["bob", "data2", "write"],
])
```

## Large policy tables

`loadPolicy` reads the entire table into memory. Once that is too much, filter the
load and casbin only ever sees the rules you asked for. The filter is pushed into
SQL, not applied afterwards:

```ts
// p = sub, dom, obj, act  →  the tenant is v1
// g = _, _, _             →  the tenant is v2
await e.loadFilteredPolicy({ p: ["", "tenant_a"], g: ["", "", "tenant_a"] })
```

Each array holds the values a rule must have at `v0`, `v1`, ... in order. `""`
matches anything at that position, and a ptype the filter does not name is loaded
in full — the same semantics as casbin's own filtered adapters.

**There is no tenant column.** A rule is only filterable by values it already
stores, which is what casbin's domain models are for: put the tenant in the rule
and it lands in a policy column. Note that it sits at a different index per ptype,
which is why the filter is written per ptype.

Two things to know:

-   A filter narrower than your model needs is **not an error**. The missing rules
    never load, so `enforce` reports a deny rather than failing loudly.
-   `savePolicy` is refused after a filtered load. The model holds only the rules
    that filter matched, so writing it back would delete every rule outside the
    filter. Call `loadPolicy` first if you really mean to replace everything.

Use `adapter.isFiltered()` to check which state you are in.

## Supported casbin interfaces

| Interface          | Methods                                                       |
| ------------------ | ------------------------------------------------------------- |
| `Adapter`          | `loadPolicy`, `savePolicy`, `addPolicy`, `removePolicy`, `removeFilteredPolicy` |
| `BatchAdapter`     | `addPolicies`, `removePolicies`                                |
| `FilteredAdapter`  | `loadFilteredPolicy`, `isFiltered`                             |
| `UpdatableAdapter` | `updatePolicy`                                                 |

## Getting Help

-   [Node-Casbin](https://github.com/casbin/node-casbin)

## License

This project is under MIT. See the [LICENSE](LICENSE) file for the full license text.
