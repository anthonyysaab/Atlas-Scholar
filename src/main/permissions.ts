// The renderer is denied every permission except writing to the clipboard, which the Copy
// buttons need (`navigator.clipboard.writeText`); reading the clipboard stays denied.
const GRANTED: ReadonlySet<string> = new Set(["clipboard-sanitized-write"]);

export function isPermissionGranted(permission: string): boolean {
  return GRANTED.has(permission);
}
