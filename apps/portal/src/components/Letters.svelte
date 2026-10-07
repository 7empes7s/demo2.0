<script lang="ts">
  /**
   * The printable enrolment letters of a fresh batch: one A4 page per code, the code once, then the
   * same words in each of the six letter languages, two columns by three rows. Hidden on screen; when
   * printing, the page shows only these letters (portal.css hides the rest). Moved to <body> so the
   * print rule can hide every other child of it.
   */
  import { LETTER_LANGS, letterText, RTL } from "../lib/letters.ts";

  let { codes, commune, site }: { codes: string[]; commune: string; site: string } = $props();

  const texts = $derived(LETTER_LANGS.map((l) => ({ lang: l, dir: (RTL.includes(l) ? "rtl" : "ltr") as "rtl" | "ltr", text: letterText(l, commune, site) })));
  const heading = $derived(commune.trim() || texts[0]?.text.no_commune || "");

  function toBody(node: HTMLElement) {
    document.body.append(node);
    return { destroy: () => node.remove() };
  }
</script>

<div class="letters" use:toBody aria-hidden="true">
  {#each codes as code (code)}
    <article class="letter">
      <header>
        <p class="commune">{heading}</p>
        <p class="site">{site}</p>
      </header>
      <div class="code">
        <span class="code-label">{#each texts as { lang, dir, text }, i (lang)}{#if i}{" · "}{/if}<bdi {dir} lang={lang}>{text.code}</bdi>{/each}</span>
        <span class="code-value">{code}</span>
      </div>
      <div class="parts">
        {#each texts as { lang, dir, text } (lang)}
          <section class="part" lang={lang} {dir}>
            <h2><span class="lang">{text.name}</span>{text.title}</h2>
            <p>{text.intro}</p>
            <ol>
              <li>{text.step_open}</li>
              <li>{text.step_code}</li>
            </ol>
            <p>{text.once} {text.private}</p>
          </section>
        {/each}
      </div>
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
    font-size: 9.4pt;
    line-height: 1.35;
    padding: 2mm 2mm 0;
    break-after: page;
    break-inside: avoid;
  }
  .letter:last-child { break-after: auto; }
  header { display: flex; justify-content: space-between; align-items: baseline; gap: 6mm; border-bottom: 1.5pt solid var(--ink); padding-bottom: 2mm; }
  .commune { color: var(--navy); font-size: 11pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin: 0; }
  .site { font-family: var(--mono); font-size: 10pt; margin: 0; }
  .code { border: 2pt solid var(--ink); padding: 4mm 6mm; margin: 5mm 0; display: grid; gap: 1.5mm; }
  .code-label { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.08em; }
  .code-value { font-family: var(--mono); font-size: 24pt; font-weight: 700; letter-spacing: 0.08em; }
  .parts { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm 7mm; }
  .part { break-inside: avoid; }
  /* Public Sans and the title face have no Arabic letters: name faces that do, before the browser's own. */
  .part:lang(ar), bdi:lang(ar) { font-family: "Noto Naskh Arabic", "Noto Sans Arabic", "Segoe UI", Tahoma, "Geeza Pro", sans-serif; }
  .part:lang(ar) { font-size: 10.5pt; }
  .part:lang(ar) h2, .part:lang(ar) .lang { font-family: inherit; letter-spacing: 0; }
  .part[dir="rtl"] ol { padding-left: 0; padding-right: 1.3em; }
  h2 { font-family: var(--serif); text-transform: uppercase; font-size: 14pt; line-height: 1.1; margin: 0 0 1.5mm; }
  .lang { display: block; font-family: var(--sans); font-size: 7.5pt; font-weight: 700; letter-spacing: 0.08em; color: var(--navy); margin-bottom: 0.8mm; }
  p { margin: 0 0 1.5mm; }
  ol { padding-left: 1.3em; margin: 0 0 1.5mm; }
  li { margin: 0 0 0.8mm; }

  @media print {
    .letters { display: block; }
  }
</style>
