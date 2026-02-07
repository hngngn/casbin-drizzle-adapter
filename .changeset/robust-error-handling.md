---
"casbin-drizzle-adapter": patch
---

## Bug Fixes

- Add comprehensive error handling for database operations with 8 distinct error categories (connection, permission, constraint violations, etc.)
- Fix hardcoded table name bug in `savePolicy` method
- Add input validation on all adapter methods
- Provide clear, actionable error messages for better debugging
