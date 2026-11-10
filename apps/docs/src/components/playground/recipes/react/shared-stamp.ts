// ABOUTME: Provides the copy-paste React source for the shared stamp recipe.
// ABOUTME: Points CanSpinElement at the stamp on the playhtml.fun homepage with dataSource.
import { sharedStampCss, sharedStampSrc } from "../demo-shared";
import { appShell } from "./app-shell";

export const sharedStampReactSource = `import { CanSpinElement, PlayProvider } from "@playhtml/react";

// The source stamp lives on the playhtml.fun homepage with \`shared\`. This
// copy reads and writes the same rotation.
function SharedStamp() {
  return (
    <>
      <CanSpinElement dataSource="playhtml.fun#stamp">
        <img className="stamp" src="${sharedStampSrc}" alt="The playhtml logo stamp" />
      </CanSpinElement>
      <p>Drag to spin it. It's the same stamp as on the playhtml.fun homepage.</p>
    </>
  );
}

${appShell("SharedStamp", sharedStampCss)}`;
