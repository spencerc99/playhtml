// ABOUTME: tldraw's fonts, icons and English strings bundled with the extension, so nothing loads from its CDN.
// ABOUTME: Other languages point at the English strings; the editor shows no text of its own.

import { getAssetUrls } from "@tldraw/assets/selfHosted";
import monoBold from "@tldraw/assets/fonts/IBMPlexMono-Bold.woff2?url";
import monoBoldItalic from "@tldraw/assets/fonts/IBMPlexMono-BoldItalic.woff2?url";
import monoMedium from "@tldraw/assets/fonts/IBMPlexMono-Medium.woff2?url";
import monoMediumItalic from "@tldraw/assets/fonts/IBMPlexMono-MediumItalic.woff2?url";
import sansBold from "@tldraw/assets/fonts/IBMPlexSans-Bold.woff2?url";
import sansBoldItalic from "@tldraw/assets/fonts/IBMPlexSans-BoldItalic.woff2?url";
import sansMedium from "@tldraw/assets/fonts/IBMPlexSans-Medium.woff2?url";
import sansMediumItalic from "@tldraw/assets/fonts/IBMPlexSans-MediumItalic.woff2?url";
import serifBold from "@tldraw/assets/fonts/IBMPlexSerif-Bold.woff2?url";
import serifBoldItalic from "@tldraw/assets/fonts/IBMPlexSerif-BoldItalic.woff2?url";
import serifMedium from "@tldraw/assets/fonts/IBMPlexSerif-Medium.woff2?url";
import serifMediumItalic from "@tldraw/assets/fonts/IBMPlexSerif-MediumItalic.woff2?url";
import drawBold from "@tldraw/assets/fonts/Shantell_Sans-Informal_Bold.woff2?url";
import drawBoldItalic from "@tldraw/assets/fonts/Shantell_Sans-Informal_Bold_Italic.woff2?url";
import drawRegular from "@tldraw/assets/fonts/Shantell_Sans-Informal_Regular.woff2?url";
import drawRegularItalic from "@tldraw/assets/fonts/Shantell_Sans-Informal_Regular_Italic.woff2?url";
import icons from "@tldraw/assets/icons/icon/0_merged.svg?url";
import mainStrings from "@tldraw/assets/translations/main.json?url";
import languages from "@tldraw/assets/translations/languages.json?url";
import englishStrings from "@tldraw/assets/translations/en.json?url";

const BUNDLED: Record<string, string> = {
  "./fonts/IBMPlexMono-Bold.woff2": monoBold,
  "./fonts/IBMPlexMono-BoldItalic.woff2": monoBoldItalic,
  "./fonts/IBMPlexMono-Medium.woff2": monoMedium,
  "./fonts/IBMPlexMono-MediumItalic.woff2": monoMediumItalic,
  "./fonts/IBMPlexSans-Bold.woff2": sansBold,
  "./fonts/IBMPlexSans-BoldItalic.woff2": sansBoldItalic,
  "./fonts/IBMPlexSans-Medium.woff2": sansMedium,
  "./fonts/IBMPlexSans-MediumItalic.woff2": sansMediumItalic,
  "./fonts/IBMPlexSerif-Bold.woff2": serifBold,
  "./fonts/IBMPlexSerif-BoldItalic.woff2": serifBoldItalic,
  "./fonts/IBMPlexSerif-Medium.woff2": serifMedium,
  "./fonts/IBMPlexSerif-MediumItalic.woff2": serifMediumItalic,
  "./fonts/Shantell_Sans-Informal_Bold.woff2": drawBold,
  "./fonts/Shantell_Sans-Informal_Bold_Italic.woff2": drawBoldItalic,
  "./fonts/Shantell_Sans-Informal_Regular.woff2": drawRegular,
  "./fonts/Shantell_Sans-Informal_Regular_Italic.woff2": drawRegularItalic,
  "./icons/icon/0_merged.svg": icons,
  "./translations/main.json": mainStrings,
  "./translations/languages.json": languages,
};

/**
 * Every asset tldraw asks for, resolved to a file inside the extension. A
 * translation other than the bundled ones reads the English file, and the
 * embed icons, which only tldraw's hidden menus use, read the icon sheet.
 */
export const TLDRAW_ASSET_URLS = getAssetUrls((path: string) => {
  const bundled = BUNDLED[path];
  if (bundled) return bundled;
  if (path.startsWith("./translations/")) return englishStrings;
  if (path.startsWith("./embed-icons/")) return icons;
  throw new Error(`The tldraw asset ${path} is not bundled with the extension`);
});
