import { newEnforcer, newModel } from "casbin"
import { sql } from "drizzle-orm"
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2"
import { createPool, type Pool } from "mysql2/promise"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { DrizzleAdapter } from "../src"
import { mysqlCasbinTable } from "../src/table/mysql"

// MySQL needs a server, so this file runs only when one is pointed at. CI
// starts one; locally, set MYSQL_URL to run these.
const url = process.env.MYSQL_URL
const casbinTable = mysqlCasbinTable("casbin_rule")

let pool: Pool
let db: MySql2Database<Record<string, never>>
let adapter: DrizzleAdapter<MySql2Database<Record<string, never>>, Record<string, never>>

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

describe.skipIf(!url)("mysql", () => {
    beforeEach(async () => {
        pool ??= createPool(url as string)
        db ??= drizzle(pool)
        adapter ??= DrizzleAdapter.newAdapter(db, casbinTable)

        await db.execute(sql`
            create table if not exists casbin_rule (
                id int auto_increment primary key,
                ptype varchar(254), v0 varchar(254), v1 varchar(254),
                v2 varchar(254), v3 varchar(254), v4 varchar(254), v5 varchar(254)
            )`)
        await db.delete(casbinTable)
    })

    afterAll(async () => {
        await pool?.end()
    })

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
