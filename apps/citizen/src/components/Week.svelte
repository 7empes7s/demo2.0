<script lang="ts">
  import type { DocketItem } from "@democracy2/companion";
  import { buildWeek, indexPlaces, placeName, topicList, type Entry, type Week } from "@democracy2/pulse";

  import { progressOf } from "../lib/arena.svelte.ts";
  import { routeOf, titleOf } from "../lib/data.ts";
  import { CHARTER, pulse } from "../lib/pulse.svelte.ts";
  import { expandGroups } from "../lib/topics.ts";
  import { langOf, tx } from "../lib/translations.svelte.ts";
  import OriginalToggle from "./OriginalToggle.svelte";
  import { shortDay } from "../lib/i18n.ts";
  import { date, t, ui } from "../lib/ui.svelte.ts";
  import FileMeta from "./FileMeta.svelte";

  let {
    items,
    week,
    today,
    intro,
    onopen,
    onsettings,
  }: {
    items: DocketItem[];
    week: Week;
    /** Today on the Luxembourg calendar: its files are marked "Today". */
    today: string;
    /** One line on what the app covers. */
    intro: string;
    onopen: (route: string) => void;
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
      {@const day = entry.when?.day ?? null}
      {@const tile = day ? shortDay(ui.lang, day) : null}
      <li>
        <a
          class="entry"
          class:today={day === today}
          class:past={!!day && day < today}
          href={`#${route}`}
          onclick={(e) => {
            e.preventDefault();
            onopen(route);
          }}
        >
          <span class="tile" aria-hidden="true">
            {#if tile}
              <span class="d">{tile.day}</span><span class="m">{day === today ? t("week_today") : tile.month}</span>
            {:else}
              <span class="d">–</span>
            {/if}
          </span>
          <span class="body">
            <span class="meta"><FileMeta item={entry.item} brief /></span>
            <span class="title" lang={langOf(titleOf(entry.item))}>{tx(titleOf(entry.item))}</span>
            <span class="when">
              {#if entry.when}
                {#if day === today}<strong>{t("week_today")}</strong> ·{/if}
                {t(WHEN_KEY[entry.when.kind], { date: date(entry.when.day) })}
              {:else}
                <span class="muted">{t("week_when_none")}</span>
              {/if}
              <span class="tags">
                {#if entry.onTopic}<span class="tag topic" data-tag="topic">{t("week_tag_topic")}</span>{/if}
                {#if entry.understood}<span class="tag understood" data-badge="understood">{t("arena_understood")}</span>{/if}
              </span>
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
    <p class="muted intro">{intro}</p>
    <OriginalToggle />
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
      {#if list.concerned.length}{@render entries(list.concerned)}{:else}<p class="empty">{t("week_none_here")}</p>{/if}
    </section>
  {/if}

  {#if list.knowledgeable.length}
    <section class="group" aria-labelledby="g-topics">
      <h3 class="group-title" id="g-topics">{t("week_knowledgeable")} <span class="count">{list.knowledgeable.length}</span></h3>
      {@render entries(list.knowledgeable)}
    </section>
  {:else if !pulse.prefs.groups.length}
    <button class="more-topics" onclick={onsettings}>＋ {t("week_pick_topics")}</button>
  {/if}

  {#if list.others.length}
    <details class="group others" open={!pulse.prefs.home}>
      <summary class="group-title">{t("week_others")} <span class="count">{list.others.length}</span></summary>
      {@render entries(list.others)}
    </details>
  {/if}

  <footer class="foot">
    <p class="muted small">{list.outside === 1 ? t("week_outside_one") : t("week_outside_many", { n: list.outside })}</p>
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
  /* One short sheet: a label and its value per line, the button beside them, the promise under. */
  .summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px 12px; padding-block: 0.9rem; }
  .summary p, .summary dl, .summary dd { margin: 0; }
  .summary .who { min-width: 0; }
  dl.who { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; align-items: baseline; }
  dl.who dt, dl.who dd { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .summary .private { grid-column: 1 / -1; font-size: 0.82rem; color: var(--muted); }
  .group { display: grid; gap: 10px; }
  .group-title { font-size: 1.15rem; font-weight: 700; display: flex; gap: 8px; align-items: baseline; margin: 0; }
  .count {
    display: inline-grid;
    place-items: center;
    min-width: 1.6em;
    padding: 0 6px;
    border: 2px solid var(--line);
    font: 700 0.8rem/1.5 var(--serif);
    color: var(--fg);
  }
  .small { font-size: 0.86rem; margin: 0; }
  .empty { margin: 0; color: var(--muted); font-size: 0.92rem; }
  .more-topics {
    justify-self: start;
    background: none;
    border: 0;
    padding: 6px 0;
    color: var(--fg);
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .others summary { cursor: pointer; list-style-position: outside; padding-block: 6px; }
  .others[open] summary { margin-bottom: 4px; }
  .entries { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  /* A file in a list: a calendar tile for its day, then where it is from, its title and why it is here. */
  .entry {
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr);
    gap: 14px;
    height: 100%;
    padding: 12px 14px 12px 12px;
    border: var(--rule) solid var(--line);
    background: var(--surface);
    color: var(--fg);
    text-decoration: none;
    transition: box-shadow 120ms;
  }
  .entry:hover, .entry:focus-visible { box-shadow: 5px 5px 0 0 var(--accent), 5px 5px 0 var(--rule) var(--backing); }
  .entry.today { box-shadow: 6px 6px 0 0 var(--accent), 6px 6px 0 var(--rule) var(--backing); }
  .tile {
    align-self: start;
    display: grid;
    justify-items: center;
    padding: 6px 0 5px;
    border: 2px solid var(--line);
    background: var(--surface-2);
    color: var(--fg);
    line-height: 1;
  }
  .tile .d { font: 900 1.55rem/1 var(--serif); }
  .tile .m { margin-top: 3px; font: 700 0.68rem/1.1 var(--serif); text-transform: uppercase; letter-spacing: 0.03em; max-width: 48px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .today .tile { background: var(--accent); color: var(--accent-ink); border-color: var(--accent-line); }
  .past .tile { background: none; color: var(--muted); }
  .body { display: grid; gap: 6px; min-width: 0; }
  .meta { display: flex; gap: 8px; align-items: baseline; }
  .title {
    font-weight: 600;
    font-size: 1.02rem;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .when { font-size: 0.85rem; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; color: var(--muted); }
  .when strong { color: var(--fg); }
  .tags { margin-left: auto; display: flex; gap: 6px; }
  .tag { flex: none; padding: 0 6px; border: 2px solid var(--line); font: 700 0.75rem/1.5 var(--serif); text-transform: uppercase; letter-spacing: 0.02em; color: var(--fg); }
  .topic { background: var(--surface-2); color: var(--fg); }
  .understood { background: var(--accent); color: var(--accent-ink); border-color: var(--accent-line); }
  .understood::before { content: "✓ "; }
  .foot { display: grid; gap: 8px; justify-items: start; border-top: var(--rule) solid var(--line); padding-top: 14px; }
  .tech summary { cursor: pointer; }
  .tech p { margin: 6px 0 0; color: var(--muted); }

  @media (min-width: 720px) {
    .entries { grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
  }
</style>
