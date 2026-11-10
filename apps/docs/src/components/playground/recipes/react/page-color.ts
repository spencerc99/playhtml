// ABOUTME: Provides the copy-paste React source for the shared page color recipe.
// ABOUTME: Two separate components read and write one named page channel with usePageData.
import { pageColorCss, pageColorSwatches } from "../demo-shared";
import { appShell } from "./app-shell";

export const pageColorReactSource = `import { useEffect } from "react";
import { PlayProvider, usePageData } from "@playhtml/react";

const SWATCHES = ${JSON.stringify(pageColorSwatches)};

// The page's background color is one value in a page data channel. No
// component owns it: any component can read or write it by name.
function usePageColor() {
  return usePageData("page-color", "#f4efe5");
}

function Swatches({ where }: { where: "top" | "bottom" }) {
  const [, setColor] = usePageColor();
  return (
    <nav className={\`corner \${where}\`}>
      {SWATCHES.map((color) => (
        <button
          key={color}
          onClick={() => setColor(color)}
          style={{ background: color }}
          aria-label={\`Paint the page \${color}\`}
        />
      ))}
    </nav>
  );
}

function PageColor() {
  const [color] = usePageColor();
  // Painting the body reads the channel; it never writes it.
  useEffect(() => {
    document.body.style.background = color;
  }, [color]);

  return (
    <>
      <Swatches where="top" />
      <div className="middle">
        <p>Pick a color in either corner. It paints the whole page for everyone.</p>
        <code className="readout">"page-color": "{color}"</code>
      </div>
      <Swatches where="bottom" />
    </>
  );
}

${appShell("PageColor", pageColorCss)}`;
