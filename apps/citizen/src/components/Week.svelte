<script lang="ts">
  import type { DocketItem } from "@democracy2/companion";
  import { buildWeek, homeChoices, indexPlaces, placeName, topicList, type Entry, type Week } from "@democracy2/pulse";

  import { progressOf } from "../lib/arena.svelte.ts";
  import { routeOf, titleOf } from "../lib/data.ts";
  import { CHARTER, pulse, resetPulse, setHome, toggleTopic } from "../lib/pulse.svelte.ts";
  import { date, t, ui } from "../lib/ui.svelte.ts";
  import FileMeta from "./FileMeta.svelte";

  let {
    items,
    week,
    onopen,
    onall,
  }: {
    items: DocketItem[];
    week: Week;
    onopen: (route: string) => void;
    /** Show the full list (phones only: on a wide screen it is always beside this view). */
    onall: () => void;
  } = $props();

  const index = indexPlaces(CHARTER.places);
  const choices = homeChoices(CHARTER.places);
  const topics = $derived(topicList(items));
  // Everything below is computed here, from the list every device downloads. Nothing is sent.
  const list = $derived(
    buildWeek({ items, places: CHARTER.places, prefs: pulse.prefs, week, understood: (id) => !!progressOf(id)?.understood, budget: CHARTER.budget }),
  );
  const homeName = $derived(pulse.prefs.home ? placeName(index.get(pulse.prefs.home), ui.lang) : "");
  /** Only topics that are still in the list count; a topic the list dropped stays saved but is not shown. */
  const followed = $derived(pulse.prefs.topics.filter((x) => topics.includes(x)));
  /** The setup stays open while the resident picks, and opens by itself until a place is chosen. */
  let editing = $state(!pulse.prefs.home);
  const setup = $derived(editing || !pulse.prefs.home);
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

  {#if setup}
    <div class="card setup" data-testid="week-setup">
      <h3 class="serif">{t("week_setup_title")}</h3>
      <div class="setup-grid">
        <div class="field">
          <label class="label" for="home">{t("week_home_label")}</label>
          <select id="home" value={pulse.prefs.home ?? ""} onchange={(e) => setHome((e.currentTarget as HTMLSelectElement).value || null)}>
            <option value="">{t("week_home_pick")}</option>
            {#each choices.communes as p (p.id)}
              <option value={p.id}>{placeName(p, ui.lang)}</option>
            {/each}
            <optgroup label={t("week_home_other")}>
              {#each choices.regions as p (p.id)}
                <option value={p.id}>{t("week_home_canton", { canton: placeName(p, ui.lang) })}</option>
              {/each}
            </optgroup>
          </select>
          <p class="muted hint">{t("week_home_hint")}</p>
        </div>
        <fieldset class="field">
          <legend class="label">{t("week_topics_label")}</legend>
          <p class="muted hint">{t("week_topics_hint")}</p>
          <div class="topics">
            {#each topics as topic (topic)}
              <button class="btn chip" lang="fr" aria-pressed={pulse.prefs.topics.includes(topic)} onclick={() => toggleTopic(topic)}>{topic}</button>
            {:else}
              <p class="muted">{t("week_topics_none")}</p>
            {/each}
          </div>
        </fieldset>
      </div>
      <p class="private" data-testid="week-private"><span aria-hidden="true">🔒</span> {t("week_private")}</p>
      <div class="actions">
        {#if pulse.prefs.home}
          <button class="btn primary" onclick={() => (editing = false)}>{t("week_done")}</button>
        {/if}
        {#if pulse.prefs.home || pulse.prefs.topics.length}
          <button class="btn" onclick={() => { resetPulse(); editing = true; }}>{t("week_forget")}</button>
        {/if}
      </div>
    </div>
  {:else}
    <div class="summary card">
      <p class="who">
        <span class="label">{t("week_home_label")}</span>
        <strong>{homeName}</strong>
        <span class="muted">· {followed.length === 1 ? t("week_topics_one") : t("week_topics_many", { n: followed.length })}</span>
      </p>
      <button class="btn" onclick={() => (editing = true)}>{t("week_change")}</button>
      <p class="private small" data-testid="week-private"><span aria-hidden="true">🔒</span> {t("week_private")}</p>
    </div>
  {/if}

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
  .setup { display: grid; gap: 16px; border-color: var(--accent); }
  .setup h3 { font-size: 1.5rem; }
  .setup-grid { display: grid; gap: 16px; }
  .field { display: grid; gap: 6px; align-content: start; margin: 0; padding: 0; border: 0; min-width: 0; }
  select {
    width: 100%;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.6rem 0.8rem;
  }
  .hint { margin: 0; font-size: 0.85rem; }
  .topics { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { padding: 0.3rem 0.8rem; font-size: 0.85rem; font-weight: 500; max-width: 100%; white-space: normal; text-align: left; }
  .chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
  .chip[aria-pressed="true"]::before { content: "✓ "; }
  .private {
    margin: 0;
    padding: 0.55rem 0.8rem;
    border-radius: var(--radius);
    background: var(--surface-2);
    font-size: 0.9rem;
  }
  .private.small { font-size: 0.82rem; flex-basis: 100%; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .summary { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; }
  .summary p { margin: 0; }
  .summary .who { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; }
  .group { display: grid; gap: 8px; }
  .group-title { font-size: 1.05rem; font-weight: 700; display: flex; gap: 8px; align-items: baseline; margin: 0; }
  .count { color: var(--muted); font-weight: 400; }
  .small { font-size: 0.86rem; margin: 0; }
  .empty { margin: 0; padding: 12px 14px; border: 1px dashed var(--line); border-radius: var(--radius); color: var(--muted); font-size: 0.92rem; }
  .others summary { cursor: pointer; list-style-position: outside; }
  .others[open] summary { margin-bottom: 8px; }
  .entries { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .entry {
    display: grid;
    gap: 8px;
    height: 100%;
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--fg);
    text-decoration: none;
    transition: border-color 120ms;
  }
  .entry:hover { border-color: var(--accent); }
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
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); flex: none; }
  .tags { margin-left: auto; display: flex; gap: 6px; }
  .tag { flex: none; padding: 0.05rem 0.55rem; border-radius: 999px; font-size: 0.75rem; font-weight: 700; }
  .topic { background: var(--surface-2); color: var(--accent-fg); }
  .understood { background: var(--green-bg); color: var(--green); }
  .understood::before { content: "✓ "; }
  .foot { display: grid; gap: 8px; justify-items: start; border-top: 1px solid var(--line); padding-top: 16px; }
  .tech summary { cursor: pointer; }
  .tech p { margin: 6px 0 0; color: var(--muted); }

  @media (min-width: 720px) {
    .setup-grid { grid-template-columns: minmax(220px, 1fr) minmax(0, 2fr); gap: 24px; }
    .entries { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
  }
  /* The full list is beside this view on a wide screen. */
  @media (min-width: 960px) {
    .all { display: none; }
  }
</style>
