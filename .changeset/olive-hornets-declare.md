---
"casbin-drizzle-adapter": patch
---

Emit type declarations with `tsc` instead of tsup's dts pass.

tsup forces `baseUrl` onto the compiler when it generates declarations
(`baseUrl: compilerOptions.baseUrl || "."`, in its rollup worker). `baseUrl` is
deprecated: TypeScript 6 errors on it and TypeScript 7 removes it, so `pnpm build`
failed outright on TS 6 with `TS5101`. No tsconfig setting prevents the injection,
because tsup overrides whatever the tsconfig says. The previous workaround —
`"ignoreDeprecations": "6.0"` in `tsconfig.json` — silences the error for exactly
one major version and stops being accepted on the next.

-   `tsup` now builds JavaScript only; `tsc -p tsconfig.build.json` emits the
    declarations, and `scripts/copy-declarations.mjs` writes the `.d.mts` twin each
    ESM entry needs. A `.d.ts` in a `"type": "commonjs"` package is read as
    CommonJS, which would type the `.mjs` output as CommonJS for consumers.
-   Declarations are no longer bundled into one file per entry, so `dist/types.d.ts`
    now ships alongside them. Both are covered by the existing `"files": ["dist"]`.
-   The two relative imports in `src` are written with an explicit `.js` extension.
    Rolled-up declarations had no relative specifiers at all; emitted ones do, and
    an extensionless specifier is an error for consumers on `node16`/`nodenext`
    module resolution who do not set `skipLibCheck`.
