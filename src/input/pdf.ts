export type PdfType = 'TextBased' | 'Scanned' | 'ImageBased' | 'Mixed';

export interface PdfClassification {
  pdfType: PdfType;
  confidence: number;
  pagesNeedingOcr: number[];
}

export interface PdfExtraction {
  pdfType: PdfType;
  markdown: string | null;
}

export interface PdfInspector {
  classify(data: Uint8Array): PdfClassification;
  process(data: Uint8Array): PdfExtraction;
}
