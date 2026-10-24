// ABOUTME: Indents a multi-line string so shared CSS can sit inside an HTML <style> block.

export function indent(text: string, spaces = 2): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");
}
