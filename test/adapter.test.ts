import { Util, newEnforcer, type Enforcer } from "casbin"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { expect, test } from "vitest"
import { DrizzleAdapter } from "../src"
import { casbinRule } from "./table"

const array2DEqualsIgnoreOrder = (a: string[][], b: string[][]): boolean => {
    return Util.array2DEquals(a.sort(), b.sort())
}

const testGetPolicy = async (e: Enforcer, res: string[][]): Promise<void> => {
    const myRes = await e.getPolicy()
    expect(array2DEqualsIgnoreOrder(res, myRes)).toBe(true)
}

const testGetGroupingPolicy = async (e: Enforcer, res: string[][]): Promise<void> => {
    const myRes = await e.getGroupingPolicy()
    expect(array2DEqualsIgnoreOrder(res, myRes)).toBe(true)
}

test("TestAdapter", async () => {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    })
    const d = drizzle(pool, {
        schema: {
            casbinRule,
        },
    })

    const a = DrizzleAdapter.newAdapter(d, casbinRule)

    let e = await newEnforcer("examples/rbac_model.conf", "examples/rbac_policy.csv")

    await a.savePolicy(e.getModel())

    e.clearPolicy()
    await testGetPolicy(e, [])

    await a.loadPolicy(e.getModel())
    await testGetPolicy(e, [
        ["alice", "data1", "read"],
        ["bob", "data2", "write"],
        ["data2_admin", "data2", "read"],
        ["data2_admin", "data2", "write"],
    ])

    e = await newEnforcer("examples/rbac_model.conf", a)
    await testGetPolicy(e, [
        ["alice", "data1", "read"],
        ["bob", "data2", "write"],
        ["data2_admin", "data2", "read"],
        ["data2_admin", "data2", "write"],
    ])

    await a.addPolicy("", "p", ["role", "res", "action"])
    e = await newEnforcer("examples/rbac_model.conf", a)
    await testGetPolicy(e, [
        ["alice", "data1", "read"],
        ["bob", "data2", "write"],
        ["data2_admin", "data2", "read"],
        ["data2_admin", "data2", "write"],
        ["role", "res", "action"],
    ])

    await a.removePolicy("", "p", ["role", "res", "action"])
    e = await newEnforcer("examples/rbac_model.conf", a)
    await testGetPolicy(e, [
        ["alice", "data1", "read"],
        ["bob", "data2", "write"],
        ["data2_admin", "data2", "read"],
        ["data2_admin", "data2", "write"],
    ])

    await testGetGroupingPolicy(e, [["alice", "data2_admin"]])

    await e.deleteUser("alice")
    await testGetGroupingPolicy(e, [])
})
