// Bundles each Lambda handler into backend/dist/<name>/index.mjs with esbuild.
// SAM / CloudFormation then zips each folder as-is (no build step on the AWS side).
import { build } from 'esbuild';
import { rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const handlers = ['api', 'stream', 'nightly', 'post-confirmation'];
const outRoot = path.join(root, 'backend', 'dist');

await rm(outRoot, { recursive: true, force: true });

for (const name of handlers) {
  const outfile = path.join(outRoot, name, 'index.mjs');
  await build({
    entryPoints: [path.join(root, 'backend', 'src', 'handlers', `${name}.ts`)],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    minify: true,
    sourcemap: true,
    legalComments: 'none',
    // Some dependencies are CommonJS and call require(); give ESM a require().
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
    logLevel: 'warning',
  });
  const { size } = await stat(outfile);
  console.log(`built ${name.padEnd(18)} ${(size / 1024).toFixed(0).padStart(6)} KB`);
}
