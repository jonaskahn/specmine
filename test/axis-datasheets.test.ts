import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createExtractor } from '../src/extractor.js';
import { DefaultReader } from '../src/input/reader.js';
import { NapiPdfInspector } from '../src/input/napi-pdf-inspector.js';
import { detectLanguage } from '../src/input/language.js';
import { JsonSpecValidator } from '../src/spec/validator.js';
import type { PdfType } from '../src/input/pdf.js';
import type { LlmProvider, LlmRequest, LlmResponse } from '../src/llm/provider.js';

interface Fixture {
  name: string;
  file: string;
  pdfType: PdfType;
  keywords: RegExp[];
}

const fixtures: Fixture[] = [
  {
    name: 'axis-a9801-de',
    file: './fixtures/axis-a9801-de.pdf',
    pdfType: 'TextBased',
    keywords: [/AXIS A9801/, /48 x 45 x 30 mm/, /Abmessungen/, /Gewicht/],
  },
  {
    name: 'axis-xc1311-de',
    file: './fixtures/axis-xc1311-de.pdf',
    pdfType: 'Mixed',
    keywords: [/AXIS XC1311/, /110 dB bei 1 m Abstand/, /400 Hz bis 5,5 kHz/, /-40 °C bis \+60 °C/],
  },
  {
    name: 'axis-d4100-de',
    file: './fixtures/axis-d4100-de.pdf',
    pdfType: 'TextBased',
    keywords: [/AXIS D4100-VE Mk II/, /IP66, IK10/, /110 dB, 1 m bei 3,4 kHz/, /PoE-betriebene/],
  },
];

const NESTED_SPEC = { Abmessungen: { Breite: '48 mm', Tiefe: '45 mm' } };
const FLAT_SPEC = { 'Abmessungen · Breite': '48 mm', 'Abmessungen · Tiefe': '45 mm' };
const INNERMOST_SPEC = { Breite: '48 mm', Tiefe: '45 mm' };
const NESTED_RESPONSE = JSON.stringify(NESTED_SPEC);
const FLAT_RESPONSE = JSON.stringify(FLAT_SPEC);

function fakeLlm(content: string): LlmProvider {
  return {
    async complete(): Promise<LlmResponse> {
      return { content };
    },
  };
}

function fixtureUrl(fixture: Fixture): URL {
  return new URL(fixture.file, import.meta.url);
}

async function fixtureBytes(fixture: Fixture): Promise<Uint8Array> {
  return new Uint8Array(await readFile(fixtureUrl(fixture)));
}

for (const fixture of fixtures) {
  test(`${fixture.name}: classify detects a text-bearing pdf`, async () => {
    const inspector = new NapiPdfInspector();
    const classification = inspector.classify(await fixtureBytes(fixture));
    assert.equal(classification.pdfType, fixture.pdfType);
    assert.ok(classification.confidence > 0);
  });

  test(`${fixture.name}: process extracts markdown with spec keywords`, async () => {
    const inspector = new NapiPdfInspector();
    const extraction = inspector.process(await fixtureBytes(fixture));
    assert.notEqual(extraction.markdown, null);
    for (const keyword of fixture.keywords) {
      assert.match(extraction.markdown ?? '', keyword);
    }
  });

  test(`${fixture.name}: reader reads file url without ocr fallback`, async () => {
    const reader = new DefaultReader(new NapiPdfInspector());
    const result = await reader.read(fixtureUrl(fixture));
    assert.equal(result.imageOnly, false);
    assert.ok(result.text.length > 500);
  });

  test(`${fixture.name}: reader detects pdf blob by magic bytes`, async () => {
    const reader = new DefaultReader(new NapiPdfInspector());
    const result = await reader.read(new Blob([await readFile(fixtureUrl(fixture))], { type: '' }));
    assert.equal(result.imageOnly, false);
    assert.match(result.text, /AXIS/);
  });

  test(`${fixture.name}: markdown is detected as German`, async () => {
    const reader = new DefaultReader(new NapiPdfInspector());
    const result = await reader.read(fixtureUrl(fixture));
    assert.equal(detectLanguage(result.text), 'de');
  });

  test(`${fixture.name}: extractor keeps nested output by default`, async () => {
    const extractor = createExtractor({
      reader: new DefaultReader(new NapiPdfInspector()),
      llm: fakeLlm(NESTED_RESPONSE),
      validator: new JsonSpecValidator(),
    });
    const spec = await extractor.extract(fixtureUrl(fixture));
    assert.deepEqual(spec, NESTED_SPEC);
  });

  test(`${fixture.name}: extractor flattens nested output to innermost pairs with flattened: true`, async () => {
    const extractor = createExtractor({
      reader: new DefaultReader(new NapiPdfInspector()),
      llm: fakeLlm(NESTED_RESPONSE),
      validator: new JsonSpecValidator(),
    });
    const spec = await extractor.extract(fixtureUrl(fixture), { flattened: true });
    assert.deepEqual(spec, INNERMOST_SPEC);
  });

  test(`${fixture.name}: extractor flattens nested output with path keys when inheritance: true`, async () => {
    const extractor = createExtractor({
      reader: new DefaultReader(new NapiPdfInspector()),
      llm: fakeLlm(NESTED_RESPONSE),
      validator: new JsonSpecValidator(),
    });
    const spec = await extractor.extract(fixtureUrl(fixture), {
      flattened: true,
      inheritance: true,
    });
    assert.deepEqual(spec, FLAT_SPEC);
  });

  test(`${fixture.name}: extractor leaves flat llm output unchanged`, async () => {
    const extractor = createExtractor({
      reader: new DefaultReader(new NapiPdfInspector()),
      llm: fakeLlm(FLAT_RESPONSE),
      validator: new JsonSpecValidator(),
    });
    const spec = await extractor.extract(fixtureUrl(fixture), { flattened: true });
    assert.deepEqual(spec, FLAT_SPEC);
  });

  test(`${fixture.name}: system prompt is written in German`, async () => {
    let systemPrompt: string | undefined;
    const extractor = createExtractor({
      reader: new DefaultReader(new NapiPdfInspector()),
      llm: {
        async complete(request: LlmRequest): Promise<LlmResponse> {
          systemPrompt = String(request.messages[0]?.content);
          return { content: '{}' };
        },
      },
      validator: new JsonSpecValidator(),
    });
    await extractor.extract(fixtureUrl(fixture));
    assert.ok(systemPrompt?.includes('Write every key and value in German'));
  });
}
