import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import yaml from 'yaml';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as schemas from '../src/schemas/index.js';

extendZodWithOpenApi(z);
const registry = new OpenAPIRegistry();

for (const [key, schema] of Object.entries(schemas)) {
  if (schema instanceof z.ZodType) {
    // Automatically register any exported zod schemas as components
    registry.registerComponent('schemas', key, schema);
  }
}

const generator = new OpenApiGeneratorV3(registry.definitions);
const document = generator.generateDocument({
  openapi: '3.0.0',
  info: {
    version: '1.0.0',
    title: 'Credence API',
    description: 'Generated OpenAPI documentation from Zod schemas',
  },
  servers: [{ url: 'https://api.credence.org/v1' }],
});

const plainDocument = JSON.parse(JSON.stringify(document));
const yamlString = yaml.stringify(plainDocument);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsPath = path.resolve(__dirname, '../docs/openapi.yaml');

fs.mkdirSync(path.dirname(docsPath), { recursive: true });
fs.writeFileSync(docsPath, yamlString, 'utf-8');
console.log("OpenAPI spec generated at docs/openapi.yaml");
