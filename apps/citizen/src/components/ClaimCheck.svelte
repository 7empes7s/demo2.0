<script lang="ts">
  import type { ClaimCheck, DocketItem } from "@democracy2/companion";

  import type { CompanionClient } from "../lib/client.ts";
  import { safeUrl } from "../lib/data.ts";
  import { errorKey } from "../lib/errors.ts";
  import type { Key } from "../lib/i18n.ts";
  import { t, ui } from "../lib/ui.svelte.ts";

  let { item, client }: { item: DocketItem; client: CompanionClient } = $props();

  let claim = $state("");
  let result = $state<ClaimCheck | null>(null);
  let busy = $state(false);
  let failure = $state<Key | null>(null);

  async function check(e: SubmitEvent) {
    e.preventDefault();
    if (!claim.trim() || busy) return;
    busy = true;
    failure = null;
    try {
      result = await client.claim(item, ui.lang, claim.trim());
    } catch (e) {
      failure = errorKey(e);
    } finally {
      busy = false;
    }
  }
</script>

<section class="card claim" aria-labelledby="cl-h">
  <h3 id="cl-h" class="serif sub">{t("check_title")}</h3>
  <form onsubmit={check}>
    <textarea bind:value={claim} rows="2" maxlength="500" placeholder={t("check_placeholder")} aria-label={t("check_title")}></textarea>
    <button class="btn primary" disabled={busy || !claim.trim()}>{t("check_go")}</button>
  </form>
  <div aria-live="polite">
    {#if busy}<p class="muted pulse small">{t("check_busy")}</p>{/if}
    {#if failure}<p class="error small">{t(failure)}</p>{/if}
    {#if result && !busy}<p class="sr-only">{t(`grade_${result.grade}`)}. {result.explanation}</p>{/if}
  </div>
  {#if result && !busy}
    <div class="verdict {result.grade}">
      <p class="grade">
        <span class="swatch" aria-hidden="true"></span>{t(`grade_${result.grade}`)}
      </p>
      <p>{result.explanation}</p>
      {#if result.downgraded}<p class="muted small">{t("downgraded")}</p>{/if}
      {#if result.evidence.length}
        <h4 class="label">{t("evidence")}</h4>
        <ul>
          {#each result.evidence as ev, i (i)}
            <li>
              <q lang="fr">{ev.quote}</q>
              {#if safeUrl(ev.url)}<a class="small" href={safeUrl(ev.url)} target="_blank" rel="noopener">{t("view_source", { n: ev.source })} ↗</a>{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>

<style>
  .claim { display: grid; gap: 12px; }
  .sub { font-size: 1.5rem; }
  form { display: grid; gap: 8px; justify-items: start; }
  textarea {
    width: 100%;
    resize: vertical;
    background: var(--surface);
    border: var(--rule) solid var(--line);
    padding: 0.6rem 0.8rem;
  }
  .small { font-size: 0.86rem; margin: 0; }
  .verdict { display: grid; gap: 8px; padding: 12px 14px; border: var(--rule) solid var(--line); background: var(--surface); }
  .verdict p { margin: 0; max-width: 68ch; }
  .grade { display: flex; gap: 8px; align-items: center; font: 900 1.2rem var(--serif); text-transform: uppercase; }
  .swatch { width: 12px; height: 12px; border: 2px solid var(--line); background: currentColor; }
  .green .grade { color: var(--green); }
  .yellow .grade { color: var(--yellow); }
  .red .grade { color: var(--red); }
  ul { margin: 0; padding-left: 1.1rem; display: grid; gap: 6px; }
  li q { font-style: italic; margin-right: 6px; }
  .error { color: var(--red); }
</style>
