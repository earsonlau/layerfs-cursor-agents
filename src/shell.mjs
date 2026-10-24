/** A single-quoted POSIX shell word. */
export function shellSingle(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
