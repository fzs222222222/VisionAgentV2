import { cyberTerminalStyle } from "./cyberTerminal";
import { retroAnalogStyle } from "./retroAnalog";
import { swissMinimalStyle } from "./swissMinimal";
import { HtmlVideoStyle } from "./types";

export type { HtmlVideoStyle, HtmlVideoStyleId } from "./types";

export const HTML_VIDEO_STYLES: HtmlVideoStyle[] = [cyberTerminalStyle, swissMinimalStyle, retroAnalogStyle];

export const DEFAULT_HTML_VIDEO_STYLE_ID = HTML_VIDEO_STYLES[0].id;

export function getHtmlVideoStyle(styleId?: string | null): HtmlVideoStyle {
  return HTML_VIDEO_STYLES.find((item) => item.id === styleId) ?? HTML_VIDEO_STYLES[0];
}
