/**
 * A cafe page at the cafe's former address, moved to its current one (D142):
 * `/c/old/admin?x=1` → `/c/new/admin?x=1`. The rest of the path and the query stay. The addresses
 * from before cafe addresses (`/admin/…`, `/checkout`, D141) no longer redirect to a default cafe
 * (D221): production never had them.
 */
export function movedCafeTarget(path: string, slug: string): string {
  return path.replace(/^\/c\/[^/?#]+/, `/c/${slug}`)
}
