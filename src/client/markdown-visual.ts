/**
 * Syntax the initial Tiptap writing schema cannot round-trip losslessly.
 * These files stay fully editable in source mode instead of silently losing
 * unsupported Markdown during a visual edit.
 */
const UNSUPPORTED_MARKDOWN: readonly RegExp[] = [
  /^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/,
  /^\s*[-*+]\s+\[[ xX]\]\s+/m,
  /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/m,
  /!\[[^\]]*\]\([^)]*\)/,
  /\[\^[^\]]+\]/,
  /^\s*:::\S*/m,
  /<\/?[A-Za-z][^>]*>/,
  /^\s*(?:import|export)\s.+from\s+['"]/m,
]

/** Return whether the writing schema can safely own this Markdown source. */
export function supportsVisualMarkdown(source: string): boolean {
  return !UNSUPPORTED_MARKDOWN.some(pattern => pattern.test(source))
}
