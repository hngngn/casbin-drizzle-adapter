import { newEnforcer, newModel } from "casbin"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { DrizzleAdapter } from "../src"
import { pgCasbinTable } from "../src/table/pg"

// A table of its own so this file cannot race the others.
const casbinTable = pgCasbinTable("casbin_rule_interfaces")
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const db = drizzle(pool)
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

// The tenant lives inside the rule: v1 for `p`, v2 for `g`.
const domainModel = () =>
    newModel(`
[request_definition]
r = sub, dom, obj, act
[policy_definition]
p = sub, dom, obj, act
[role_definition]
g = _, _, _
[policy_effect]
e = some(where (p.eft == allow))
[matchers]
m = g(r.sub, p.sub, r.dom) && r.dom == p.dom && r.obj == p.obj && r.act == p.act
`)

const seedTenants = async () => {
    await adapter.addPolicies("p", "p", [
        ["admin", "tenant_a", "data1", "read"],
        ["admin", "tenant_b", "data2", "read"],
    ])
    await adapter.addPolicies("g", "g", [
        ["alice", "admin", "tenant_a"],
        ["bob", "admin", "tenant_b"],
    ])
}

beforeEach(async () => {
    await db.execute(sql`
        create table if not exists casbin_rule_interfaces (
            id serial primary key not null,
            ptype varchar(254), v0 varchar(254), v1 varchar(254),
            v2 varchar(254), v3 varchar(254), v4 varchar(254), v5 varchar(254)
        )`)
    await db.delete(casbinTable)
})

afterAll(async () => {
    await db.execute(sql`drop table if exists casbin_rule_interfaces`)
    await pool.end()
})

describe("addPolicies", () => {
    it("writes every rule in one transaction", async () => {
        await adapter.addPolicies("p", "p", [
            ["alice", "data1", "read"],
            ["bob", "data2", "write"],
        ])

        expect(await rows()).toEqual([
            ["p", "alice", "data1", "read", null, null, null],
            ["p", "bob", "data2", "write", null, null, null],
        ])
    })

    it("is a no-op on an empty batch", async () => {
        await adapter.addPolicy("p", "p", ["alice", "data1", "read"])
        await adapter.addPolicies("p", "p", [])

        expect(await rows()).toEqual([["p", "alice", "data1", "read", null, null, null]])
    })

    it("validates every rule before writing any of them", async () => {
        await expect(
            adapter.addPolicies("p", "p", [
                ["alice", "data1", "read"],
                ["1", "2", "3", "4", "5", "6", "7"],
            ]),
        ).rejects.toThrow(/stores at most 6/)

        expect(await rows()).toEqual([])
    })

    it("is reachable through the enforcer", async () => {
        const enforcer = await newEnforcer(aclModel(), adapter)

        await enforcer.addPolicies([
            ["alice", "data1", "read"],
            ["bob", "data2", "write"],
        ])

        expect(await rows()).toEqual([
            ["p", "alice", "data1", "read", null, null, null],
            ["p", "bob", "data2", "write", null, null, null],
        ])
    })
})

describe("removePolicies", () => {
    it("removes only the listed rules, matching every column", async () => {
        await adapter.addPolicies("p", "p", [
            ["alice", "data1", "read"],
            ["alice", "data2", "write"],
            ["bob", "data3", "read"],
        ])

        await adapter.removePolicies("p", "p", [
            ["alice", "data1", "read"],
            ["bob", "data3", "read"],
        ])

        expect(await rows()).toEqual([["p", "alice", "data2", "write", null, null, null]])
    })

    it("does not empty the table on an empty batch", async () => {
        await adapter.addPolicies("p", "p", [
            ["alice", "data1", "read"],
            ["bob", "data2", "write"],
        ])

        await adapter.removePolicies("p", "p", [])

        expect(await rows()).toEqual([
            ["p", "alice", "data1", "read", null, null, null],
            ["p", "bob", "data2", "write", null, null, null],
        ])
    })

    it("does not cross ptypes", async () => {
        await adapter.addPolicy("p", "p", ["alice", "admin"])
        await adapter.addPolicy("g", "g", ["alice", "admin"])

        await adapter.removePolicies("p", "p", [["alice", "admin"]])

        expect(await rows()).toEqual([["g", "alice", "admin", null, null, null, null]])
    })
})

describe("loadFilteredPolicy", () => {
    it("reads one tenant and leaves the rest in the table", async () => {
        await seedTenants()

        const model = domainModel()
        await adapter.loadFilteredPolicy(model, {
            p: ["", "tenant_a"],
            g: ["", "", "tenant_a"],
        })

        expect(model.model.get("p")?.get("p")?.policy).toEqual([
            ["admin", "tenant_a", "data1", "read"],
        ])
        expect(model.model.get("g")?.get("g")?.policy).toEqual([["alice", "admin", "tenant_a"]])
        expect(adapter.isFiltered()).toBe(true)
        // Nothing was deleted; the other tenant is still stored.
        expect((await rows()).length).toBe(4)
    })

    it("treats an empty string as a wildcard", async () => {
        await seedTenants()

        const model = domainModel()
        await adapter.loadFilteredPolicy(model, { p: ["admin", ""] })

        expect(model.model.get("p")?.get("p")?.policy).toEqual([
            ["admin", "tenant_a", "data1", "read"],
            ["admin", "tenant_b", "data2", "read"],
        ])
    })

    it("loads a ptype the filter does not name in full", async () => {
        await seedTenants()

        const model = domainModel()
        await adapter.loadFilteredPolicy(model, { p: ["", "tenant_a"] })

        expect(model.model.get("g")?.get("g")?.policy).toEqual([
            ["alice", "admin", "tenant_a"],
            ["bob", "admin", "tenant_b"],
        ])
    })

    it("enforces on the loaded tenant only", async () => {
        await seedTenants()

        const enforcer = await newEnforcer(domainModel(), adapter)
        await enforcer.loadFilteredPolicy({
            p: ["", "tenant_a"],
            g: ["", "", "tenant_a"],
        })

        expect(await enforcer.enforce("alice", "tenant_a", "data1", "read")).toBe(true)
        // Filtered out, so it reads as a deny rather than an error.
        expect(await enforcer.enforce("bob", "tenant_b", "data2", "read")).toBe(false)
    })

    it("refuses to save a filtered policy over the whole table", async () => {
        await seedTenants()

        const model = domainModel()
        await adapter.loadFilteredPolicy(model, { p: ["", "tenant_a"] })

        await expect(adapter.savePolicy(model)).rejects.toThrow(/Cannot save a filtered policy/)
        expect((await rows()).length).toBe(4)
    })

    it("is a full, unfiltered load when the filter constrains nothing", async () => {
        await seedTenants()

        const model = domainModel()
        await adapter.loadFilteredPolicy(model, {})

        expect(model.model.get("p")?.get("p")?.policy?.length).toBe(2)
        expect(adapter.isFiltered()).toBe(false)
        await expect(adapter.savePolicy(model)).resolves.toBe(true)
    })

    it("rejects a filter longer than the policy columns", async () => {
        await expect(
            adapter.loadFilteredPolicy(domainModel(), { p: ["1", "2", "3", "4", "5", "6", "7"] }),
        ).rejects.toThrow(/stores at most 6/)
    })
})
