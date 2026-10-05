<script lang="ts">
  import type { Depth, DocketItem, Explanation } from "@democracy2/companion";

  import type { CompanionClient } from "../lib/client.ts";
  import { t, ui } from "../lib/ui.svelte.ts";
  import SourceList from "./SourceList.svelte";

  let { item, client }: { item: DocketItem; client: CompanionClient } = $props();

  let depth = $state<Depth>("short");
  let result = $state<Explanation | null>(null);
  let busy = $state(false);
  let failed = $state(false);
  let open = $state<string | null>(null);

  async function run() {
    busy = true;
    failed = false;
    open = null;
    try {
      result = await client.explain(item, ui.lang, depth);
    } catch {
      failed = true;
    } finally {
      busy = false;
    }
  }

  const label = (n: number) => result?.sources.find((s) => s.n === n);
</script>

<section class="card explain" aria-labelledby="explain-h">
  <h3 id="explain-h" class="serif sub">{t("explain_title")}</h3>
  <div class="row">
    <div class="depths" role="group">
      {#each [["short", "depth_short"], ["standard", "depth_standard"], ["deep", "depth_deep"]] as const as [value, key] (value)}
        <button class="btn small" aria-pressed={depth === value} onclick={() => (depth = value)}>{t(key)}</button>
      {/each}
    </div>
    <button class="btn primary" onclick={run} disabled={busy}>{t("explain_go")}</button>
  </div>

  {#if busy}
    <p class="muted pulse">{t("explain_busy")}</p>
  {:else if failed}
    <p class="error">{t("error")}</p>
  {:else if result}
    <div class="answer" aria-live="polite">
      {#if result.headline}<p class="headline">{result.headline}</p>{/if}
      {#each result.sections as section, si (si)}
        <div class="section">
          {#if section.heading}<h4 class="label">{section.heading}</h4>{/if}
          <p>
            {#each section.sentences as sentence, i (i)}
              {@const key = `${si}.${i}`}
              <span class:unverified={sentence.sources.length > 0 && !sentence.verified} title={sentence.sources.length && !sentence.verified ? t("unverified") : undefined}>{sentence.text}</span>
              {#each sentence.sources as n (n)}
                <button
                  class="cite mono"
                  aria-expanded={open === key}
                  aria-label={t("view_source", { n })}
                  onclick={() => (open = open === key ? null : key)}>{n}</button
                >
              {/each}
              {#if open === key}
                <span class="quote" role="note">
                  {#if sentence.quote}<q lang="fr">{sentence.quote}</q>{/if}
                  <span class="muted small">
                    {sentence.verified ? `✓ ${t("quote_found")}` : t("unverified")}
                    {#each sentence.sources as n (n)}
                      · <a href={label(n)?.url} target="_blank" rel="noopener">{t("view_source", { n })}: {label(n)?.label}</a>
                    {/each}
                  </span>
                </span>
              {/if}
              {" "}
            {/each}
          </p>
        </div>
      {/each}
      <p class="muted small">{t("verified_note")}</p>
      <SourceList sources={result.sources} />
      <p class="muted tiny mono">{t("made_with", { prompt: result.provenance.prompt_version, model: result.provenance.model })}</p>
    </div>
  {/if}
</section>

<style>
  .explain { display: grid; gap: 14px; }
  .sub { font-size: 1.5rem; }
  .row { display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; align-items: center; }
  .depths { display: flex; flex-wrap: wrap; gap: 6px; }
  .small { font-size: 0.85rem; }
  .btn.small { padding: 0.3rem 0.8rem; }
  .tiny { font-size: 0.72rem; margin: 0; }
  .answer { display: grid; gap: 14px; }
  .headline { font-size: 1.15rem; font-weight: 600; margin: 0; }
  .section p { margin: 4px 0 0; max-width: 68ch; }
  .unverified { text-decoration: underline dotted var(--muted); text-underline-offset: 4px; }
  .cite {
    display: inline-grid;
    place-items: center;
    min-width: 1.35rem;
    height: 1.35rem;
    margin-left: 2px;
    padding: 0 4px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--accent-fg);
    font-size: 0.72rem;
    vertical-align: text-top;
    cursor: pointer;
  }
  .cite[aria-expanded="true"] { border-color: var(--accent); }
  .quote {
    display: grid;
    gap: 4px;
    margin: 8px 0;
    padding: 10px 12px;
    border-left: 3px solid var(--accent);
    background: var(--surface-2);
    border-radius: 0 8px 8px 0;
  }
  .quote q { font-style: italic; }
  .error { color: var(--red); margin: 0; }
</style>
