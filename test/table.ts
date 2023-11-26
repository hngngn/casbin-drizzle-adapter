import { pgTable, serial, varchar } from "drizzle-orm/pg-core"

export const casbinRule = pgTable("casbin_rule", {
    id: serial("id").primaryKey().notNull(),
    ptype: varchar("ptype", { length: 254 }),
    v0: varchar("v0", { length: 254 }),
    v1: varchar("v1", { length: 254 }),
    v2: varchar("v2", { length: 254 }),
    v3: varchar("v3", { length: 254 }),
    v4: varchar("v4", { length: 254 }),
    v5: varchar("v5", { length: 254 }),
})
