import 'dotenv/config';
import { createExtractor, createOpenAiProvider, createResilientProvider } from '../src/index.js';

const extractor = createExtractor({
  llm: createResilientProvider(createOpenAiProvider(), {
    retry: { maxRetries: 2, backoffMs: 200 },
    circuitBreaker: { failureThreshold: 5, cooldownMs: 30_000 },
  }),
});

const spec = await extractor.extract('https://www.crn.de/news/2026/translated/nach-hornetsecurity-nachste-milliarden-akquisition-von-proofpoint');
console.log(JSON.stringify(spec, null, 2));
