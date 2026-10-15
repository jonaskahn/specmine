import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DefaultPipeline } from '../src/pipeline.js';
import { JsonSpecValidator } from '../src/spec/validator.js';
import type { InputReader } from '../src/input/reader.js';
import type { LlmProvider, LlmResponse } from '../src/llm/provider.js';
import type { ImageProvider } from '../src/llm/openai-image.js';
import { GENERIC_CLASSIFICATION } from '../src/classify/classifier.js';

const FIXTURES = ['apparel.txt', 'real-estate.txt', 'news.txt'];
const CATEGORIES = ['apparel_footwear', 'real_estate', 'news_analysis'] as const;

function readFixture(name: string): string {
  return readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'categories', name),
    'utf8',
  );
}

function scriptLlm(responses: string[]): { llm: LlmProvider; calls: number[] } {
  let index = 0;
  const calls: number[] = [];
  return {
    calls,
    llm: {
      async complete(): Promise<LlmResponse> {
        calls.push(index);
        const content = responses[index] ?? '{}';
        index += 1;
        return { content };
      },
    },
  };
}

const RICH_SPECS: Record<string, string> = {
  'apparel.txt': JSON.stringify({
    Product: 'Trail Shell Jacket',
    Color: 'forest green',
    Material: 'ripstop nylon',
    Fit: 'relaxed fit',
    Sizes: 'XS–XXL',
  }),
  'real-estate.txt': JSON.stringify({
    Type: 'townhouse',
    Location: 'Lisbon',
    Bedrooms: '3',
    Area: '128 m²',
    Feature: 'rooftop terrace',
  }),
  'news.txt': JSON.stringify({ Topic: 'riverside park', Area: '12 hectares' }),
};

const RICH_VISUAL = JSON.stringify({
  subject: 'item',
  shape: '',
  proportions: '',
  colors: ['forest green'],
  materials: ['ripstop nylon'],
  finish: '',
  heroFeatures: ['adjustable hood'],
  viewpoint: '',
  setting: '',
});

for (let i = 0; i < FIXTURES.length; i += 1) {
  const fixture = FIXTURES[i] as string;
  const category = CATEGORIES[i] as string;
  test(`parity: ${fixture} renders grounded prompts in both modes`, async () => {
    const seen: string[] = [];
    const image: ImageProvider = {
      async generate(request) {
        seen.push(request.prompt);
        return { bytes: new Uint8Array([1]), mimeType: 'image/png' };
      },
    };
    const run = async (mode: 'parallel' | 'sequential') => {
      const script = scriptLlm([RICH_SPECS[fixture] as string, RICH_VISUAL]);
      const pipe = new DefaultPipeline({
        reader: {
          async read() {
            return { text: readFixture(fixture), imageOnly: false };
          },
        } as InputReader,
        llm: script.llm,
        validator: new JsonSpecValidator(),
        classifier: {
          async classify() {
            return { ...GENERIC_CLASSIFICATION };
          },
        },
        imageProvider: image,
      });
      return pipe.process('x', { outputs: ['spec', 'image'], mode, category });
    };
    const parallel = await run('parallel');
    const sequential = await run('sequential');
    assert.ok(parallel.spec && sequential.spec);
    assert.ok(parallel.image && sequential.image);
    for (const prompt of seen) {
      assert.ok(!/\d+\s?(kg|g|m²|€|\$)/.test(prompt), `leaked measurement in: ${prompt}`);
      assert.ok(!prompt.toLowerCase().includes('contact the listing agent'));
    }
  });
}
