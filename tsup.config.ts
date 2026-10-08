import { defineConfig, type Options } from "tsup"

export default defineConfig((options: Options) => ({
    // `bundle: false` emits one file per entry and rewrites no import paths, so
    // every module imported at runtime must be an entry of its own. src/types.ts
    // is absent by design: it is type-only and erases to nothing.
    entry: ["src/index.ts", "src/table/pg.ts", "src/table/mysql.ts", "src/table/sqlite.ts"],
    clean: true,
    format: ["cjs", "esm"],
    // Declarations come from `tsc -p tsconfig.build.json` instead: tsup's dts
    // pass forces the deprecated `baseUrl` on the compiler, which TS 6 errors
    // on and TS 7 removes. See tsconfig.build.json.
    dts: false,
    bundle: false,
    ...options,
}))
