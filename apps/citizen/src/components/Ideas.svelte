<script lang="ts">
  import type { IdeasPage } from "@democracy2/companion";
  import { onMount } from "svelte";

  import type { IdeasReader } from "../lib/client.ts";
  import { CompanionFailure } from "../lib/errors.ts";
  import { LOCALES, type Key } from "../lib/i18n.ts";
  import { ageOf, pickText, supportKey } from "../lib/ideas.ts";
  import { date, t, ui } from "../lib/ui.svelte.ts";

  /** Read only: the list of ideas residents posted on Agora. Nothing here posts or supports. */
  let { reader, now = Date.now }: { reader: IdeasReader; now?: () => number } = $props();

  let page = $state<IdeasPage | null>(null);
  let busy = $state(true);
  let failure = $state<Key | null>(null);
  const uid = $props.id();

  async function load() {
    busy = true;
    failure = null;
    try {
      page = await reader.list();
    } catch (e) {
      page = null;
      failure = e instanceof CompanionFailure && e.kind === "busy" ? "ideas_busy" : "ideas_unavailable";
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    load();
  });

  const ideas = $derived(
    (page?.ideas ?? []).map((idea) => ({
      idea,
      title: pickText(idea.title, ui.lang),
      text: pickText(idea.text, ui.lang),
      age: ageOf(idea.created_at, now()),
    })),
  );
  const count = (n: number) => n.toLocaleString(LOCALES[ui.lang]);
</script>

<div class="ideas">
  <p class="muted intro">{t("ideas_intro")}</p>
  <p class="closed" data-state="closed">
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z" />
    </svg>
    <span>{t("ideas_closed")}</span>
  </p>

  <div aria-live="polite" class="status">
    {#if busy}
      <p class="muted pulse" data-state="loading">{t("ideas_loading")}</p>
    {:else if failure}
      <div class="notice" data-state="unavailable">
        <p>{t(failure)}</p>
        <button class="btn" onclick={load}>{t("ideas_retry")}</button>
      </div>
    {:else if page && page.ideas.length === 0}
      <div class="empty" data-state="empty">
        <p class="serif">{t("ideas_empty")}</p>
      </div>
    {/if}
  </div>

  {#if !busy && !failure && ideas.length}
    <ol class="list" data-state="list">
      {#each ideas as { idea, title, text, age } (idea.id)}
        <li class="card idea" data-tier={idea.scope_tier} aria-labelledby="{uid}-{idea.id}">
          <div class="meta">
            <span class="reach {idea.scope_tier}">{t(`reach_${idea.scope_tier}`)}</span>
            <span class="muted">{t(age.key, { n: age.n ?? 0, date: date(idea.created_at) })}</span>
          </div>
          {#if title}<h3 id="{uid}-{idea.id}" class="serif" lang={title.lang}>{title.text}</h3>{/if}
          {#if text}<p class="text" lang={text.lang}>{text.text}</p>{/if}
          <p class="support" data-support={idea.upvote_count === null ? "hidden" : idea.upvote_count}>
            {#if idea.upvote_count === null}
              <span class="muted">{t("support_hidden")}</span>
            {:else}
              {t(supportKey(ui.lang, idea.upvote_count), { n: count(idea.upvote_count) })}
            {/if}
          </p>
          <details class="small">
            <summary>{t("tech_details")}</summary>
            <dl class="tech">
              <dt>charter_version</dt><dd class="mono">{idea.charter_version}</dd>
              <dt>id</dt><dd class="mono">{idea.id}</dd>
              <dt>jurisdiction_id</dt><dd class="mono">{idea.jurisdiction_id}</dd>
              {#if idea.topic_ids.length}<dt>topic_ids</dt><dd class="mono">{idea.topic_ids.join(", ")}</dd>{/if}
              <dt>created_at</dt><dd class="mono">{idea.created_at}</dd>
            </dl>
          </details>
        </li>
      {/each}
    </ol>
  {/if}
  {#if page}
    <details class="small page-tech">
      <summary>{t("tech_details")}</summary>
      <dl class="tech"><dt>charter_version</dt><dd class="mono">{page.charter_version}</dd></dl>
    </details>
  {/if}
</div>

<style>
  .ideas { display: grid; gap: 16px; }
  .intro { margin: 0; max-width: 62ch; }
  .closed {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin: 0;
    padding: 0.7rem 0.9rem;
    border: var(--rule) solid var(--line);
    background: var(--surface);
    max-width: 68ch;
  }
  .closed svg { flex: none; margin-top: 2px; color: var(--accent-fg); }
  .status:empty { display: none; }
  .status p { margin: 0; }
  .notice {
    display: grid;
    gap: 10px;
    justify-items: start;
    padding: 0.8rem 0.9rem;
    border: var(--rule) solid var(--line);
    background: var(--surface);
  }
  .empty {
    display: grid;
    place-content: center;
    text-align: center;
    min-height: 160px;
    padding: 24px;
    border: var(--rule) dashed var(--line);
  }
  .empty .serif { font-size: 1.45rem; margin: 0; }
  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  .idea { display: grid; gap: 8px; align-content: start; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; font-size: 0.86rem; }
  .reach {
    font: 700 0.72rem/1.5 var(--serif);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 0 6px;
    border: 2px solid var(--line);
    background: var(--surface);
  }
  .reach.national { background: var(--accent); color: var(--accent-ink); border-color: var(--accent-line); }
  .reach.regional { background: var(--surface-2); }
  .idea h3 { font-size: 1.45rem; line-height: 1.2; overflow-wrap: anywhere; }
  .text { margin: 0; max-width: 68ch; white-space: pre-line; overflow-wrap: anywhere; }
  .support { margin: 0; font-weight: 600; font-size: 0.92rem; }
  .small { font-size: 0.86rem; }
  details summary { cursor: pointer; color: var(--muted); }
  .tech { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 12px; margin: 6px 0 0; }
  .tech dt { color: var(--muted); }
  .tech dd { margin: 0; overflow-wrap: anywhere; }
  /* Desktop: one column, so the ranked order reads top to bottom; roomier cards. */
  @media (min-width: 960px) {
    .list, .status { max-width: 820px; }
    .list { gap: 14px; }
    .idea { padding: 1.3rem 1.5rem; }
  }
</style>
