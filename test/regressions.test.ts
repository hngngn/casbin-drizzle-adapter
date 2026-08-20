import { newEnforcer, newModel } from "casbin"
import { sql } from "drizzle-orm"
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import { pgTable, serial, varchar } from "drizzle-orm/pg-core"
import { Pool } from "pg"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { DrizzleAdapter, type TCasbinSchema } from "../src"

// A table of its own so this file cannot race test/adapter.test.ts.
const regressionTable = pgTable("casbin_rule_regression", {
    id: serial("id").primaryKey().notNull(),
    ptype: varchar("ptype", { length: 254 }),
    v0: varchar("v0", { length: 254 }),
    v1: varchar("v1", { length: 254 }),
    v2: varchar("v2", { length: 254 }),
    v3: varchar("v3", { length: 254 }),
    v4: varchar("v4", { length: 254 }),
    v5: varchar("v5", { length: 254 }),
})

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
// Deliberately created without a `schema` option: loadPolicy must not depend on
// the relational-query builder, nor on the table being keyed as `casbinTable`.
const db = drizzle(pool)
const adapter = DrizzleAdapter.newAdapter(db, regressionTable)

/** Every stored row as [ptype, v0..v5], with unused columns kept visible as null. */
const rows = async (): Promise<(string | null)[][]> => {
    const found = await db.select().from(regressionTable)
    return found
        .map((r) => [r.ptype, r.v0, r.v1, r.v2, r.v3, r.v4, r.v5])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

const rbacModel = () =>
    newModel(`
[request_definition]
r = sub, obj, act
[policy_definition]
p = sub, obj, act
[role_definition]
g = _, _
[policy_effect]
e = some(where (p.eft == allow))
[matchers]
m = g(r.sub, p.sub) && r.obj == p.obj && r.act == p.act
`)

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
    await db.execute(sql`
        create table if not exists casbin_rule_regression (
            id serial primary key not null,
            ptype varchar(254), v0 varchar(254), v1 varchar(254),
            v2 varchar(254), v3 varchar(254), v4 varchar(254), v5 varchar(254)
        )`)
    await db.delete(regressionTable)
})

afterAll(async () => {
    await db.execute(sql`drop table if exists casbin_rule_regression`)
    await pool.end()
})

describe("removePolicy", () => {
    it("matches the whole rule, not just v0, and does not cross ptypes", async () => {
        const model = rbacModel()
        model.addPolicy("p", "p", ["alice", "data1", "read"])
        model.addPolicy("p", "p", ["alice", "data2", "write"])
        model.addPolicy("g", "g", ["alice", "data2_admin"])
        await adapter.savePolicy(model)

        await adapter.removePolicy("p", "p", ["alice", "data1", "read"])

        expect(await rows()).toEqual([
            ["g", "alice", "data2_admin", null, null, null, null],
            ["p", "alice", "data2", "write", null, null, null],
        ])
    })

    it("does not remove a longer rule that shares the shorter rule's prefix", async () => {
        const model = rbacModel()
        model.addPolicy("p", "p", ["alice", "data1", "read"])
        model.addPolicy("p", "p", ["alice", "data1", "read", "extra"])
        await adapter.savePolicy(model)

        await adapter.removePolicy("p", "p", ["alice", "data1", "read"])

        expect(await rows()).toEqual([["p", "alice", "data1", "read", "extra", null, null]])
    })
})

describe("updatePolicy", () => {
    it("updates only the matching rule", async () => {
        const model = rbacModel()
        model.addPolicy("p", "p", ["alice", "data1", "read"])
        model.addPolicy("p", "p", ["alice", "data2", "write"])
        model.addPolicy("g", "g", ["alice", "data2_admin"])
        await adapter.savePolicy(model)

        await adapter.updatePolicy("p", "p", ["alice", "data1", "read"], ["bob", "data9", "list"])

        expect(await rows()).toEqual([
            ["g", "alice", "data2_admin", null, null, null, null],
            ["p", "alice", "data2", "write", null, null, null],
            ["p", "bob", "data9", "list", null, null, null],
        ])
    })

    it("clears columns the new rule no longer uses", async () => {
        const model = rbacModel()
        model.addPolicy("p", "p", ["alice", "data1", "read", "extra"])
        await adapter.savePolicy(model)

        await adapter.updatePolicy(
            "p",
            "p",
            ["alice", "data1", "read", "extra"],
            ["alice", "data1", "read"],
        )

        expect(await rows()).toEqual([["p", "alice", "data1", "read", null, null, null]])
    })
})

describe("removeFilteredPolicy", () => {
    it("is scoped to the given ptype", async () => {
        const model = rbacModel()
        model.addPolicy("p", "p", ["alice", "data1", "read"])
        model.addPolicy("g", "g", ["alice", "data2_admin"])
        await adapter.savePolicy(model)

        await adapter.removeFilteredPolicy("g", "g", 0, "alice")

        expect(await rows()).toEqual([["p", "alice", "data1", "read", null, null, null]])
    })

    it("treats an empty string as a wildcard", async () => {
        const model = rbacModel()
        model.addPolicy("p", "p", ["alice", "data1", "read"])
        model.addPolicy("p", "p", ["alice", "data2", "read"])
        model.addPolicy("p", "p", ["alice", "data1", "write"])
        await adapter.savePolicy(model)

        // "any object, action = read"
        await adapter.removeFilteredPolicy("p", "p", 0, "alice", "", "read")

        expect(await rows()).toEqual([["p", "alice", "data1", "write", null, null, null]])
    })

    it("rejects a field range that runs past the policy columns", async () => {
        await expect(adapter.removeFilteredPolicy("p", "p", 4, "a", "b", "c")).rejects.toThrow(
            /runs past the 6 policy columns/,
        )
        await expect(adapter.removeFilteredPolicy("p", "p", 6, "a")).rejects.toThrow(
            /between 0 and 5/,
        )
    })
})

describe("savePolicy", () => {
    it("works on a model with no [role_definition] section", async () => {
        const model = aclModel()
        model.addPolicy("p", "p", ["alice", "data1", "read"])

        await expect(adapter.savePolicy(model)).resolves.toBe(true)
        expect(await rows()).toEqual([["p", "alice", "data1", "read", null, null, null]])
    })

    it("leaves existing policy intact when a rule is invalid", async () => {
        const seed = rbacModel()
        seed.addPolicy("p", "p", ["alice", "data1", "read"])
        await adapter.savePolicy(seed)

        const model = newModel(`
[request_definition]
r = sub, obj, act, a, b, c, d
[policy_definition]
p = sub, obj, act, a, b, c, d
[policy_effect]
e = some(where (p.eft == allow))
[matchers]
m = r.sub == p.sub
`)
        model.addPolicy("p", "p", ["1", "2", "3", "4", "5", "6", "7"])

        await expect(adapter.savePolicy(model)).rejects.toThrow(/stores at most 6/)
        // The table was never truncated.
        expect(await rows()).toEqual([["p", "alice", "data1", "read", null, null, null]])
    })
})

describe("loadPolicy", () => {
    it("preserves empty-string values in the middle of a rule", async () => {
        const model = rbacModel()
        model.addPolicy("p", "p", ["alice", "", "read"])
        await adapter.savePolicy(model)

        const loaded = rbacModel()
        await adapter.loadPolicy(loaded)

        expect(loaded.model.get("p")!.get("p")!.policy).toEqual([["alice", "", "read"]])
    })

    it("preserves values containing commas and quotes", async () => {
        const model = rbacModel()
        model.addPolicy("p", "p", ["alice", 'doc,"secret"', "read"])
        await adapter.savePolicy(model)

        const loaded = rbacModel()
        await adapter.loadPolicy(loaded)

        expect(loaded.model.get("p")!.get("p")!.policy).toEqual([["alice", 'doc,"secret"', "read"]])
    })

    it("skips rows whose ptype the model does not declare", async () => {
        await db.insert(regressionTable).values([
            { ptype: "p", v0: "alice", v1: "data1", v2: "read" },
            { ptype: "p2", v0: "who", v1: "knows" },
        ])

        const loaded = rbacModel()
        await adapter.loadPolicy(loaded)

        expect(loaded.model.get("p")!.get("p")!.policy).toEqual([["alice", "data1", "read"]])
    })

    it("round-trips through an enforcer", async () => {
        const model = rbacModel()
        model.addPolicy("p", "p", ["data2_admin", "data2", "read"])
        model.addPolicy("g", "g", ["alice", "data2_admin"])
        await adapter.savePolicy(model)

        const e = await newEnforcer(rbacModel(), adapter)
        expect(await e.enforce("alice", "data2", "read")).toBe(true)
        expect(await e.enforce("bob", "data2", "read")).toBe(false)
    })
})

describe("addPolicy", () => {
    it("rejects a rule longer than the table can store", async () => {
        await expect(
            adapter.addPolicy("p", "p", ["1", "2", "3", "4", "5", "6", "7"]),
        ).rejects.toThrow(/stores at most 6/)
        expect(await rows()).toEqual([])
    })
})

describe("constructor", () => {
    it("rejects a table missing casbin columns", () => {
        const bad = pgTable("bad_table", { id: serial("id").primaryKey() })
        // The type rejects this table too; the runtime guard is what catches a
        // JavaScript caller, and a caller who has cast the type away.
        // @ts-expect-error -- table is missing ptype and v0..v5
        expect(() => DrizzleAdapter.newAdapter(db, bad)).toThrow(
            /"bad_table" is missing the casbin column\(s\): ptype, v0, v1, v2, v3, v4, v5/,
        )
    })
})

// Type-level regression: a NOT NULL policy column cannot round-trip a short
// rule, so the schema type has to reject it before any query runs.
const notNullTable = pgTable("not_null_table", {
    ptype: varchar("ptype", { length: 254 }),
    v0: varchar("v0", { length: 254 }).notNull(),
    v1: varchar("v1", { length: 254 }),
    v2: varchar("v2", { length: 254 }),
    v3: varchar("v3", { length: 254 }),
    v4: varchar("v4", { length: 254 }),
    v5: varchar("v5", { length: 254 }),
})
// @ts-expect-error -- v0 is NOT NULL
const _rejectsNotNullColumns: TCasbinSchema = notNullTable
void _rejectsNotNullColumns

describe("error categorization", () => {
    const stubAdapter = (thrown: unknown) => {
        const stub = {
            select: () => ({
                from: () => Promise.reject(thrown),
            }),
        }
        return DrizzleAdapter.newAdapter(
            stub as unknown as NodePgDatabase<Record<string, never>>,
            regressionTable,
        )
    }

    const failureFor = async (thrown: unknown) => {
        try {
            await stubAdapter(thrown).loadPolicy(rbacModel())
        } catch (error) {
            return error as Error
        }
        throw new Error("expected loadPolicy to reject")
    }

    it("classifies a lock wait timeout as a lock error, not a connection error", async () => {
        const error = await failureFor(
            Object.assign(new Error("Lock wait timeout exceeded; try restarting transaction"), {
                errno: 1205,
            }),
        )
        expect(error.message).toMatch(/Database lock error/)
        expect(error.message).not.toMatch(/Failed to connect/)
    })

    it("classifies a lock wait timeout by message when no code is present", async () => {
        const error = await failureFor(
            new Error("Lock wait timeout exceeded; try restarting transaction"),
        )
        expect(error.message).toMatch(/Database lock error/)
    })

    it("prefers the SQLSTATE over words that appear in policy values", async () => {
        const error = await failureFor(
            Object.assign(
                new Error(`duplicate key value violates unique constraint "password_idx"`),
                { code: "23505" },
            ),
        )
        expect(error.message).toMatch(/Database constraint violation/)
        expect(error.message).not.toMatch(/permission/)
    })

    it("classifies a missing relation as a schema error", async () => {
        const error = await failureFor(
            Object.assign(new Error(`relation "casbin_rule" does not exist`), { code: "42P01" }),
        )
        expect(error.message).toMatch(/Database schema error/)
    })

    it("attaches the original error as cause", async () => {
        const original = Object.assign(new Error("connection refused"), {
            code: "ECONNREFUSED",
        })
        const error = await failureFor(original)
        expect(error.message).toMatch(/Failed to connect to database/)
        expect(error.cause).toBe(original)
    })
})
