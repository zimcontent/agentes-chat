/** Markdown read as text (Bun's text import): what the agents read on a voice call (`live-call.md`). */
declare module "*.md" {
  const text: string;
  export default text;
}
