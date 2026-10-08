import { index, pgTable, serial, varchar } from "drizzle-orm/pg-core"

/**
 * A Postgres casbin table shaped the way the adapter needs it: `ptype` and
 * `v0..v5` as nullable text, plus an index over the leading columns every
 * equality lookup uses (`removePolicy`, `updatePolicy`, a filtered load).
 *
 * Column names are free — only the property keys matter — so this is a
 * convenience, not a requirement. Hand-written tables keep working.
 */
export const pgCasbinTable = (name = "casbin_rule", valueLength = 254) =>
    pgTable(
        name,
        {
            id: serial("id").primaryKey(),
            ptype: varchar("ptype", { length: valueLength }),
            v0: varchar("v0", { length: valueLength }),
            v1: varchar("v1", { length: valueLength }),
            v2: varchar("v2", { length: valueLength }),
            v3: varchar("v3", { length: valueLength }),
            v4: varchar("v4", { length: valueLength }),
            v5: varchar("v5", { length: valueLength }),
        },
        (table) => [index(`${name}_ptype_v0_v1_idx`).on(table.ptype, table.v0, table.v1)],
    )
