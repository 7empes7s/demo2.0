<script lang="ts">
  import type { DocketItem, FileArgument, FileArguments } from "@democracy2/companion";
  import { onMount } from "svelte";

  import { councillorsOf, groupOf, linkOf, roleOf, sideOf, viewOf, type Tab } from "../lib/arguments.ts";
  import { ArgumentsFailure, type ArgumentsReader } from "../lib/client.ts";
  import type { Key } from "../lib/i18n.ts";
  import { date, t } from "../lib/ui.svelte.ts";

  /**
   * Read only: what residents and council groups argued on this file (Commons). Nothing here rates
   * or posts: both wait for secure sign-in, and the sheet below says so instead of a button.
   */
  let { item, reader }: { item: DocketItem; reader: ArgumentsReader } = $props();

  let list = $state<FileArguments | null>(null);
  let savedAt = $state<string | null>(null);
  let busy = $state(true);
  let failure = $state<Key | null>(null);
  let offline = $state(false);
  let tab = $state<Tab>("both");
  const uid = $props.id();

  const FAILURES: Record<ArgumentsFailure["kind"], Key> = {
    off: "args_off",
    unavailable: "args_unavailable",
    busy: "args_busy",
    offline: "args_offline_none",
  };

  async function load() {
    busy = true;
    failure = null;
    offline = false;
    try {
      const read = await reader.forFile(item.id);
      list = read.list;
      savedAt = read.savedAt;
    } catch (e) {
      list = null;
      failure = e instanceof ArgumentsFailure ? FAILURES[e.kind] : "args_unavailable";
      offline = e instanceof ArgumentsFailure && e.kind === "offline";
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    load();
  });

  const view = $derived(list ? viewOf(list, tab) : null);
  const TABS: [Tab, Key][] = [
    ["for", "args_for"],
    ["against", "args_against"],
    ["both", "args_both"],
  ];
  const sideKey = (a: FileArgument): Key | null => {
    const side = sideOf(a);
    return side === "for" ? "args_for" : side === "against" ? "args_against" : null;
  };
  const roleText = (a: FileArgument) => {
    const role = roleOf(a);
    if (!role) return null;
    return "raw" in role ? { text: role.raw, lang: "en" } : { text: t(role.key, role.vars), lang: undefined };
  };
</script>

{#snippet tag(a: FileArgument)}
  {@const key = sideKey(a)}
  {#if key}<span class="tag side {sideOf(a)}">{t(key)}</span>{:else if a.kind === "proposal"}<span class="tag">{t("args_tag_idea")}</span>{/if}
{/snippet}

{#snippet sheet(a: FileArgument)}
  {@const role = roleText(a)}
  {@const link = linkOf(a)}
  <li class="card arg" aria-labelledby="{uid}-{a.id}">
    <p class="who" id="{uid}-{a.id}">
      {@render tag(a)}
      {#if role}<span class="role" lang={role.lang}>{role.text}</span>{/if}
    </p>
    <p class="text">{a.text}</p>
    {#if a.strong_both_sides || a.status === "needs more ratings"}
      <p class="rated">
        {#if a.strong_both_sides}<span class="stamp" data-rated="both">{t("args_strong_both")}</span>{/if}
        {#if a.status === "needs more ratings"}<span class="muted" data-rated="more">{t("args_needs_ratings")}</span>{/if}
      </p>
    {/if}
    {#if link}<p class="src"><a href={link} target="_blank" rel="noopener noreferrer">{t("open_source")} ↗</a></p>{/if}
  </li>
{/snippet}

<section class="arguments" aria-labelledby="{uid}-h" data-testid="arguments">
  <h3 id="{uid}-h" class="serif sub">{t("args_title")}</h3>
  <p class="muted intro">{t("args_intro")}</p>

  <div aria-live="polite" class="status">
    {#if busy}
      <p class="muted pulse" data-state="loading">{t("args_loading")}</p>
    {:else if failure}
      <div class="notice" data-state={offline ? "offline" : "unavailable"}>
        {#if offline}<p class="h">{t("args_offline_title")}</p>{/if}
        <p>{t(failure)}</p>
        {#if failure !== "args_off"}<button class="btn small" onclick={load}>{t("args_retry")}</button>{/if}
      </div>
    {:else if savedAt}
      <div class="notice" data-state="saved">
        <p class="h">{t("args_offline_title")}</p>
        <p>{t("args_offline_saved", { date: date(savedAt.slice(0, 10)) })}</p>
      </div>
    {/if}
  </div>

  {#if list && view}
    {#if list.arguments.length === 0}
      <div class="empty" data-state="empty"><p class="serif">{t("args_empty")}</p></div>
    {:else}
      {#if view.sided}
        <div class="segmented" role="group" aria-label={t("args_tabs_label")}>
          {#each TABS as [value, key] (value)}
            <button class="seg" aria-pressed={tab === value} data-tab={value} onclick={() => (tab = value)}>{t(key)} <span class="mono">{view.counts[value]}</span></button>
          {/each}
        </div>
      {/if}
      <p class="ranking small muted" data-ranked={list.ranker ? "yes" : "no"}>{t(list.ranker ? "args_ranked" : "args_unranked")}</p>

      {#if view.anyReasons}
        <div class="block" data-block="reasons">
          <h4 class="label">{t("args_reasons")}</h4>
          {#if view.reasons.length}
            <ol class="list">{#each view.reasons as a (a.id)}{@render sheet(a)}{/each}</ol>
          {:else}
            <p class="muted">{t("args_none_side")}</p>
          {/if}
        </div>
      {/if}

      {#if view.ideas.length}
        <div class="block" data-block="ideas">
          <h4 class="label">{t("args_ideas")}</h4>
          <ol class="list">{#each view.ideas as a (a.id)}{@render sheet(a)}{/each}</ol>
        </div>
      {/if}

      {#if view.positions.length}
        <div class="block" data-block="positions">
          <h4 class="label">{t("args_votes")}</h4>
          <p class="muted small">{t("args_votes_note")}</p>
          <ul class="card flat positions">
            {#each view.positions as a (a.id)}
              {@const group = groupOf(a)}
              {@const n = councillorsOf(a)}
              {@const link = linkOf(a)}
              <li class="position">
                {@render tag(a)}
                <span class="group" lang={group ? undefined : "en"}>{group ?? a.attribution ?? a.text}</span>
                <span class="voted">{t(sideOf(a) === "for" ? "args_voted_for" : sideOf(a) === "against" ? "args_voted_against" : "args_tag_idea")}{#if n !== null}<span class="muted">{" · "}{t("args_councillors", { n })}</span>{/if}</span>
                {#if link}<a class="small" href={link} target="_blank" rel="noopener noreferrer">{t("open_source")} ↗</a>{/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {/if}

    <div class="card flat signin" data-state="signin">
      <p class="h">{t("args_signin_title")}</p>
      <p class="small">{t("args_signin_text")}</p>
    </div>
  {/if}
</section>

<style>
  .arguments { display: grid; gap: 14px; border-top: var(--rule) solid var(--line); padding-top: 12px; min-width: 0; }
  .sub { font-size: 1.5rem; margin: 0; }
  .intro { margin: 0; max-width: 62ch; }
  .status:empty { display: none; }
  .status p { margin: 0; }
  .notice {
    display: grid;
    gap: 6px;
    justify-items: start;
    padding: 0.8rem 0.9rem;
    border: var(--rule) solid var(--line);
    background: var(--surface);
  }
  .h { font-weight: 700; margin: 0; }
  .empty { display: grid; place-content: center; text-align: center; min-height: 120px; padding: 20px; border: var(--rule) dashed var(--line); }
  .empty .serif { font-size: 1.3rem; margin: 0; }
  .segmented { display: flex; max-width: 100%; border: var(--rule) solid var(--line); background: var(--surface); }
  .seg {
    flex: 1 1 0;
    min-width: 0;
    min-height: 44px;
    border: 0;
    border-right: var(--rule) solid var(--line);
    background: none;
    color: var(--fg);
    font: 700 0.85rem/1.1 var(--serif);
    text-transform: uppercase;
    padding: 0.35rem 0.5rem;
    cursor: pointer;
  }
  .seg:last-child { border-right: 0; }
  .seg[aria-pressed="true"] { background: var(--pressed-bg); color: var(--pressed-fg); }
  .seg .mono { font-size: 0.8rem; }
  .ranking { margin: 0; }
  .small { font-size: 0.86rem; }
  .block { display: grid; gap: 8px; min-width: 0; }
  .block p { margin: 0; }
  .label { margin: 0; }
  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  .arg { display: grid; gap: 8px; align-content: start; min-width: 0; }
  .arg p { margin: 0; }
  .who { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; font-size: 0.86rem; }
  .role { color: var(--muted); overflow-wrap: anywhere; }
  .text { white-space: pre-line; overflow-wrap: anywhere; max-width: 68ch; }
  .tag {
    flex: none;
    padding: 0 6px;
    border: 2px solid var(--line);
    background: var(--surface-2);
    font: 700 0.75rem/1.5 var(--serif);
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--fg);
  }
  /* The two sides at the same weight, told apart by colour alone: amber, and the sheet's ink. Neither looks like the right one. */
  .tag.side.for { background: var(--accent); color: var(--accent-ink); border-color: var(--accent-line); }
  .tag.side.against { background: var(--fg); color: var(--surface); border-color: var(--fg); }
  .rated { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 0.86rem; }
  .stamp { display: inline-block; padding: 0 6px; border: 2px solid var(--line); font-weight: 700; }
  :global(:root[data-motion="on"]) .stamp { animation: stamp 0.5s 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.2) backwards; }
  .src { font-size: 0.9rem; }
  /* One tag column for every row, as wide as the widest tag. */
  .positions { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0; }
  .position {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    gap: 2px 10px;
    align-items: baseline;
    padding: 8px 12px;
  }
  .position + .position { border-top: 2px solid var(--line); }
  .position .tag { grid-row: span 2; align-self: center; justify-self: start; }
  .position .group { font-weight: 700; overflow-wrap: anywhere; }
  .position .voted { font-size: 0.9rem; }
  .position a { grid-column: 2; }
  .signin { display: grid; gap: 4px; }
  .signin p { margin: 0; }
  @media (min-width: 960px) {
    .list, .positions, .segmented, .status, .signin { max-width: 820px; }
    .arg { padding: 1.2rem 1.4rem; }
  }
</style>
