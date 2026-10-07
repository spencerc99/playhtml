// ABOUTME: Builds complete HTML documents for small canonical playground recipes.
// ABOUTME: Keeps the shared document shell consistent while recipes own their visible source.

type RecipeDocumentOptions = {
  title: string;
  styles: string;
  body: string;
  script: string;
};

export function recipeDocument({
  title,
  styles,
  body,
  script,
}: RecipeDocumentOptions): string {
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
    import { playhtml } from "playhtml";

${script}

    await playhtml.init({ developmentMode: true });
  </script>
</body>
</html>`;
}
