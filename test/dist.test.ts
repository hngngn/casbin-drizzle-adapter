import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"

// Every other test imports from `../src`, so nothing else exercises what `tsup`
// actually emits. `bundle: false` rewrites no import paths, which means any
// runtime import of a module that is not its own entry point emits a specifier
// Node cannot resolve — a break invisible to the rest of the suite.
const require_ = createRequire(import.meta.url)
const dist = join(import.meta.dirname, "..", "dist")

// Both loaders take the path as a value rather than a literal specifier. `dist`
// is a build artifact and is absent on a clean checkout, so `import("../dist/
// index.mjs")` would resolve at type-check time and fail `tsc --noEmit` before
// anything has been built.
const importESM = (file: string): Promise<Record<string, unknown>> =>
    import(pathToFileURL(join(dist, file)).href) as Promise<Record<string, unknown>>

const requireCJS = (file: string): Record<string, unknown> =>
    require_(join(dist, file)) as Record<string, unknown>

describe.skipIf(!existsSync(dist))("built package", () => {
    it("loads through the CommonJS entry points", () => {
        expect(requireCJS("index.js")).toHaveProperty("DrizzleAdapter")
        expect(requireCJS("table/pg.js")).toHaveProperty("pgCasbinTable")
        expect(requireCJS("table/mysql.js")).toHaveProperty("mysqlCasbinTable")
        expect(requireCJS("table/sqlite.js")).toHaveProperty("sqliteCasbinTable")
    })

    it("loads through the ES module entry points", async () => {
        await expect(importESM("index.mjs")).resolves.toHaveProperty("DrizzleAdapter")
        await expect(importESM("table/pg.mjs")).resolves.toHaveProperty("pgCasbinTable")
        await expect(importESM("table/mysql.mjs")).resolves.toHaveProperty("mysqlCasbinTable")
        await expect(importESM("table/sqlite.mjs")).resolves.toHaveProperty("sqliteCasbinTable")
    })

    it("builds a table the adapter accepts", async () => {
        const { getTableColumns } = await import("drizzle-orm")
        const { pgCasbinTable } = (await importESM("table/pg.mjs")) as {
            pgCasbinTable: (name: string) => Parameters<typeof getTableColumns>[0]
        }

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
