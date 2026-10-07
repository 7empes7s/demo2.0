<script lang="ts">
  /**
   * The printable enrolment letters of a fresh batch: one A4 page per code. Hidden on screen; when
   * printing, the page shows only these letters (portal.css hides the rest). Moved to <body> so the
   * print rule can hide every other child of it.
   */
  import { letterText } from "../lib/letters.ts";
  import type { Lang } from "../lib/types.ts";

  let { codes, lang, commune, site }: { codes: string[]; lang: Lang; commune: string; site: string } = $props();

  const text = $derived(letterText(lang, commune, site));

  function toBody(node: HTMLElement) {
    document.body.append(node);
    return { destroy: () => node.remove() };
  }
</script>

<div class="letters" use:toBody lang={lang} aria-hidden="true">
  {#each codes as code (code)}
    <article class="letter">
      <p class="commune">{commune.trim() || text.no_commune}</p>
      <h1>{text.title}</h1>
      <p>{text.intro}</p>
      <ol>
        <li>{text.step_open}</li>
        <li>{text.step_code}</li>
      </ol>
      <div class="code">
        <span class="code-label">{text.code}</span>
        <span class="code-value">{code}</span>
      </div>
      <p>{text.once}</p>
      <p class="no-name">{text.private}</p>
    </article>
  {/each}
</div>

<style>
  /* Ink on paper whatever the screen theme: --ink and --navy are the same in light and dark. */
  .letters { display: none; }
  .letter {
    box-sizing: border-box;
    color: var(--ink);
    background: none;
    font-family: var(--sans);
    font-size: 12pt;
    line-height: 1.45;
    padding: 6mm 4mm;
    break-after: page;
  }
  .letter:last-child { break-after: auto; }
  .commune { color: var(--navy); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 14mm; }
  h1 { font-family: var(--serif); text-transform: uppercase; font-size: 26pt; line-height: 1.15; margin: 0 0 8mm; }
  ol { padding-left: 1.4em; margin: 6mm 0; }
  li { margin: 0 0 3mm; }
  .code { border: 2pt solid var(--ink); padding: 6mm 8mm; margin: 10mm 0; display: grid; gap: 2mm; }
  .code-label { font-size: 10pt; text-transform: uppercase; letter-spacing: 0.08em; }
  .code-value { font-family: var(--mono); font-size: 24pt; font-weight: 700; letter-spacing: 0.08em; }
  .no-name { font-size: 10pt; margin-top: 10mm; }

  @media print {
    .letters { display: block; }
  }
</style>
