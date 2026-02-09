# casbin-drizzle-adapter

## 1.1.2

### Patch Changes

-   5d19b06: ## Bug Fixes

    -   Add comprehensive error handling for database operations with 8 distinct error categories (connection, permission, constraint violations, etc.)
    -   Fix hardcoded table name bug in `savePolicy` method
    -   Add input validation on all adapter methods
    -   Provide clear, actionable error messages for better debugging

## 1.1.1

### Patch Changes

-   38cd042: Update README

## 1.1.0

### Minor Changes

-   82c918a: ## New Features

    -   Implement `UpdatableAdapter` to support update policy

    ## Breaking Changes:

    -   Change `casbinRule` to `casbinTable`

    ## Bug Fixes

    -   Add missing type for `MySQL` and add `SQLite` type for `schema`

## 1.0.0

### Major Changes

-   be8cab5: version `1.0.0`

## 1.0.0

### Major Changes

-   183c987: version: `1.0.0`
