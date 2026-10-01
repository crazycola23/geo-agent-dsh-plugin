import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import catalog from '../src/generated/openapi.catalog.json' with { type: 'json' };

const here = dirname(fileURLToPath(import.meta.url));
const specPath = resolve(process.argv[2] || resolve(here, '..', '..', 'scrm-specs', '30-contracts', '08-openapi.yaml'));
const text = await readFile(specPath, 'utf8');
const digest = createHash('sha256').update(text).digest('hex');
if (digest !== catalog.source.sha256) {
  console.error(`OpenAPI changed (${digest}); run npm run generate:catalog with the current specs checkout.`);
  process.exitCode = 1;
} else if (Object.keys(catalog.operations).length < 100) {
  console.error('Catalog operation count is unexpectedly low.');
  process.exitCode = 1;
} else {
  console.log(`Catalog matches OpenAPI ${digest} (${Object.keys(catalog.operations).length} operations).`);
}
