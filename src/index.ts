import type { Model, UpdatableAdapter } from "casbin"
import { Helper } from "casbin"
import { eq } from "drizzle-orm"
import type { MySqlTable, TableConfig as MySqlTableConfig } from "drizzle-orm/mysql-core"
import type { MySql2Database } from "drizzle-orm/mysql2"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type { PgTable, TableConfig as PgTableConfig } from "drizzle-orm/pg-core"
import type { SQLiteTable, TableConfig as SQLiteTableConfig } from "drizzle-orm/sqlite-core"
import type { TCasinTable, TCasinTableCreateInput } from "./types"

export class DrizzleAdapter<
    T extends NodePgDatabase<TSchema> | MySql2Database<TSchema>,
    TSchema extends Record<string, unknown>,
> implements UpdatableAdapter {
    #db: T
    #schema: PgTable<PgTableConfig> | MySqlTable<MySqlTableConfig> | SQLiteTable<SQLiteTableConfig>

    constructor(
        db: T,
        schema:
            | PgTable<PgTableConfig>
            | MySqlTable<MySqlTableConfig>
            | SQLiteTable<SQLiteTableConfig>,
    ) {
        if (!db) {
            throw new Error("Database instance is required")
        }
        if (!schema) {
            throw new Error("Schema is required")
        }
        this.#db = db
        this.#schema = schema
    }

    static newAdapter<
        T extends NodePgDatabase<TSchema> | MySql2Database<TSchema>,
        TSchema extends Record<string, unknown>,
    >(
        db: T,
        schema:
            | PgTable<PgTableConfig>
            | MySqlTable<MySqlTableConfig>
            | SQLiteTable<SQLiteTableConfig>,
    ) {
        return new DrizzleAdapter(db, schema)
    }

    #categorizeError = (error: unknown, operation: string): Error => {
        const errorMessage = error instanceof Error ? error.message : String(error)
        const lowerMessage = errorMessage.toLowerCase()

        // Connection errors
        if (
            lowerMessage.includes("connect") ||
            lowerMessage.includes("econnrefused") ||
            lowerMessage.includes("enotfound") ||
            lowerMessage.includes("timeout") ||
            lowerMessage.includes("etimedout") ||
            lowerMessage.includes("network") ||
            lowerMessage.includes("enetunreach") ||
            lowerMessage.includes("ehostunreach")
        ) {
            return new Error(
                `Failed to connect to database while ${operation}: ${errorMessage}. Please ensure your database is running and accessible.`
            )
        }

        // Permission/authentication errors
        if (
            lowerMessage.includes("permission") ||
            lowerMessage.includes("eacces") ||
            lowerMessage.includes("access denied") ||
            lowerMessage.includes("authentication") ||
            lowerMessage.includes("password") ||
            lowerMessage.includes("unauthorized") ||
            lowerMessage.includes("insufficient privilege")
        ) {
            return new Error(
                `Database permission error while ${operation}: ${errorMessage}. Please check your database credentials and permissions.`
            )
        }

        // Constraint violations
        if (
            lowerMessage.includes("unique") ||
            lowerMessage.includes("duplicate") ||
            lowerMessage.includes("constraint") ||
            lowerMessage.includes("foreign key") ||
            lowerMessage.includes("violates") ||
            lowerMessage.includes("check constraint")
        ) {
            return new Error(
                `Database constraint violation while ${operation}: ${errorMessage}. The operation conflicts with database constraints.`
            )
        }

        // Deadlock/lock timeout
        if (
            lowerMessage.includes("deadlock") ||
            lowerMessage.includes("lock timeout") ||
            lowerMessage.includes("lock wait timeout")
        ) {
            return new Error(
                `Database lock error while ${operation}: ${errorMessage}. Please retry the operation.`
            )
        }

        // Disk/space errors
        if (
            lowerMessage.includes("disk") ||
            lowerMessage.includes("space") ||
            lowerMessage.includes("enospc") ||
            lowerMessage.includes("no space left")
        ) {
            return new Error(
                `Database storage error while ${operation}: ${errorMessage}. The database may be out of disk space.`
            )
        }

        // Data truncation/overflow
        if (
            lowerMessage.includes("too long") ||
            lowerMessage.includes("truncated") ||
            lowerMessage.includes("value too large") ||
            lowerMessage.includes("string data right truncation")
        ) {
            return new Error(
                `Data validation error while ${operation}: ${errorMessage}. Data exceeds allowed size limits.`
            )
        }

        // Schema/table errors
        if (
            lowerMessage.includes("casbintable") ||
            lowerMessage.includes("relation") ||
            lowerMessage.includes("does not exist") ||
            lowerMessage.includes("no such table") ||
            lowerMessage.includes("unknown column") ||
            lowerMessage.includes("unknown table")
        ) {
            return new Error(
                `Database schema error while ${operation}: ${errorMessage}. Please ensure:\n` +
                `1. The schema object passed to DrizzleAdapter has a property named 'casbinTable'\n` +
                `2. The table exists in your database\n` +
                `3. You have run your database migrations`
            )
        }

        // Generic error with context
        return new Error(`Failed to ${operation}: ${errorMessage}`)
    }

    #loadPolicyLine = (line: TCasinTable, model: Model): void => {
        if (!line.ptype) {
            throw new Error(`Invalid policy line: ptype is required but got ${line.ptype}`)
        }
        const result =
            line.ptype +
            ", " +
            [line.v0, line.v1, line.v2, line.v3, line.v4, line.v5].filter((n) => n).join(", ")
        Helper.loadPolicyLine(result, model)
    }

    async loadPolicy(model: Model): Promise<void> {
        if (!model) {
            throw new Error("Model is required for loading policy")
        }

        let lines: TCasinTable[]
        try {
            // @ts-expect-error
            lines = await this.#db.query.casbinTable.findMany()
        } catch (error) {
            throw this.#categorizeError(error, "loading policy from database")
        }

        try {
            for (const line of lines) {
                this.#loadPolicyLine(line, model)
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            throw new Error(`Failed to parse policy data: ${errorMessage}`)
        }
    }

    #savePolicyLine = (ptype: string, rule: string[]) => {
        const line: TCasinTableCreateInput = { ptype }

        if (rule.length > 0) {
            line.v0 = rule[0]
        }
        if (rule.length > 1) {
            line.v1 = rule[1]
        }
        if (rule.length > 2) {
            line.v2 = rule[2]
        }
        if (rule.length > 3) {
            line.v3 = rule[3]
        }
        if (rule.length > 4) {
            line.v4 = rule[4]
        }
        if (rule.length > 5) {
            line.v5 = rule[5]
        }

        return line
    }

    async savePolicy(model: Model): Promise<boolean> {
        if (!model) {
            throw new Error("Model is required for saving policy")
        }

        try {
            // @ts-expect-error - Use schema to get table name instead of hardcoding
            await this.#db.delete(this.#schema)
        } catch (error) {
            throw this.#categorizeError(error, "clearing existing policy data")
        }

        try {
            let astMap = model.model.get("p")!
            for (const [ptype, ast] of astMap) {
                for (const rule of ast.policy) {
                    const line = this.#savePolicyLine(ptype, rule)
                    // @ts-expect-error
                    await this.#db.insert(this.#schema).values(line)
                }
            }

            astMap = model.model.get("g")!
            for (const [ptype, ast] of astMap) {
                for (const rule of ast.policy) {
                    const line = this.#savePolicyLine(ptype, rule)
                    // @ts-expect-error
                    await this.#db.insert(this.#schema).values(line)
                }
            }

            return true
        } catch (error) {
            throw this.#categorizeError(error, "saving policy to database")
        }
    }

    async addPolicy(sec: string, ptype: string, rule: string[]): Promise<void> {
        if (!ptype) {
            throw new Error("Policy type (ptype) is required")
        }
        if (!Array.isArray(rule)) {
            throw new Error("Rule must be an array")
        }

        try {
            const line = this.#savePolicyLine(ptype, rule)
            // @ts-expect-error
            await this.#db.insert(this.#schema).values(line)
        } catch (error) {
            throw this.#categorizeError(error, "adding policy")
        }
    }

    async removePolicy(sec: string, ptype: string, rule: string[]): Promise<void> {
        if (!ptype) {
            throw new Error("Policy type (ptype) is required")
        }
        if (!Array.isArray(rule)) {
            throw new Error("Rule must be an array")
        }

        try {
            const line = this.#savePolicyLine(ptype, rule)

            await this.#db
                // @ts-expect-error
                .delete(this.#schema)
                .where(
                    // @ts-expect-error
                    eq(this.#schema.v0, line.v0),
                    // @ts-expect-error
                    eq(this.#schema.v1, line.v1),
                    // @ts-expect-error
                    eq(this.#schema.v2, line.v2),
                    // @ts-expect-error
                    eq(this.#schema.v3, line.v3),
                    // @ts-expect-error
                    eq(this.#schema.v4, line.v4),
                    // @ts-expect-error
                    eq(this.#schema.v5, line.v5),
                )
        } catch (error) {
            throw this.#categorizeError(error, "removing policy")
        }
    }

    async removeFilteredPolicy(
        sec: string,
        ptype: string,
        fieldIndex: number,
        ...fieldValues: string[]
    ): Promise<void> {
        if (!ptype) {
            throw new Error("Policy type (ptype) is required")
        }
        if (fieldIndex < 0 || fieldIndex > 5) {
            throw new Error(`Field index must be between 0 and 5, got ${fieldIndex}`)
        }

        try {
            const line: TCasinTableCreateInput = { ptype }

            const idx = fieldIndex + fieldValues.length
            if (fieldIndex <= 0 && 0 < idx) {
                line.v0 = fieldValues[0 - fieldIndex]
            }
            if (fieldIndex <= 1 && 1 < idx) {
                line.v1 = fieldValues[1 - fieldIndex]
            }
            if (fieldIndex <= 2 && 2 < idx) {
                line.v2 = fieldValues[2 - fieldIndex]
            }
            if (fieldIndex <= 3 && 3 < idx) {
                line.v3 = fieldValues[3 - fieldIndex]
            }
            if (fieldIndex <= 4 && 4 < idx) {
                line.v4 = fieldValues[4 - fieldIndex]
            }
            if (fieldIndex <= 5 && 5 < idx) {
                line.v5 = fieldValues[5 - fieldIndex]
            }

            await this.#db
                // @ts-expect-error
                .delete(this.#schema)
                .where(
                    // @ts-expect-error
                    eq(this.#schema.v0, line.v0),
                    // @ts-expect-error
                    eq(this.#schema.v1, line.v1),
                    // @ts-expect-error
                    eq(this.#schema.v2, line.v2),
                    // @ts-expect-error
                    eq(this.#schema.v3, line.v3),
                    // @ts-expect-error
                    eq(this.#schema.v4, line.v4),
                    // @ts-expect-error
                    eq(this.#schema.v5, line.v5),
                )
        } catch (error) {
            throw this.#categorizeError(error, "removing filtered policy")
        }
    }

    async updatePolicy(
        sec: string,
        ptype: string,
        oldRule: string[],
        newRule: string[],
    ): Promise<void> {
        if (!ptype) {
            throw new Error("Policy type (ptype) is required")
        }
        if (!Array.isArray(oldRule)) {
            throw new Error("Old rule must be an array")
        }
        if (!Array.isArray(newRule)) {
            throw new Error("New rule must be an array")
        }

        try {
            const oldLine = this.#savePolicyLine(ptype, oldRule)
            const newLine = this.#savePolicyLine(ptype, newRule)

            await this.#db
                // @ts-expect-error
                .update(this.#schema)
                .set(newLine)
                .where(
                    // @ts-expect-error
                    eq(this.#schema.v0, oldLine.v0),
                    // @ts-expect-error
                    eq(this.#schema.v1, oldLine.v1),
                    // @ts-expect-error
                    eq(this.#schema.v2, oldLine.v2),
                    // @ts-expect-error
                    eq(this.#schema.v3, oldLine.v3),
                    // @ts-expect-error
                    eq(this.#schema.v4, oldLine.v4),
                    // @ts-expect-error
                    eq(this.#schema.v5, oldLine.v5),
                )
        } catch (error) {
            throw this.#categorizeError(error, "updating policy")
        }
    }
}
