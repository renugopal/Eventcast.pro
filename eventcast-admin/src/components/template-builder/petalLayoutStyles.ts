/**
 * Runtime petals are created by script.js (not GrapesJS components).
 * gjs-project.json stores this layout rule, but on-disk styles.css omits it.
 * setStyle(styles.css) therefore drops .hero__petal sizing/positioning.
 */
export const HERO_PETAL_LAYOUT_CSS = `
.hero__petal {
  position: absolute;
  top: -12%;
  width: var(--petal-size, 6%);
  height: auto;
  opacity: var(--petal-opacity, 0.72);
  will-change: transform, opacity;
  animation-delay: var(--petal-delay, 0s);
  transform: translate3d(0, 0, 0) rotate(var(--petal-start-rot, 0deg));
}
`;

const PETAL_LAYOUT_MARKER = /\.hero__petal\s*\{[^}]*position\s*:\s*absolute/i;

export function ensurePetalLayoutInStylesheet(css: string): string {
  if (!css || PETAL_LAYOUT_MARKER.test(css)) return css;
  return `${css.trim()}\n${HERO_PETAL_LAYOUT_CSS.trim()}\n`;
}
