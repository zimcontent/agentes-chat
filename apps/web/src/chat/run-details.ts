/** Doug: the plain text a person copies from a failed run, to paste into a bug report or a message to support. */
export function failedRunDetails(d: {
  agent: string;
  /** The line the row shows. */
  line: string;
  /** The stored error and its code, when there are any. */
  error?: string;
  code?: string;
  runId: string;
  at: Date;
}): string {
  const rows = [`Agent: ${d.agent}`, `Message: ${d.line}`];
  if (d.error) rows.push(`Error: ${d.error}`);
  if (d.code) rows.push(`Code: ${d.code}`);
  rows.push(`Run: ${d.runId}`, `Time: ${d.at.toISOString()}`);
  return rows.join("\n");
}
