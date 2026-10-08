// `tsc` emits one set of declarations, but the package ships two module formats
// and the exports map points each at its own types file. A `.d.ts` in a
// `"type": "commonjs"` package is read as CommonJS, so the ESM entry needs a
// `.d.mts` beside it or consumers see the ESM output typed as CommonJS.
//
// The two files are identical. Nothing in this package's public types differs
// between formats, and every relative specifier is written with a `.js`
// extension, which resolves under both.
import { copyFile, readdir } from "node:fs/promises"
import { join } from "node:path"

const dist = new URL("../dist/", import.meta.url).pathname

const declarations = async (directory) => {
    const found = []
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) {
            found.push(...(await declarations(path)))
        } else if (entry.name.endsWith(".d.ts")) {
            found.push(path)
        }
    }
    return found
}

const files = await declarations(dist)
await Promise.all(files.map((file) => copyFile(file, `${file.slice(0, -5)}.d.mts`)))

console.log(`copy-declarations: wrote ${files.length} .d.mts file(s)`)
