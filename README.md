# Drizzle Adapter

This Adapter is based on [Prisma Adapter](https://github.com/node-casbin/prisma-adapter)

Drizzle Adapter is the [Drizzle](https://github.com/drizzle-team/drizzle-orm) adapter for [Node-Casbin](https://github.com/casbin/node-casbin). With this library, Node-Casbin can load policy from Drizzle supported database or save policy to it.

Based on [Officially Supported Databases](https://orm.drizzle.team/docs), the current supported databases are:

-   PostgreSQL
-   MySQL
-   SQLite

## Installation

```
pnpm add casbin-drizzle-adapter
```

## Getting Started

Create table(PostgreSQL):

```sql
import { pgTable, serial, varchar } from "drizzle-orm/pg-core"

-- Must be named casbinTable
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

Here is a simple example with `PostgreSQL`:

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
    const d = drizzle(pool, {
        schema: {
            casbinTable,
        },
    })

    const a = await DrizzleAdapter.newAdapter(d, casbinTable)
    const e = await casbin.newEnforcer("examples/rbac_model.conf", a)

    // Check the permission.
    e.enforce("alice", "data1", "read")

    // Modify the policy.
    // await e.addPolicy(...);
    // await e.removePolicy(...);

    // Save the policy back to DB.
    await e.savePolicy()
}

main()
```

## Getting Help

-   [Node-Casbin](https://github.com/casbin/node-casbin)

## License

This project is under MIT. See the [LICENSE](LICENSE) file for the full license text.
