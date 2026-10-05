<script lang="ts">
  import type { DocketItem } from "@democracy2/companion";

  import { matches, nextMeeting, sortItems, stageOf, statusOf, titleOf } from "../lib/data.ts";
  import { date, t } from "../lib/ui.svelte.ts";
  import StageTrack from "./StageTrack.svelte";

  let {
    items,
    today,
    selected,
    onopen,
  }: { items: DocketItem[]; today: string; selected: string | null; onopen: (n: string) => void } = $props();

  let filter = $state<"all" | "bill" | "other">("all");
  let query = $state("");

  const shown = $derived(
    sortItems(items, today).filter(
      (i) => (filter === "all" || (filter === "bill" ? i.type === "bill" : i.type !== "bill")) && matches(i, query),
    ),
  );
</script>

<div class="controls">
  <input type="search" bind:value={query} placeholder={t("search")} aria-label={t("search")} />
  <div class="chips" role="group">
    {#each [["all", "filter_all"], ["bill", "filter_bill"], ["other", "filter_other"]] as const as [value, key] (value)}
      <button class="btn chip" aria-pressed={filter === value} onclick={() => (filter = value)}>{t(key)}</button>
    {/each}
  </div>
</div>

<ol class="files">
  {#each shown as item (item.id)}
    {@const meeting = nextMeeting(item, today)}
    <li>
      <a
        class="file"
        class:current={selected === item.number}
        href={`#${item.number}`}
        aria-current={selected === item.number ? "page" : undefined}
        onclick={(e) => {
          e.preventDefault();
          onopen(item.number);
        }}
      >
        <span class="meta">
          <span class="mono no">N° {item.number}</span>
          <span class="label">{item.type_label ?? t(item.type === "bill" ? "type_bill" : "type_other")}</span>
        </span>
        <span class="title">{titleOf(item)}</span>
        <StageTrack stage={stageOf(item)} compact />
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
  .no { color: var(--accent-fg); font-weight: 500; font-size: 0.9rem; }
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
