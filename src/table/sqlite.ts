import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

/**
 * A SQLite casbin table shaped the way the adapter needs it. See
 * {@link ../pg!pgCasbinTable} for the rationale; the shape is identical, with
 * `text` in place of `varchar` since SQLite does not constrain length.
 */
export const sqliteCasbinTable = (name = "casbin_rule") =>
    sqliteTable(
        name,
        {
            id: integer("id").primaryKey({ autoIncrement: true }),
            ptype: text("ptype"),
            v0: text("v0"),
            v1: text("v1"),
            v2: text("v2"),
            v3: text("v3"),
            v4: text("v4"),
            v5: text("v5"),
        },
        (table) => [index(`${name}_ptype_v0_v1_idx`).on(table.ptype, table.v0, table.v1)],
    )
