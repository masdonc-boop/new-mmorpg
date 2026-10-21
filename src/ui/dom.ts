/**
 * Empty a scrollable panel for a re-render while keeping the reader's place. The restore runs
 * as a microtask, i.e. after the (synchronous) render has refilled the container.
 */
export function clearKeepingScroll(body: HTMLElement) {
  const top = body.scrollTop;
  body.innerHTML = '';
  queueMicrotask(() => {
    body.scrollTop = top;
  });
}
