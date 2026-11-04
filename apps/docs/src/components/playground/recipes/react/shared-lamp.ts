// ABOUTME: Provides the copy-paste React source for the shared lamp recipe.
// ABOUTME: Points CanToggleElement at the lamp on spencer.place with dataSource.
import { sharedLampCss, sharedLampSrc } from "../demo-shared";
import { appShell } from "./app-shell";

export const sharedLampReactSource = `import { CanToggleElement, PlayProvider } from "@playhtml/react";

// The source lamp lives on spencer.place with \`shared\`. This copy reads
// and writes the same on/off state.
function SharedLamp() {
  return (
    <>
      <CanToggleElement dataSource="spencer.place#lamp-akari">
        <img className="lamp" src="${sharedLampSrc}" alt="A paper lamp" />
      </CanToggleElement>
      <p>Click the lamp. It turns on for everyone on spencer.place and playhtml.fun too.</p>
    </>
  );
}

${appShell("SharedLamp", sharedLampCss)}`;
