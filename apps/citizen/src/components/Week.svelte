<script lang="ts">
  import type { DocketItem } from "@democracy2/companion";
  import { buildWeek, indexPlaces, placeName, topicList, type Entry, type Week } from "@democracy2/pulse";

  import { progressOf } from "../lib/arena.svelte.ts";
  import { routeOf, titleOf } from "../lib/data.ts";
  import { CHARTER, pulse } from "../lib/pulse.svelte.ts";
  import { expandGroups } from "../lib/topics.ts";
  import { date, t, ui } from "../lib/ui.svelte.ts";
  import FileMeta from "./FileMeta.svelte";

  let {
    items,
    week,
    onopen,
    onall,
    onsettings,
  }: {
    items: DocketItem[];
    week: Week;
    onopen: (route: string) => void;
    /** Show the full list (phones only: on a wide screen it is always beside this view). */
    onall: () => void;
    /** Open the settings page, where the place and the topics are chosen. */
    onsettings: () => void;
  } = $props();

  const index = indexPlaces(CHARTER.places);
  const topics = $derived(topicList(items));
  /** The published names the chosen topic groups stand for, out of those in the list. */
  const followed = $derived(expandGroups(pulse.prefs.groups, topics));
  // Everything below is computed here, from the list every device downloads. Nothing is sent.
  const list = $derived(
    buildWeek({ items, places: CHARTER.places, prefs: { home: pulse.prefs.home, topics: followed }, week, understood: (id) => !!progressOf(id)?.understood, budget: CHARTER.budget }),
  );
  const homeName = $derived(pulse.prefs.home ? placeName(index.get(pulse.prefs.home), ui.lang) : "");
  const groupCount = $derived(pulse.prefs.groups.length);
  const weekNo = $derived(Number(week.id.slice(-2)));

  const WHEN_KEY = { meeting: "week_when_meeting", open: "week_when_open", filed: "week_when_filed", activity: "week_when_activity" } as const;
</script>

{#snippet entries(list: Entry<DocketItem>[])}
  <ol class="entries">
    {#each list as entry (entry.item.id)}
      {@const route = routeOf(entry.item)}
      <li>
        <a
          class="entry"
          href={`#${route}`}
          onclick={(e) => {
            e.preventDefault();
            onopen(route);
          }}
        >
          <span class="meta"><FileMeta item={entry.item} /></span>
          <span class="title" lang="fr">{titleOf(entry.item)}</span>
          <span class="when">
            {#if entry.when}
              <span class="dot" aria-hidden="true"></span>{t(WHEN_KEY[entry.when.kind], { date: date(entry.when.day) })}
            {:else}
              <span class="muted">{t("week_when_none")}</span>
            {/if}
            <span class="tags">
              {#if entry.onTopic}<span class="tag topic" data-tag="topic">{t("week_tag_topic")}</span>{/if}
              {#if entry.understood}<span class="tag understood" data-badge="understood">{t("arena_understood")}</span>{/if}
            </span>
          </span>
        </a>
      </li>
    {/each}
  </ol>
{/snippet}

<section class="week" aria-labelledby="week-title">
  <header class="head">
    <p class="label">{t("week_number", { n: weekNo })} · {date(week.start)} – {date(week.end)}</p>
    <h2 class="serif" id="week-title" tabindex="-1">{t("week_title")}</h2>
    <p class="muted intro">{t("week_intro")}</p>
  </header>

  <div class="summary card" data-testid="week-summary">
    {#if pulse.prefs.home}
      <dl class="who">
        <dt class="label">{t("week_home_label")}</dt>
        <dd><strong>{homeName}</strong></dd>
        <dt class="label">{t("week_topics_label")}</dt>
        <dd>{groupCount === 0 ? t("week_topics_zero") : groupCount}</dd>
      </dl>
      <button class="btn small" onclick={onsettings}>{t("week_change")}</button>
    {:else}
      <p class="who">{t("week_no_home")}</p>
      <button class="btn primary" onclick={onsettings}>{t("week_set_up")}</button>
    {/if}
    <p class="private small" data-testid="week-private"><span aria-hidden="true">🔒</span> {t("week_private_short")}</p>
  </div>

  {#if pulse.prefs.home}
    <section class="group" aria-labelledby="g-concerned">
      <h3 class="group-title" id="g-concerned">{t("week_concerned", { place: homeName })} <span class="count">{list.concerned.length}</span></h3>
      <p class="muted small">{t("week_concerned_hint", { place: homeName })}</p>
      {#if list.concerned.length}{@render entries(list.concerned)}{:else}<p class="empty">{t("week_none_here")}</p>{/if}
    </section>
  {/if}

  <section class="group" aria-labelledby="g-topics">
    <h3 class="group-title" id="g-topics">{t("week_knowledgeable")} <span class="count">{list.knowledgeable.length}</span></h3>
    <p class="muted small">{t("week_knowledgeable_hint")}</p>
    {#if list.knowledgeable.length}{@render entries(list.knowledgeable)}{:else}<p class="empty">{t(followed.length ? "week_none_topics" : "week_no_topics")}</p>{/if}
  </section>

  <section class="group" aria-labelledby="g-panels">
    <h3 class="group-title" id="g-panels">{t("week_panels")}</h3>
    <p class="empty">{t("week_panels_hint")}</p>
  </section>

  {#if list.others.length}
    <details class="group others" open>
      <summary class="group-title">{t("week_others")} <span class="count">{list.others.length}</span></summary>
      {@render entries(list.others)}
    </details>
  {/if}

  <footer class="foot">
    {#if list.budget !== null}<p class="muted small">{t("week_budget", { n: list.budget })}</p>{/if}
    <p class="muted small">{list.outside === 1 ? t("week_outside_one") : t("week_outside_many", { n: list.outside })}</p>
    <p class="muted small">{t("never_recommend")}</p>
    <button class="btn all" onclick={onall}>{t("back")}</button>
    <details class="tech">
      <summary class="muted small">{t("tech_details")}</summary>
      <p class="mono small">{week.id} · Europe/Luxembourg · Charter {CHARTER.version}</p>
    </details>
  </footer>
</section>

<style>
  .week { display: grid; gap: 20px; padding-top: 4px; }
  .head { display: grid; gap: 6px; }
  .head h2 { font-size: clamp(1.9rem, 5vw, 2.6rem); line-height: 1.1; }
  .head h2:focus { outline: none; }
  .head p { margin: 0; }
  .intro { max-width: 60ch; }
  .private {
    margin: 0;
    padding: 0.55rem 0.8rem;
    border: var(--rule) solid var(--line);
    background: var(--surface);
    font-size: 0.9rem;
  }
  .private.small { font-size: 0.82rem; flex-basis: 100%; }
  /* One short sheet: a label and its value per line, the button beside them, the promise under. */
  .summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px 12px; padding-block: 0.9rem; }
  .summary p, .summary dl, .summary dd { margin: 0; }
  .summary .who { min-width: 0; }
  dl.who { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; align-items: baseline; }
  dl.who dt, dl.who dd { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .summary .private { grid-column: 1 / -1; padding: 0; border: 0; background: none; color: var(--muted); }
  .group { display: grid; gap: 8px; }
  .group-title { font-size: 1.05rem; font-weight: 700; display: flex; gap: 8px; align-items: baseline; margin: 0; }
  .count { color: var(--muted); font-weight: 400; }
  .small { font-size: 0.86rem; margin: 0; }
  .empty { margin: 0; padding: 12px 14px; border: var(--rule) dashed var(--line); color: var(--muted); font-size: 0.92rem; }
  .others summary { cursor: pointer; list-style-position: outside; }
  .others[open] summary { margin-bottom: 8px; }
  .entries { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .entry {
    display: grid;
    gap: 8px;
    height: 100%;
    padding: 14px 16px;
    border: var(--rule) solid var(--line);
    background: var(--surface);
    color: var(--fg);
    text-decoration: none;
    transition: box-shadow 120ms;
  }
  .entry:hover { box-shadow: 5px 5px 0 0 var(--accent), 5px 5px 0 var(--rule) var(--backing); }
  .meta { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
  .title {
    font-weight: 600;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .when { font-size: 0.85rem; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; align-self: end; }
  .dot { width: 8px; height: 8px; border: 2px solid var(--line); background: var(--accent); flex: none; }
  .tags { margin-left: auto; display: flex; gap: 6px; }
  .tag { flex: none; padding: 0 6px; border: 2px solid var(--line); font: 700 0.75rem/1.5 var(--serif); text-transform: uppercase; letter-spacing: 0.02em; }
  .topic { background: var(--surface-2); color: var(--fg); }
  .understood { background: var(--accent); color: var(--accent-ink); border-color: var(--accent-line); }
  .understood::before { content: "✓ "; }
  .foot { display: grid; gap: 8px; justify-items: start; border-top: var(--rule) solid var(--line); padding-top: 16px; }
  .tech summary { cursor: pointer; }
  .tech p { margin: 6px 0 0; color: var(--muted); }

  @media (min-width: 720px) {
    .entries { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
  }
  /* The full list is beside this view on a wide screen. */
  @media (min-width: 960px) {
    .all { display: none; }
  }
</style>
