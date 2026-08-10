import 'dotenv/config';
import { createExtractor, createOpenAiProvider, createResilientProvider } from '../src/index.js';

const extractor = createExtractor({
  llm: createResilientProvider(createOpenAiProvider(), {
    retry: { maxRetries: 2, backoffMs: 200 },
    circuitBreaker: { failureThreshold: 5, cooldownMs: 30_000 },
  }),
});

const spec = await extractor.extract('The Acme Kettle holds 1.5 L, weighs 900 g.');
console.log(JSON.stringify(spec, null, 2));
