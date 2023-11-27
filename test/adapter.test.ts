import { Util, newEnforcer, type Enforcer } from "casbin"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { describe, expect, it } from "vitest"
import { DrizzleAdapter } from "../src"
import { casbinTable } from "./table"

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

describe("TestAdapter", async () => {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    })
    const d = drizzle(pool, {
        schema: {
            casbinTable,
        },
    })

    const a = DrizzleAdapter.newAdapter(d, casbinTable)

    let e = await newEnforcer("examples/rbac_model.conf", "examples/rbac_policy.csv")

    await a.savePolicy(e.getModel())

    it("Should clear the current policy", async () => {
        e.clearPolicy()
        await testGetPolicy(e, [])
    })

    it("Should load policy from database", async () => {
        await a.loadPolicy(e.getModel())
        await testGetPolicy(e, [
            ["alice", "data1", "read"],
            ["bob", "data2", "write"],
            ["data2_admin", "data2", "read"],
            ["data2_admin", "data2", "write"],
        ])
    })

    it("Should load the policy", async () => {
        e = await newEnforcer("examples/rbac_model.conf", a)
        await testGetPolicy(e, [
            ["alice", "data1", "read"],
            ["bob", "data2", "write"],
            ["data2_admin", "data2", "read"],
            ["data2_admin", "data2", "write"],
        ])
    })

    it("Should add policy to database", async () => {
        await a.addPolicy("", "p", ["role", "res", "action"])
        e = await newEnforcer("examples/rbac_model.conf", a)
        await testGetPolicy(e, [
            ["alice", "data1", "read"],
            ["bob", "data2", "write"],
            ["data2_admin", "data2", "read"],
            ["data2_admin", "data2", "write"],
            ["role", "res", "action"],
        ])
    })

    it("Should update policy", async () => {
        await a.updatePolicy("", "p", ["role", "res", "action"], ["role", "res", "new_action"])
        e = await newEnforcer("examples/rbac_model.conf", a)
        await testGetPolicy(e, [
            ["alice", "data1", "read"],
            ["bob", "data2", "write"],
            ["data2_admin", "data2", "read"],
            ["data2_admin", "data2", "write"],
            ["role", "res", "new_action"],
        ])
    })

    it("Should remove policy", async () => {
        await a.removePolicy("", "p", ["role", "res", "new_action"])
        e = await newEnforcer("examples/rbac_model.conf", a)
        await testGetPolicy(e, [
            ["alice", "data1", "read"],
            ["bob", "data2", "write"],
            ["data2_admin", "data2", "read"],
            ["data2_admin", "data2", "write"],
        ])
    })

    it("Should load group policy from database", async () => {
        await testGetGroupingPolicy(e, [
            ["alice", "data2_admin"],
            ["bob", "data1_admin"],
        ])
    })

    it("Should update group policy", async () => {
        await e.updateGroupingPolicy(["alice", "data2_admin"], ["alice", "data1_admin"])
        await testGetGroupingPolicy(e, [
            ["alice", "data1_admin"],
            ["bob", "data1_admin"],
        ])
    })

    it("Should remove group policy", async () => {
        await e.deleteUser("alice")
        await testGetGroupingPolicy(e, [["bob", "data1_admin"]])
    })
})
