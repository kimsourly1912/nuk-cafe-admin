// Nitro's raw plugin imports Markdown as text (the assistant's help guide, D109); the server tests
// do the same (vitest.config.ts).
declare module '*.md' {
  const text: string
  export default text
}
