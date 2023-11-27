import type { Model, UpdatableAdapter } from "casbin"
import { Helper } from "casbin"
import { eq, sql } from "drizzle-orm"
import type { MySqlTable, TableConfig as MySqlTableConfig } from "drizzle-orm/mysql-core"
import type { MySql2Database } from "drizzle-orm/mysql2"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type { PgTable, TableConfig as PgTableConfig } from "drizzle-orm/pg-core"
import type { SQLiteTable, TableConfig as SQLiteTableConfig } from "drizzle-orm/sqlite-core"
import type { TCasinTable, TCasinTableCreateInput } from "./types"

export class DrizzleAdapter<
    T extends NodePgDatabase<TSchema> | MySql2Database<TSchema>,
    TSchema extends Record<string, unknown>,
> implements UpdatableAdapter
{
    #db: T
    #schema: PgTable<PgTableConfig> | MySqlTable<MySqlTableConfig> | SQLiteTable<SQLiteTableConfig>

    constructor(
        db: T,
        schema:
            | PgTable<PgTableConfig>
            | MySqlTable<MySqlTableConfig>
            | SQLiteTable<SQLiteTableConfig>,
    ) {
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

    #loadPolicyLine = (line: TCasinTable, model: Model): void => {
        const result =
            line.ptype +
            ", " +
            [line.v0, line.v1, line.v2, line.v3, line.v4, line.v5].filter((n) => n).join(", ")
        Helper.loadPolicyLine(result, model)
    }

    async loadPolicy(model: Model): Promise<void> {
        let lines: TCasinTable[]
        try {
            // @ts-expect-error
            lines = await this.#db.query.casbinTable.findMany()

            for (const line of lines) {
                this.#loadPolicyLine(line, model)
            }
        } catch (error) {
            throw new Error("table must named 'casbinTable'")
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
        // @ts-expect-error
        await this.#db.execute(sql`DELETE FROM casbin_rule;`)

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
    }

    async addPolicy(sec: string, ptype: string, rule: string[]): Promise<void> {
        const line = this.#savePolicyLine(ptype, rule)
        // @ts-expect-error
        await this.#db.insert(this.#schema).values(line)
    }

    async removePolicy(sec: string, ptype: string, rule: string[]): Promise<void> {
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
    }

    async removeFilteredPolicy(
        sec: string,
        ptype: string,
        fieldIndex: number,
        ...fieldValues: string[]
    ): Promise<void> {
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
    }

    async updatePolicy(
        sec: string,
        ptype: string,
        oldRule: string[],
        newRule: string[],
    ): Promise<void> {
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
    }
}
