// Put a Docket snapshot inside the single-file build, so the page works with no server.
//   node scripts/embed.mjs <snapshot.json> [out.html] [--fragment]
// --fragment drops the doctype/html/head/body wrapper, for hosts that add their own
// (a claude.ai artifact): title, fonts and styles come first, then the app.
import { readFileSync, writeFileSync } from "node:fs";

const [snapshotPath, outPath = "dist-single/index.embedded.html", flag] = process.argv.slice(2);
if (!snapshotPath) {
  console.error("usage: node scripts/embed.mjs <snapshot.json> [out.html] [--fragment]");
  process.exit(2);
}

const html = readFileSync("dist-single/index.html", "utf8");
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
// JSON inside <script> must not be able to close the tag.
const data = JSON.stringify(snapshot).replace(/</g, "\\u003c");
const tag = `<script type="application/json" id="snapshot">${data}</script>`;

let out;
if (flag === "--fragment") {
  const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? "";
  const body = html.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? "";
  const title = head.match(/<title>[\s\S]*?<\/title>/)?.[0] ?? "";
  const styles = head.match(/<style[\s\S]*?<\/style>/g) ?? [];
  const fonts = head.match(/<link[^>]+fonts\.googleapis\.com[^>]*>/g) ?? [];
  const scripts = head.match(/<script[\s\S]*?<\/script>/g) ?? [];
  out = [title, ...styles, ...fonts, tag, body.trim(), ...scripts].join("\n");
} else {
  // A function replacement: `$` sequences in document text must stay literal.
  out = html.replace("</head>", () => `${tag}\n</head>`);
}
writeFileSync(outPath, out);
console.log(`${outPath}: ${(out.length / 1024).toFixed(0)} KB, ${snapshot.items.length} files`);
