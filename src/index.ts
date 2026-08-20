import type { Model, UpdatableAdapter } from "casbin"
import type { Column, SQL } from "drizzle-orm"
import { and, eq, getTableColumns, getTableName, isNull } from "drizzle-orm"
import type { MySqlTable, TableConfig as MySqlTableConfig } from "drizzle-orm/mysql-core"
import type { MySql2Database } from "drizzle-orm/mysql2"
import type { NodePgDatabase } from "drizzle-orm/node-postgres"
import type { PgTable, TableConfig as PgTableConfig } from "drizzle-orm/pg-core"
import type {
    BaseSQLiteDatabase,
    SQLiteTable,
    TableConfig as SQLiteTableConfig,
} from "drizzle-orm/sqlite-core"
import type { TCasinTable, TCasinTableCreateInput } from "./types"

/** The policy value columns, in order. A rule may not be longer than this. */
const POLICY_COLUMNS = ["v0", "v1", "v2", "v3", "v4", "v5"] as const

/** Every column the adapter reads or writes. */
const REQUIRED_COLUMNS = ["ptype", ...POLICY_COLUMNS] as const

/** Postgres caps a statement at 65535 bind parameters; stay well inside it. */
const INSERT_CHUNK_SIZE = 1000

export type TCasbinSchema =
    PgTable<PgTableConfig> | MySqlTable<MySqlTableConfig> | SQLiteTable<SQLiteTableConfig>

/**
 * SQLite is only supported through drivers with asynchronous transactions
 * (libsql, D1, ...). `better-sqlite3` runs transaction callbacks synchronously
 * and would not await this adapter's writes.
 */
export type TCasbinDatabase<TSchema extends Record<string, unknown>> =
    | NodePgDatabase<TSchema>
    | MySql2Database<TSchema>
    | BaseSQLiteDatabase<"async", unknown, TSchema>

/**
 * The adapter issues the same four statements against Postgres, MySQL and
 * SQLite. Their builders are structurally identical for our purposes, but a
 * union of the three database types has no call signature of its own, so we
 * narrow once to the shape we actually use rather than scattering
 * `@ts-expect-error` over every call site. The constructor verifies at runtime
 * that the table really has the columns this shape assumes.
 */
type TQueryRunner = {
    select(): { from(table: TCasbinSchema): PromiseLike<TCasinTable[]> }
    insert(table: TCasbinSchema): { values(values: TCasinTableCreateInput[]): PromiseLike<unknown> }
    update(table: TCasbinSchema): {
        set(values: TCasinTableCreateInput): { where(where: SQL | undefined): PromiseLike<unknown> }
    }
    delete(table: TCasbinSchema): PromiseLike<unknown> & {
        where(where: SQL | undefined): PromiseLike<unknown>
    }
    transaction<TResult>(fn: (tx: TQueryRunner) => Promise<TResult>): Promise<TResult>
}

export class DrizzleAdapter<
    T extends TCasbinDatabase<TSchema>,
    TSchema extends Record<string, unknown>,
> implements UpdatableAdapter {
    #db: TQueryRunner
    #schema: TCasbinSchema
    #columns: Record<string, Column>

    constructor(db: T, schema: TCasbinSchema) {
        if (!db) {
            throw new Error("Database instance is required")
        }
        if (!schema) {
            throw new Error("Schema is required")
        }

        const columns: Record<string, Column> = getTableColumns(schema as PgTable<PgTableConfig>)
        const missing = REQUIRED_COLUMNS.filter((name) => !columns[name])
        if (missing.length > 0) {
            throw new Error(
                `Table "${getTableName(schema as PgTable<PgTableConfig>)}" is missing the casbin ` +
                    `column(s): ${missing.join(", ")}. The table must define ` +
                    `${REQUIRED_COLUMNS.join(", ")}.`,
            )
        }

        this.#db = db as unknown as TQueryRunner
        this.#schema = schema
        this.#columns = columns
    }

    static newAdapter<T extends TCasbinDatabase<TSchema>, TSchema extends Record<string, unknown>>(
        db: T,
        schema: TCasbinSchema,
    ) {
        return new DrizzleAdapter(db, schema)
    }

    #column = (name: string): Column => {
        const column = this.#columns[name]
        if (!column) {
            // Unreachable: the constructor rejects tables missing these columns.
            throw new Error(`Column "${name}" is not defined on the casbin table`)
        }
        return column
    }

    #categorizeError = (error: unknown, operation: string): Error => {
        const errorMessage = error instanceof Error ? error.message : String(error)
        const context = `while ${operation}: ${errorMessage}`

        switch (this.#classifyError(error, errorMessage)) {
            case "connection":
                return new Error(
                    `Failed to connect to database ${context}. Please ensure your database is running and accessible.`,
                    { cause: error },
                )
            case "permission":
                return new Error(
                    `Database permission error ${context}. Please check your database credentials and permissions.`,
                    { cause: error },
                )
            case "constraint":
                return new Error(
                    `Database constraint violation ${context}. The operation conflicts with database constraints.`,
                    { cause: error },
                )
            case "lock":
                return new Error(`Database lock error ${context}. Please retry the operation.`, {
                    cause: error,
                })
            case "storage":
                return new Error(
                    `Database storage error ${context}. The database may be out of disk space.`,
                    { cause: error },
                )
            case "data":
                return new Error(
                    `Data validation error ${context}. Data exceeds allowed size limits.`,
                    { cause: error },
                )
            case "schema":
                return new Error(
                    `Database schema error ${context}. Please ensure:\n` +
                        `1. The table passed to DrizzleAdapter matches the table in your database\n` +
                        `2. The table exists in your database\n` +
                        `3. You have run your database migrations`,
                    { cause: error },
                )
            default:
                return new Error(`Failed ${context}`, { cause: error })
        }
    }

    /**
     * Drivers report the real cause in `error.code` (a Postgres SQLSTATE or a
     * Node `errno` string) or `error.errno` (MySQL). Those are checked first
     * because substring matching on the message is easily fooled — the message
     * embeds policy values, and generic needles like "timeout" would otherwise
     * shadow more specific categories.
     */
    #classifyError = (error: unknown, errorMessage: string): string | undefined => {
        const { code, errno } = (error ?? {}) as { code?: unknown; errno?: unknown }

        if (typeof code === "string" && code.length > 0) {
            // Node socket-level failures surface before the driver sees a response.
            if (
                [
                    "ECONNREFUSED",
                    "ECONNRESET",
                    "ENOTFOUND",
                    "ETIMEDOUT",
                    "EPIPE",
                    "EHOSTUNREACH",
                    "ENETUNREACH",
                ].includes(code)
            ) {
                return "connection"
            }
            if (code === "EACCES") return "permission"
            if (code === "ENOSPC") return "storage"

            // Postgres SQLSTATE.
            const sqlstate = this.#classifySqlState(code)
            if (sqlstate) return sqlstate
        }

        const mysqlErrno = typeof errno === "number" ? errno : undefined
        if (mysqlErrno !== undefined) {
            const mysql = this.#classifyMySqlErrno(mysqlErrno)
            if (mysql) return mysql
        }

        return this.#classifyErrorMessage(errorMessage)
    }

    #classifySqlState = (code: string): string | undefined => {
        // Specific codes first, then the SQLSTATE class (first two characters).
        switch (code) {
            case "40001": // serialization_failure
            case "40P01": // deadlock_detected
            case "55P03": // lock_not_available
            case "55006": // object_in_use
                return "lock"
            case "42501": // insufficient_privilege
                return "permission"
            case "53100": // disk_full
                return "storage"
            case "3D000": // invalid_catalog_name
            case "3F000": // invalid_schema_name
                return "schema"
        }

        switch (code.slice(0, 2)) {
            case "08": // connection_exception
                return "connection"
            case "28": // invalid_authorization_specification
                return "permission"
            case "23": // integrity_constraint_violation
                return "constraint"
            case "53": // insufficient_resources
                return "storage"
            case "22": // data_exception (incl. 22001 string_data_right_truncation)
                return "data"
            case "42": // syntax_error_or_access_rule_violation (undefined table/column)
                return "schema"
        }

        return undefined
    }

    #classifyMySqlErrno = (errno: number): string | undefined => {
        switch (errno) {
            case 1205: // ER_LOCK_WAIT_TIMEOUT
            case 1213: // ER_LOCK_DEADLOCK
                return "lock"
            case 1044: // ER_DBACCESS_DENIED_ERROR
            case 1045: // ER_ACCESS_DENIED_ERROR
            case 1142: // ER_TABLEACCESS_DENIED_ERROR
            case 1143: // ER_COLUMNACCESS_DENIED_ERROR
                return "permission"
            case 1062: // ER_DUP_ENTRY
            case 1451: // ER_ROW_IS_REFERENCED_2
            case 1452: // ER_NO_REFERENCED_ROW_2
            case 3819: // ER_CHECK_CONSTRAINT_VIOLATED
                return "constraint"
            case 1021: // ER_DISK_FULL
                return "storage"
            case 1406: // ER_DATA_TOO_LONG
            case 1264: // ER_WARN_DATA_OUT_OF_RANGE
                return "data"
            case 1049: // ER_BAD_DB_ERROR
            case 1054: // ER_BAD_FIELD_ERROR
            case 1146: // ER_NO_SUCH_TABLE
                return "schema"
            case 2002: // CR_CONNECTION_ERROR
            case 2003: // CR_CONN_HOST_ERROR
            case 2006: // CR_SERVER_GONE_ERROR
            case 2013: // CR_SERVER_LOST
                return "connection"
        }

        return undefined
    }

    /**
     * Last-resort classification for drivers that report no code. Ordered most
     * specific first: "lock wait timeout" must not be read as a connection
     * timeout, and "no space left" must not be read as a schema error.
     */
    #classifyErrorMessage = (errorMessage: string): string | undefined => {
        const message = errorMessage.toLowerCase()
        const matches = (...needles: string[]): boolean => needles.some((n) => message.includes(n))

        if (matches("deadlock", "lock timeout", "lock wait timeout", "could not obtain lock")) {
            return "lock"
        }
        if (matches("enospc", "no space left", "disk full", "out of disk")) {
            return "storage"
        }
        if (
            matches(
                "too long",
                "truncated",
                "value too large",
                "string data right truncation",
                "out of range",
            )
        ) {
            return "data"
        }
        if (
            matches(
                "econnrefused",
                "enotfound",
                "etimedout",
                "enetunreach",
                "ehostunreach",
                "econnreset",
                "connection refused",
                "connection terminated",
                "connection closed",
                "could not connect",
                "network",
            )
        ) {
            return "connection"
        }
        if (
            matches(
                "eacces",
                "access denied",
                "authentication",
                "password authentication",
                "unauthorized",
                "insufficient privilege",
                "permission denied",
            )
        ) {
            return "permission"
        }
        if (
            matches(
                "duplicate key",
                "duplicate entry",
                "unique constraint",
                "foreign key constraint",
                "check constraint",
                "not null constraint",
                "violates",
            )
        ) {
            return "constraint"
        }
        if (
            matches(
                "does not exist",
                "no such table",
                "no such column",
                "unknown column",
                "unknown table",
                "undefined table",
                "undefined column",
            )
        ) {
            return "schema"
        }

        return undefined
    }

    #loadPolicyLine = (line: TCasinTable, model: Model): void => {
        const ptype = line.ptype
        if (!ptype) {
            throw new Error(`Invalid policy line: ptype is required but got ${ptype}`)
        }

        const sec = ptype.substring(0, 1)
        const ast = model.model.get(sec)?.get(ptype)
        if (!ast) {
            // The table may hold rules for ptypes this model does not declare.
            // casbin's own Helper.loadPolicyLine skips them too.
            return
        }

        const values = POLICY_COLUMNS.map((name) => line[name])
        // Only *trailing* unused columns are dropped. Filtering on falsiness
        // would also drop legitimate empty-string values from the middle of a
        // rule and silently change its arity.
        let length = values.length
        while (length > 0 && values[length - 1] === null) {
            length--
        }

        ast.policy.push(values.slice(0, length).map((value) => value ?? ""))
    }

    async loadPolicy(model: Model): Promise<void> {
        if (!model) {
            throw new Error("Model is required for loading policy")
        }

        let lines: TCasinTable[]
        try {
            lines = await this.#db.select().from(this.#schema)
        } catch (error) {
            throw this.#categorizeError(error, "loading policy from database")
        }

        try {
            for (const line of lines) {
                this.#loadPolicyLine(line, model)
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            throw new Error(`Failed to parse policy data: ${errorMessage}`, { cause: error })
        }
    }

    #savePolicyLine = (ptype: string, rule: string[]): TCasinTableCreateInput => {
        if (rule.length > POLICY_COLUMNS.length) {
            throw new Error(
                `Rule has ${rule.length} values but the casbin table stores at most ` +
                    `${POLICY_COLUMNS.length} (${POLICY_COLUMNS.join(", ")}): ` +
                    `${JSON.stringify(rule)}`,
            )
        }

        const line: TCasinTableCreateInput = { ptype }
        POLICY_COLUMNS.forEach((name, index) => {
            if (index < rule.length) {
                line[name] = rule[index]
            }
        })

        return line
    }

    /**
     * Matches a stored rule exactly: every column the rule does not use must be
     * NULL, otherwise `p, alice, data1, read` would also match a longer rule
     * that merely shares its prefix. `eq(column, null)` renders `column = NULL`,
     * which is never true in SQL, so absent columns need `IS NULL`.
     */
    #matchLine = (line: TCasinTableCreateInput): SQL | undefined => {
        const conditions: SQL[] = [eq(this.#column("ptype"), line.ptype)]

        for (const name of POLICY_COLUMNS) {
            const value = line[name]
            conditions.push(
                value === undefined || value === null
                    ? isNull(this.#column(name))
                    : eq(this.#column(name), value),
            )
        }

        return and(...conditions)
    }

    async savePolicy(model: Model): Promise<boolean> {
        if (!model) {
            throw new Error("Model is required for saving policy")
        }

        // Build every row before touching the database. A malformed rule must
        // not leave the table truncated with the policy half-written.
        const lines: TCasinTableCreateInput[] = []
        for (const sec of ["p", "g"] as const) {
            // A model without a [role_definition] section has no "g" at all.
            const astMap = model.model.get(sec)
            if (!astMap) {
                continue
            }
            for (const [ptype, ast] of astMap) {
                for (const rule of ast.policy) {
                    lines.push(this.#savePolicyLine(ptype, rule))
                }
            }
        }

        try {
            await this.#db.transaction(async (tx) => {
                await tx.delete(this.#schema)
                for (let i = 0; i < lines.length; i += INSERT_CHUNK_SIZE) {
                    await tx.insert(this.#schema).values(lines.slice(i, i + INSERT_CHUNK_SIZE))
                }
            })
        } catch (error) {
            throw this.#categorizeError(error, "saving policy to database")
        }

        return true
    }

    async addPolicy(sec: string, ptype: string, rule: string[]): Promise<void> {
        if (!ptype) {
            throw new Error("Policy type (ptype) is required")
        }
        if (!Array.isArray(rule)) {
            throw new Error("Rule must be an array")
        }

        const line = this.#savePolicyLine(ptype, rule)
        try {
            await this.#db.insert(this.#schema).values([line])
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

        const line = this.#savePolicyLine(ptype, rule)
        try {
            await this.#db.delete(this.#schema).where(this.#matchLine(line))
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
        if (
            !Number.isInteger(fieldIndex) ||
            fieldIndex < 0 ||
            fieldIndex >= POLICY_COLUMNS.length
        ) {
            throw new Error(
                `Field index must be an integer between 0 and ${POLICY_COLUMNS.length - 1}, got ${fieldIndex}`,
            )
        }
        if (fieldIndex + fieldValues.length > POLICY_COLUMNS.length) {
            throw new Error(
                `Field index ${fieldIndex} with ${fieldValues.length} value(s) runs past the ` +
                    `${POLICY_COLUMNS.length} policy columns`,
            )
        }

        // Unlike removePolicy this is a *filtered* match: columns outside the
        // requested range stay unconstrained, and an empty string is casbin's
        // "match anything" wildcard rather than a literal value.
        const conditions: SQL[] = [eq(this.#column("ptype"), ptype)]
        fieldValues.forEach((value, offset) => {
            if (value === "") {
                return
            }
            conditions.push(eq(this.#column(POLICY_COLUMNS[fieldIndex + offset]!), value))
        })

        try {
            await this.#db.delete(this.#schema).where(and(...conditions))
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

        const oldLine = this.#savePolicyLine(ptype, oldRule)
        const newLine = this.#savePolicyLine(ptype, newRule)
        // Columns the new rule does not use must be cleared, not left holding
        // values from the old rule.
        for (const name of POLICY_COLUMNS) {
            if (newLine[name] === undefined) {
                newLine[name] = null
            }
        }

        try {
            await this.#db.update(this.#schema).set(newLine).where(this.#matchLine(oldLine))
        } catch (error) {
            throw this.#categorizeError(error, "updating policy")
        }
    }
}
