import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NapiPdfInspector } from '../src/input/napi-pdf-inspector.js';

const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
  'base64',
);

function buildPdf(objects: Buffer[]): Uint8Array {
  const parts = [Buffer.from('%PDF-1.4\n')];
  const offsets: number[] = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.concat(parts).length);
    parts.push(Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n'));
  }
  const xrefPos = Buffer.concat(parts).length;
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`));
  for (const offset of offsets.slice(1)) {
    parts.push(Buffer.from(`${String(offset).padStart(10, '0')} 00000 n \n`));
  }
  parts.push(
    Buffer.from(
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`,
    ),
  );
  return new Uint8Array(Buffer.concat(parts));
}

function textPdf(): Uint8Array {
  return buildPdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    ),
    Buffer.from('<< /Length 44 >>\nstream\nBT /F1 24 Tf 100 700 Td (Hello World) Tj ET\nendstream'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ]);
}

function scannedPdf(): Uint8Array {
  const image = Buffer.concat([
    Buffer.from(
      `<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${JPEG.length} >>\nstream\n`,
    ),
    JPEG,
    Buffer.from('\nendstream'),
  ]);
  return buildPdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>',
    ),
    Buffer.from('<< /Length 12 >>\nstream\nq 100 0 0 100 0 0 cm /Im1 Do Q\nendstream'),
    image,
  ]);
}

test('classify detects a text-based pdf', () => {
  const inspector = new NapiPdfInspector();
  const result = inspector.classify(textPdf());
  assert.equal(result.pdfType, 'TextBased');
  assert.equal(typeof result.confidence, 'number');
  assert.deepEqual(result.pagesNeedingOcr, []);
});

test('classify detects a scanned pdf needing ocr', () => {
  const inspector = new NapiPdfInspector();
  const result = inspector.classify(scannedPdf());
  assert.equal(result.pdfType, 'Scanned');
  assert.ok(result.pagesNeedingOcr.length >= 1);
});

test('process extracts markdown from a text-based pdf', () => {
  const inspector = new NapiPdfInspector();
  const result = inspector.process(textPdf());
  assert.equal(result.pdfType, 'TextBased');
  assert.match(result.markdown ?? '', /Hello World/);
});

test('process returns null markdown for an image-only pdf', () => {
  const inspector = new NapiPdfInspector();
  const result = inspector.process(scannedPdf());
  assert.equal(result.pdfType, 'Scanned');
  assert.equal(result.markdown, null);
});
