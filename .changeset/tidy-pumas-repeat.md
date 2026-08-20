---
"casbin-drizzle-adapter": patch
---

Update all dev dependencies to their latest supported versions and attach the original error as `cause` when policy parsing fails.

Toolchain changes (no effect on published API):

-   Migrate ESLint config to flat config (`eslint.config.mjs`) for ESLint 10
-   Migrate `drizzle.config.ts` to the `dialect`/`url` format for drizzle-kit 0.31, and `push:pg` -> `push`
-   Move `moduleResolution` off the removed `node10` setting
-   Bump CI to Node 22 and pnpm 10
