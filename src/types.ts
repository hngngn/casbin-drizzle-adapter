import type { Column, ColumnBaseConfig, ColumnDataType } from "drizzle-orm"
import type { POLICY_COLUMNS } from "./index.js"

/**
 * Derived from the runtime tuple so the two cannot drift. The import is
 * type-only on purpose: this module must emit no JavaScript, because `tsup`
 * builds without bundling and would leave an unresolvable `./types` import in
 * the ESM output.
 */
export type TPolicyColumn = (typeof POLICY_COLUMNS)[number]

/**
 * A stored rule as the adapter reads it. The table may carry any number of
 * further columns (an `id`, timestamps, ...); none of them are read or written,
 * so none of them appear here.
 */
export type TCasbinTable = { ptype: string | null } & Record<TPolicyColumn, string | null>

/**
 * A row as the adapter writes it. `ptype` is always supplied; a policy column is
 * omitted when the rule is shorter than six values, and set to `null` when an
 * update has to clear a value the previous rule used.
 */
export type TCasbinTableCreateInput = { ptype: string } & Partial<
    Record<TPolicyColumn, string | null>
>

/**
 * A column holding nullable text. Rules shorter than six values leave their
 * unused columns NULL, `updatePolicy` clears columns by writing NULL, and
 * `#matchLine` matches them with `IS NULL`, so a NOT NULL policy column cannot
 * work — reject it at compile time rather than on the first short rule.
 */
type TNullableTextColumn = Column<
    ColumnBaseConfig<ColumnDataType, string> & { data: string; notNull: false }
>

/**
 * The columns every casbin table must expose. Only these property keys matter;
 * each may map to any database column name. `ptype` is written on every row, so
 * it is free to be NOT NULL.
 */
export type TCasbinColumns = { ptype: Column } & Record<TPolicyColumn, TNullableTextColumn>

/**
 * Which rules a filtered load should read, keyed by ptype. Each array holds the
 * values a rule must have at `v0`, `v1`, ... in order; `""` matches anything at
 * that position, and positions past the end of the array are unconstrained.
 *
 * A ptype the filter does not name is loaded in full, which is how casbin's own
 * filtered adapters behave. The tenant of a rule lives in whichever policy
 * column the model puts it in, so it sits at a different index per ptype:
 *
 * ```ts
 * // p = sub, dom, obj, act  →  domain is v1
 * // g = _, _, _             →  domain is v2
 * await e.loadFilteredPolicy({ p: ["", "tenant_a"], g: ["", "", "tenant_a"] })
 * ```
 */
export type TCasbinFilter = Record<string, readonly string[] | undefined>
