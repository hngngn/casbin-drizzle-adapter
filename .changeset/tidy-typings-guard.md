---
"casbin-drizzle-adapter": minor
---

Make the table types catch a wrong casbin table at compile time.

-   `TCasbinSchema` now requires the table to expose `ptype` and `v0..v5`. Passing a
    table without them was already rejected by the constructor at runtime; it is now
    a type error, and the message names the missing columns.
-   The `v0..v5` columns must be nullable text. A NOT NULL policy column cannot store
    a rule shorter than six values, and `updatePolicy` clears unused columns by
    writing NULL, so such a table failed on its first short rule. It no longer
    compiles. `ptype` is written on every row and may stay NOT NULL.
-   The row types no longer claim an `id` column. The adapter never reads or writes
    one, so a table without `id` is typed honestly, and `ptype` is now required
    rather than optional on the value the adapter writes.
-   The row and column types are derived from a single list of policy columns, so
    they cannot drift from the columns the adapter actually touches.

Only the property keys are constrained, never the SQL names: the table and each of
its columns may still be named anything in the database.
