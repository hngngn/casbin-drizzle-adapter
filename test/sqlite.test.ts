import { newEnforcer, newModel } from "casbin"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/libsql"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { DrizzleAdapter } from "../src"
import { sqliteCasbinTable } from "../src/table/sqlite"

// SQLite runs in-process, so this file needs no server and covers the dialect
// the adapter claims to support but only ever type-checked. `TQueryRunner`
// assumes the three dialects' query builders are structurally identical; these
// tests are what makes that assumption more than a comment.
const casbinTable = sqliteCasbinTable("casbin_rule")
// Not `:memory:`: libsql hands each pooled connection its own in-memory
// database, so the connection a transaction runs on would not see this table.
const directory = mkdtempSync(join(tmpdir(), "casbin-drizzle-"))
const db = drizzle({ connection: { url: `file:${join(directory, "test.db")}` } })
const adapter = DrizzleAdapter.newAdapter(db, casbinTable)

const rows = async (): Promise<(string | null)[][]> => {
    const found = await db.select().from(casbinTable)
    return found
        .map((r) => [r.ptype, r.v0, r.v1, r.v2, r.v3, r.v4, r.v5])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

const aclModel = () =>
    newModel(`
[request_definition]
r = sub, obj, act
[policy_definition]
p = sub, obj, act
[policy_effect]
e = some(where (p.eft == allow))
[matchers]
m = r.sub == p.sub && r.obj == p.obj && r.act == p.act
`)

beforeEach(async () => {
    await db.run(sql`
        create table if not exists casbin_rule (
            id integer primary key autoincrement,
            ptype text, v0 text, v1 text, v2 text, v3 text, v4 text, v5 text
        )`)
    await db.delete(casbinTable)
})

afterAll(() => {
    rmSync(directory, { recursive: true, force: true })
})

describe("sqlite", () => {
    it("round-trips a policy through save and load", async () => {
        const model = aclModel()
        model.addPolicy("p", "p", ["alice", "data1", "read"])
        model.addPolicy("p", "p", ["bob", "data2", "write"])
        await adapter.savePolicy(model)

        expect(await rows()).toEqual([
            ["p", "alice", "data1", "read", null, null, null],
            ["p", "bob", "data2", "write", null, null, null],
        ])

        const enforcer = await newEnforcer(aclModel(), adapter)
        expect(await enforcer.enforce("alice", "data1", "read")).toBe(true)
        expect(await enforcer.enforce("bob", "data1", "read")).toBe(false)
    })

    it("adds, updates and removes a single rule", async () => {
        await adapter.addPolicy("p", "p", ["alice", "data1", "read"])
        await adapter.addPolicy("p", "p", ["alice", "data1", "write"])

        await adapter.updatePolicy("p", "p", ["alice", "data1", "read"], ["alice", "data3"])
        expect(await rows()).toEqual([
            ["p", "alice", "data1", "write", null, null, null],
            ["p", "alice", "data3", null, null, null, null],
        ])

        await adapter.removePolicy("p", "p", ["alice", "data3"])
        expect(await rows()).toEqual([["p", "alice", "data1", "write", null, null, null]])
    })

    it("removes a filtered range without touching other ptypes", async () => {
        await adapter.addPolicy("p", "p", ["alice", "data1", "read"])
        await adapter.addPolicy("g", "g", ["alice", "admin"])

        await adapter.removeFilteredPolicy("p", "p", 0, "alice")

        expect(await rows()).toEqual([["g", "alice", "admin", null, null, null, null]])
    })
})
