import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
gfm(turndown);

const HTML_TAGS =
  /<(?:!doctype|html|head|body|div|p|h[1-6]|table|thead|tbody|tr|th|td|ul|ol|li|dl|dt|dd|a|img|span|section|article|header|footer|main|nav|aside|form|input|select|button|pre|code|blockquote|hr|br|script|style|meta|link)[\s>/]/i;

export function htmlToMarkdown(text: string): string {
  if (!HTML_TAGS.test(text)) return text;
  return turndown.turndown(text);
}
