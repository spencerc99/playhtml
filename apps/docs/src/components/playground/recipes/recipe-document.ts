// ABOUTME: Builds complete HTML documents for small canonical playground recipes.
// ABOUTME: Keeps the shared document shell consistent while recipes own their visible source.

type RecipeDocumentOptions = {
  title: string;
  styles: string;
  body: string;
  script: string;
  /** Names imported from playhtml. Defaults to just `playhtml`. */
  imports?: string;
  /** Extra `playhtml.init` options, such as `events`, as indented source. */
  initOptions?: string;
};

/** The page shell most recipes share: cream paper, centered content. */
export const recipeBaseStyles = `    :root {
      color: #1c1c1c;
      background: #f4efe5;
      font-family: ui-sans-serif, system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    body { display: grid; min-height: 100vh; margin: 0; padding: 1.5rem; place-items: center; }`;

/** Indents every non-empty line of `text` by `spaces`. */
export function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");
}

export function recipeDocument({
  title,
  styles,
  body,
  script,
  imports = "playhtml",
  initOptions,
}: RecipeDocumentOptions): string {
  const init = initOptions
    ? `{\n      developmentMode: true,\n${initOptions}\n    }`
    : "{ developmentMode: true }";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
${styles}
  </style>
</head>
<body>
${body}

  <script type="module">
    import { ${imports} } from "https://unpkg.com/playhtml@latest";

${script}

    await playhtml.init(${init});
  </script>
</body>
</html>`;
}
