import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// Every other test imports from `../src`, so nothing else exercises what `tsup`
// actually emits. `bundle: false` rewrites no import paths, which means any
// runtime import of a module that is not its own entry point emits a specifier
// Node cannot resolve — a break invisible to the rest of the suite.
const require_ = createRequire(import.meta.url)
const dist = join(import.meta.dirname, "..", "dist")

describe.skipIf(!existsSync(dist))("built package", () => {
    it("loads through the CommonJS entry points", () => {
        expect(require_("../dist/index.js")).toHaveProperty("DrizzleAdapter")
        expect(require_("../dist/table/pg.js")).toHaveProperty("pgCasbinTable")
        expect(require_("../dist/table/mysql.js")).toHaveProperty("mysqlCasbinTable")
        expect(require_("../dist/table/sqlite.js")).toHaveProperty("sqliteCasbinTable")
    })

    it("loads through the ES module entry points", async () => {
        await expect(import("../dist/index.mjs")).resolves.toHaveProperty("DrizzleAdapter")
        await expect(import("../dist/table/pg.mjs")).resolves.toHaveProperty("pgCasbinTable")
        await expect(import("../dist/table/mysql.mjs")).resolves.toHaveProperty("mysqlCasbinTable")
        await expect(import("../dist/table/sqlite.mjs")).resolves.toHaveProperty(
            "sqliteCasbinTable",
        )
    })

    it("builds a table the adapter accepts", async () => {
        const { pgCasbinTable } = await import("../dist/table/pg.mjs")
        const { getTableColumns } = await import("drizzle-orm")

        expect(Object.keys(getTableColumns(pgCasbinTable("demo")))).toEqual([
            "id",
            "ptype",
            "v0",
            "v1",
            "v2",
            "v3",
            "v4",
            "v5",
        ])
    })
})
