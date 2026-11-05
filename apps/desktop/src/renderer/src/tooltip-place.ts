const GAP = 6;
const MARGIN = 8;

/** Below the anchor (above when there is no room), kept inside the window and off the page. */
export function placeTooltip(
  anchor: Pick<DOMRect, 'left' | 'top' | 'width' | 'bottom'>,
  width: number,
  height: number,
  page: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'> | null,
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - height;
  let top = below + height + MARGIN <= viewport.height ? below : Math.max(MARGIN, above);
  const center = anchor.left + anchor.width / 2;
  let left = Math.min(Math.max(MARGIN, center - width / 2), viewport.width - width - MARGIN);
  const overlaps = (x: number, y: number): boolean =>
    page !== null && x < page.right && x + width > page.left && y < page.bottom && y + height > page.top;
  if (page && overlaps(left, top)) {
    if (center < page.left) left = Math.max(MARGIN, page.left - width - MARGIN);
    else if (center > page.right) left = Math.min(page.right + MARGIN, viewport.width - width - MARGIN);
    // An anchor above the page (its toolbar) shows the tooltip above itself instead.
    else if (above >= MARGIN) top = above;
  }
  return { left, top };
}
