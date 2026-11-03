/** Recovery credentials must not be copied into uploaded failure evidence. */
export function redactFailureEntry(address: string, html: string) {
  const url = new URL(address)
  for (const key of [...url.searchParams.keys()]) {
    if (!/^(?:token|code|password|secret)$/i.test(key)) continue
    for (const value of url.searchParams.getAll(key)) {
      if (value) html = html.replaceAll(value, '[redacted]').replaceAll(encodeURIComponent(value), '[redacted]')
    }
    url.searchParams.set(key, '[redacted]')
  }
  return { address: url.toString(), html }
}
