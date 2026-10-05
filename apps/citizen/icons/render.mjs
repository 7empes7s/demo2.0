// Renders the app mark SVGs to the PNG icons in public/. Run once after changing an SVG:
//   NODE_PATH=<dir with playwright> node icons/render.mjs
// The PNGs are committed; the build does not run this.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await browser.newPage();
const jobs = [
  ["icon.svg", 192, "public/icon-192.png"],
  ["icon.svg", 512, "public/icon-512.png"],
  // iOS fills transparent corners with black and rounds the icon itself, so this one is full bleed.
  ["icon-maskable.svg", 180, "public/apple-touch-icon.png"],
  ["icon-maskable.svg", 512, "public/icon-maskable-512.png"],
];
for (const [svg, size, out] of jobs) {
  const src = readFileSync(new URL(svg, import.meta.url), "utf8");
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${src}`);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(out);
}
await browser.close();
