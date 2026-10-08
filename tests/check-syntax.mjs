import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

async function* scripts(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) yield* scripts(path);
        else if (/\.(js|mjs)$/.test(entry.name)) yield path;
    }
}

let checked = 0;
for (const directory of ['js', 'tests']) {
    for await (const path of scripts(resolve(root, directory))) {
        const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
        if (result.error) throw result.error;
        if (result.status !== 0) {
            console.error(`Syntax check failed: ${relative(root, path)}`);
            process.exit(result.status ?? 1);
        }
        checked++;
    }
}
console.log(`Syntax check passed (${checked} scripts).`);
