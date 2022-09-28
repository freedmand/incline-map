export function debounce(fn: () => void, timeoutMillis = 100): () => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const reset = () => {
    if (timeout != null) {
      clearTimeout(timeout);
      timeout = null;
    }
  };
  return () => {
    reset();
    timeout = setTimeout(() => {
      fn();
      reset();
    }, timeoutMillis);
  };
}
