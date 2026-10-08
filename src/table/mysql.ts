import { index, int, mysqlTable, varchar } from "drizzle-orm/mysql-core"

/**
 * A MySQL casbin table shaped the way the adapter needs it. See
 * {@link ../pg!pgCasbinTable} for the rationale; the shape is identical.
 */
export const mysqlCasbinTable = (name = "casbin_rule", valueLength = 254) =>
    mysqlTable(
        name,
        {
            id: int("id").autoincrement().primaryKey(),
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
