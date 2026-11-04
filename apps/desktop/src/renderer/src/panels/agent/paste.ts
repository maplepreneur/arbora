/**
 * A paste is an image (a screenshot, "Copy image" in a browser) when it carries image data and no
 * plain text; text with images (a copied web page) pastes as text.
 */
export function pastedImageOnly(items: readonly { kind: string; type: string }[]): boolean {
  const hasImage = items.some((item) => item.kind === 'file' && item.type.startsWith('image/'));
  const hasText = items.some((item) => item.kind === 'string' && item.type === 'text/plain');
  return hasImage && !hasText;
}
