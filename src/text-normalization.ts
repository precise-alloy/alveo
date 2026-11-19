import { isUtf8 } from 'node:buffer';

export const isTextLikePath = (filePath: string): boolean => {
  const [name = ''] = filePath.split(/[?#]/, 1);

  // Unknown extensions (including binary formats and byte-sensitive .ics)
  // are opaque. Extensionless consumer templates still get the byte checks.
  return /(?:^|[/\\])[^./\\]+$|\.(?:cshtml|css|cjs|csv|htm|html|js|json|jsx|map|md|mjs|scss|svg|ts|tsx|txt|webmanifest|xml|ya?ml)$/i.test(name);
};

export const normalizeTextLineEndings = (text: string): string => text.replace(/\r\n?/g, '\n');

export const isTextLikeContent = (content: string | Buffer): boolean =>
  typeof content === 'string' || (isUtf8(content) && !content.some((byte) => byte < 32 && byte !== 9 && byte !== 10 && byte !== 12 && byte !== 13));

export const normalizeSourceMapLineEndings = (text: string, canonical = false): string => {
  try {
    const sourceMap = JSON.parse(text) as { sourcesContent?: unknown; sources?: string[] };

    if (!Array.isArray(sourceMap.sourcesContent)) {
      return text;
    }

    const originalSourcesContent = sourceMap.sourcesContent;
    const sourcesContent = originalSourcesContent.map((sourceContent, i) => {
      if (typeof sourceContent !== 'string') return sourceContent;
      // Vite can embed a generated URL proxy as if it were the original
      // asset. Its opaque Rolldown reference is build-local, not source text.
      if (
        /[?&]url(?:[&#]|$)/.test(sourceMap.sources?.[i] ?? '') &&
        /^export default import\.meta\.ROLLDOWN_FILE_URL_[\w$]+;?\s*$/.test(sourceContent)
      )
        return null;

      return normalizeTextLineEndings(sourceContent);
    });

    if (!canonical && sourcesContent.every((sourceContent, index) => sourceContent === originalSourcesContent[index])) {
      return text;
    }

    sourceMap.sourcesContent = sourcesContent;

    return JSON.stringify(sourceMap);
  } catch {
    return text;
  }
};

export const normalizeTextFileContent = (filePath: string, text: string, canonicalMap = false): string => {
  const normalizedText = normalizeTextLineEndings(text);

  return /\.map(?:[?#]|$)/i.test(filePath) ? normalizeSourceMapLineEndings(normalizedText, canonicalMap) : normalizedText;
};

export const normalizeTextLikeContent = (filePath: string, content: string | Buffer, canonicalMap = false): string | Buffer => {
  if (typeof content !== 'string' && (!isTextLikePath(filePath) || !isTextLikeContent(content))) {
    return content;
  }

  return normalizeTextFileContent(filePath, typeof content === 'string' ? content : content.toString('utf-8'), canonicalMap);
};
