export function fitCanvas(width, height, viewportWidth, viewportHeight) {
  if (viewportWidth <= 32 || viewportHeight <= 32) return 1;
  return Math.min(
    1,
    (viewportWidth - 32) / width,
    (viewportHeight - 32) / height,
  );
}

// Preserve the image point under the cursor, including centered-image margins.
export function zoomAroundPoint({
  width,
  height,
  viewportWidth,
  viewportHeight,
  from,
  to,
  scrollLeft,
  scrollTop,
  x,
  y,
}) {
  const offset = (viewport, side, scale) =>
    Math.max(16, (viewport - side * scale) / 2);
  return {
    left:
      ((scrollLeft + x - offset(viewportWidth, width, from)) / from) * to +
      offset(viewportWidth, width, to) -
      x,
    top:
      ((scrollTop + y - offset(viewportHeight, height, from)) / from) * to +
      offset(viewportHeight, height, to) -
      y,
  };
}
