import { detect } from 'tinyld';
import { logger } from '../log.js';

export function detectLanguage(text: string): string | undefined {
  const lang = detect(text);
  const result = lang === '' ? undefined : lang;
  logger().debug('Detected input language', { lang: result });
  return result;
}
