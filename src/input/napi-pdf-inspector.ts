import { classifyPdf, processPdf } from '@firecrawl/pdf-inspector';
import type { PdfClassification, PdfExtraction, PdfInspector } from './pdf.js';

export class NapiPdfInspector implements PdfInspector {
  classify(data: Uint8Array): PdfClassification {
    const result = classifyPdf(Buffer.from(data));
    return {
      pdfType: result.pdfType,
      confidence: result.confidence,
      pagesNeedingOcr: result.pagesNeedingOcr,
    };
  }

  process(data: Uint8Array): PdfExtraction {
    const result = processPdf(Buffer.from(data));
    return {
      pdfType: result.pdfType,
      markdown: result.markdown ?? null,
    };
  }
}
