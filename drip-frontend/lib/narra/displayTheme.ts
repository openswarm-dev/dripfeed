/** Shared display helpers for radar UI. */
export function displayTheme(theme: string): string {
  return theme
    .replace(/ — \d+ tokens sharing the same image$/, "")
    .replace(/ · image copycats$/, "");
}
