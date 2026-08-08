import { detect } from 'tinyld';

export function detectLanguage(text: string): string | undefined {
  const lang = detect(text);
  return lang === '' ? undefined : lang;
}
