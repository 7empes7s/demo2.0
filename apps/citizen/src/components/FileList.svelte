<script lang="ts">
  import type { DocketItem } from "@democracy2/companion";

  import { groupFiles, kindOf, nextMeeting, placesOf, routeOf, stageOf, statusOf, titleOf, type Place, type TypeFilter } from "../lib/data.ts";
  import { date, t } from "../lib/ui.svelte.ts";
  import FileMeta from "./FileMeta.svelte";
  import StageTrack from "./StageTrack.svelte";

  let {
    items,
    today,
    selected,
    onopen,
  }: { items: DocketItem[]; today: string; selected: string | null; onopen: (n: string) => void } = $props();

  let filter = $state<TypeFilter>("all");
  let place = $state<"all" | Place>("all");
  let query = $state("");

  /** The place filter only appears when the snapshot covers more than one body. */
  const places = $derived(placesOf(items));
  const groups = $derived(groupFiles(items, today, { filter, place, query }));
  const PLACE_KEY = { chamber: "place_chamber", esch: "place_esch" } as const;
</script>

<div class="controls">
  <input type="search" bind:value={query} placeholder={t("search")} aria-label={t("search")} />
  <div class="chips" role="group" aria-label={t("group_filter")}>
    {#each [["all", "filter_all"], ["bill", "filter_bill"], ["other", "filter_other"]] as const as [value, key] (value)}
      <button class="btn chip" aria-pressed={filter === value} onclick={() => (filter = value)}>{t(key)}</button>
    {/each}
  </div>
  {#if places.length > 1}
    <div class="segmented" role="group" aria-label={t("group_place")}>
      <button class="seg" aria-pressed={place === "all"} onclick={() => (place = "all")}>{t("filter_all")}</button>
      {#each places as p (p)}
        <button class="seg" aria-pressed={place === p} onclick={() => (place = p)}>{t(PLACE_KEY[p])}</button>
      {/each}
    </div>
  {/if}
</div>

{#each groups as group (group.place)}
  <section class="group">
    {#if groups.length > 1}
      <h2 class="label place">{t(PLACE_KEY[group.place])} <span class="count">{group.items.length}</span></h2>
    {/if}
    <ol class="files">
      {#each group.items as item (item.id)}
        {@const meeting = nextMeeting(item, today)}
        {@const route = routeOf(item)}
        <li>
          <a
            class="file"
            class:current={selected === route}
            href={`#${route}`}
            aria-current={selected === route ? "page" : undefined}
            onclick={(e) => {
              e.preventDefault();
              onopen(route);
            }}
          >
            <span class="meta"><FileMeta {item} /></span>
            <span class="title" lang="fr">{titleOf(item)}</span>
            {#if kindOf(item) === "chamber"}<StageTrack stage={stageOf(item)} compact />{/if}
            <span class="when">
              {#if meeting}
                <span class="dot" aria-hidden="true"></span>{t("next_label")}: {date(meeting.date)}
              {:else}
                <span class="muted">{statusOf(item) ?? t("status_unknown")}</span>
              {/if}
            </span>
          </a>
        </li>
      {/each}
    </ol>
  </section>
{/each}

<style>
  .controls { display: grid; gap: 10px; margin-bottom: 12px; }
  input[type="search"] {
    width: 100%;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.55rem 1rem;
  }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { padding: 0.3rem 0.8rem; font-size: 0.85rem; }
  .segmented {
    display: flex;
    max-width: 100%;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--surface);
    padding: 3px;
    gap: 2px;
  }
  .seg {
    flex: 1 1 auto;
    min-width: 0;
    border: 0;
    border-radius: 999px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 0.85rem;
    padding: 0.35rem 0.6rem;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .seg[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); font-weight: 600; }
  .group { display: grid; gap: 8px; }
  .group + .group { margin-top: 20px; }
  .place { margin: 0; display: flex; gap: 8px; align-items: baseline; }
  .count { color: var(--muted); font-weight: 400; }
  .files { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .file {
    display: grid;
    gap: 8px;
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--fg);
    text-decoration: none;
    transition: border-color 120ms;
  }
  .file:hover { border-color: var(--accent); }
  .file.current { border-color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); }
  .meta { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
  .title {
    font-weight: 600;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .when { font-size: 0.85rem; display: flex; align-items: center; gap: 6px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); flex: none; }
</style>
