export function uniq<T>(list: T[]): T[] {
  const found: { [key: string]: boolean } = {};
  const results: T[] = [];
  for (const elem of list) {
    const key = JSON.stringify(elem);
    if (found[key]) continue;
    found[key] = true;
    results.push(elem);
  }
  return results;
}
