<script lang="ts">
  import { MAX_CLAIM, type DocketItem, type FactCheckResult } from "@democracy2/companion";

  import type { FactChecker } from "../lib/client.ts";
  import { safeUrl } from "../lib/data.ts";
  import { CompanionFailure } from "../lib/errors.ts";
  import type { Key } from "../lib/i18n.ts";
  import { t } from "../lib/ui.svelte.ts";

  /** With an item, the claim is checked against that file; without, against every file. */
  let { checker, item, standalone = false }: { checker: FactChecker; item?: DocketItem; standalone?: boolean } = $props();

  let claim = $state("");
  let result = $state<FactCheckResult | null>(null);
  let busy = $state(false);
  let failure = $state<Key | null>(null);
  const uid = $props.id();

  function failureKey(e: unknown): Key {
    if (e instanceof CompanionFailure) {
      if (e.kind === "unavailable") return "check_unavailable";
      if (e.kind === "busy") return "error_busy";
      return "check_too_long";
    }
    return "error";
  }

  async function check(e: SubmitEvent) {
    e.preventDefault();
    const text = claim.trim();
    if (!text || busy) return;
    busy = true;
    failure = null;
    result = null;
    try {
      const answer = await checker.check(text, item);
      if (claim.trim() === text) result = answer; // the claim was edited meanwhile: not its answer
    } catch (err) {
      if (claim.trim() === text) failure = failureKey(err);
    } finally {
      busy = false;
    }
  }

  /** A verdict belongs to the claim it answered: editing the claim clears it. */
  function edited() {
    result = null;
    failure = null;
  }

  const graded = $derived(result?.result === "graded" ? result.grade : null);
</script>

<section class="card factcheck" class:standalone aria-labelledby={standalone ? "file-title" : `${uid}-h`}>
  {#if standalone}
    <p class="muted intro">{t("check_intro")}</p>
  {:else}
    <h3 id="{uid}-h" class="serif sub">{t("check_title")}</h3>
  {/if}
  <form onsubmit={check}>
    <textarea
      bind:value={claim}
      oninput={edited}
      rows={standalone ? 4 : 2}
      maxlength={MAX_CLAIM}
      placeholder={t("check_placeholder")}
      aria-label={t(standalone ? "check_open" : "check_title")}
    ></textarea>
    <button class="btn primary" disabled={busy || !claim.trim()}>{t("check_go")}</button>
  </form>
  <div aria-live="polite" class="status">
    {#if busy}<p class="muted pulse small" data-state="busy">{t("check_busy")}</p>{/if}
    {#if failure}<p class="notice small" data-state="failure">{t(failure)}</p>{/if}
    {#if result?.result === "no_record"}<p class="notice small" data-state="none">{t("check_none")}</p>{/if}
    {#if graded}<p class="sr-only">{t(`grade_${graded.grade}`)}. {t(`check_reason_${graded.grade}`)}</p>{/if}
  </div>
  {#if graded}
    <div class="verdict {graded.grade}" data-state="graded" data-grade={graded.grade}>
      <p class="grade"><span class="swatch" aria-hidden="true"></span>{t(`grade_${graded.grade}`)}</p>
      <p>{t(`check_reason_${graded.grade}`)}</p>
      <h4 class="label">{t("evidence")}</h4>
      <ul class="evidence">
        {#each graded.evidence as ev, i (i)}
          <li>
            <q>{ev.excerpt}</q>
            {#if safeUrl(ev.url)}
              <a class="small" href={safeUrl(ev.url)} target="_blank" rel="noopener">{t("check_document")} ↗</a>
            {/if}
          </li>
        {/each}
      </ul>
      <p class="muted small">{t("check_note")}</p>
      <details class="small">
        <summary>{t("tech_details")}</summary>
        <dl class="tech">
          <dt>claim_id</dt><dd class="mono">{graded.claim_id}</dd>
          <dt>checker_id</dt><dd class="mono">{graded.checker_id}</dd>
          <dt>model_version</dt><dd class="mono">{graded.model_version}</dd>
          {#each graded.evidence as ev, i (i)}
            {#if ev.locator}<dt>locator {i + 1}</dt><dd>{ev.locator}</dd>{/if}
          {/each}
        </dl>
      </details>
    </div>
  {/if}
</section>

<style>
  .factcheck { display: grid; gap: 12px; }
  .sub { font-size: 1.5rem; }
  .intro { margin: 0; max-width: 62ch; }
  form { display: grid; gap: 8px; justify-items: start; }
  textarea {
    width: 100%;
    resize: vertical;
    background: var(--surface);
    border: var(--rule) solid var(--line);
    padding: 0.6rem 0.8rem;
  }
  .status:empty { display: none; }
  .small { font-size: 0.86rem; margin: 0; }
  .notice {
    padding: 0.5rem 0.8rem;
    border: var(--rule) solid var(--line);
    background: var(--surface);
  }
  .verdict { display: grid; gap: 8px; padding: 12px 14px; border: var(--rule) solid var(--line); background: var(--surface); }
  .verdict p { margin: 0; max-width: 68ch; }
  .grade { display: flex; gap: 8px; align-items: center; font: 900 1.2rem var(--serif); text-transform: uppercase; }
  .swatch { flex: none; width: 12px; height: 12px; border: 2px solid var(--line); background: currentColor; }
  .green .grade { color: var(--green); }
  .yellow .grade { color: var(--yellow); }
  .red .grade { color: var(--red); }
  .evidence { margin: 0; padding-left: 1.1rem; display: grid; gap: 6px; }
  .evidence q { font-style: italic; margin-right: 6px; overflow-wrap: anywhere; }
  details summary { cursor: pointer; color: var(--muted); }
  .tech { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 12px; margin: 6px 0 0; }
  .tech dt { color: var(--muted); }
  .tech dd { margin: 0; overflow-wrap: anywhere; }
  @media (min-width: 960px) {
    .standalone { padding: 24px 28px; }
    .standalone form { grid-template-columns: minmax(0, 1fr) auto; align-items: end; }
  }
</style>
