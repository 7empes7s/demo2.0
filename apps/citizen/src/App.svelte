<script lang="ts">
  import type { DocketItem, DocketSnapshot } from "@democracy2/companion";
  import { onMount, tick } from "svelte";

  import DeskIdeas from "./components/DeskIdeas.svelte";
  import Feedback from "./components/Feedback.svelte";
  import FileList from "./components/FileList.svelte";
  import FactCheck from "./components/FactCheck.svelte";
  import FileView from "./components/FileView.svelte";
  import Icon from "./components/Icon.svelte";
  import Ideas from "./components/Ideas.svelte";
  import More, { type Section } from "./components/More.svelte";
  import Procedures from "./components/Procedures.svelte";
  import Settings from "./components/Settings.svelte";
  import Votes from "./components/Votes.svelte";
  import Week from "./components/Week.svelte";
  import Welcome from "./components/Welcome.svelte";
  import { LocalClient, RemoteClient, RemoteFactChecker, RemoteIdeas, type CompanionClient, type FactChecker, type IdeasReader } from "./lib/client.ts";
  import { weekAt } from "@democracy2/pulse";

  import { loadSnapshot, luxembourgToday, placeOf, routeOf, sitesOf } from "./lib/data.ts";
  import { RemoteDesk, type About, type DeskClient } from "./lib/desk.ts";
  import { peel } from "./lib/look.ts";
  import { pulse } from "./lib/pulse.svelte.ts";
  import { findSample, SampleProvider } from "./lib/sample-provider.ts";
  import { applyTheme, theme } from "./lib/theme.svelte.ts";
  import { loadTranslations } from "./lib/translations.svelte.ts";
  import { date, t, ui } from "./lib/ui.svelte.ts";

  let snapshot = $state<DocketSnapshot | null>(null);
  let loadError = $state(false);
  /** undefined while we look for a model, null when there is none. */
  let client = $state<CompanionClient | null | undefined>(undefined);
  /** The claim checker, on the served app only: the shareable demo has no Provenance service. */
  let checker = $state<FactChecker | null>(null);
  /** The ideas list (Agora, read only), on the served app only, like the claim checker. */
  let ideasReader = $state<IdeasReader | null>(null);
  /** The commune's desk (procedures, ideas, feedback, votes), when the served app's healthz says it is up. */
  let desk = $state<DeskClient | null>(null);
  /** What a feedback message is about, when the form was opened from a procedure or an idea. */
  let feedbackAbout = $state<{ about: About; title: string } | null>(null);
  let route = $state(readRoute());
  let online = $state(navigator.onLine);
  const now = new Date();
  const today = luxembourgToday(now);
  /** This week's list (Pulse), built on this device. */
  const week = weekAt(now);
  const CHECK_ROUTE = "check";
  const IDEAS_ROUTE = "ideas";
  const PROCEDURES_ROUTE = "procedures";
  const FEEDBACK_ROUTE = "feedback";
  const VOTES_ROUTE = "votes";
  /** `#files`: the full list on a phone. With no route the app opens on this week's list. */
  const FILES_ROUTE = "files";
  /** `#settings`: language, appearance, where you live and the topics followed. */
  const SETTINGS_ROUTE = "settings";
  /** `#more`: every other page, each with one line on what it is for. */
  const MORE_ROUTE = "more";
  /** Where a file's back button leads: the full list, or this week's list when opened from there. */
  let backTo = $state<string | null>(FILES_ROUTE);

  const selected = $derived<DocketItem | null>(
    snapshot && route ? (snapshot.items.find((i) => routeOf(i) === route) ?? null) : null,
  );

  /** `#check`: the claim checker on its own page. */
  const checking = $derived(route === CHECK_ROUTE && !!checker && !selected);
  /** `#ideas`: the ideas residents posted, on the commune's desk when it is up, else Agora's read-only list. */
  const readingIdeas = $derived(route === IDEAS_ROUTE && (!!desk || !!ideasReader) && !selected);
  /** The desk's own pages: `#procedures`, `#feedback`, `#votes`. */
  const deskPage = $derived(desk && !selected && (route === PROCEDURES_ROUTE || route === FEEDBACK_ROUTE || route === VOTES_ROUTE) ? route : null);

  /** The full list on its own (phones). On a wide screen it is always beside the other views. */
  const listing = $derived(route === FILES_ROUTE && !selected);
  const settings = $derived(route === SETTINGS_ROUTE && !selected);
  const more = $derived(route === MORE_ROUTE && !selected);
  /** This week's list: the page the app opens on. */
  const atWeek = $derived(!selected && !checking && !readingIdeas && !deskPage && !listing && !settings && !more);
  /** The pages reached from "More", which keep that tab lit and lead back to it. */
  const inMore = $derived(more || settings || checking || !!deskPage);
  const hasIdeas = $derived(!!ideasReader || !!desk);
  const sections = $derived<Section[]>([
    ...(checker ? [{ route: CHECK_ROUTE, icon: "check", title: "check_open", line: "more_check" } as const] : []),
    ...(desk
      ? ([
          { route: PROCEDURES_ROUTE, icon: "procedures", title: "procedures_open", line: "more_procedures" },
          { route: VOTES_ROUTE, icon: "votes", title: "votes_open", line: "more_votes" },
          { route: FEEDBACK_ROUTE, icon: "feedback", title: "feedback_open", line: "more_feedback" },
        ] as const)
      : []),
    { route: SETTINGS_ROUTE, icon: "settings", title: "settings_title", line: "more_settings" },
  ]);
  /** First visit: the welcome steps take the whole screen until they are finished or skipped.
   * Read once at start, so choosing a place inside the steps does not end them early. */
  let firstVisit = $state(!pulse.prefs.done);
  const welcoming = $derived(firstVisit && !selected);

  function openSection(target: string) {
    if (target === FEEDBACK_ROUTE) feedbackAbout = null;
    return open(target);
  }

  /** From a procedure or an idea to the feedback form, with the message's subject filled in. */
  function sendFeedbackAbout(about: About, title: string) {
    feedbackAbout = { about, title };
    open(FEEDBACK_ROUTE);
  }

  /** Once Esch files are in the snapshot, the headings name both bodies. */
  const both = $derived(!!snapshot?.items.some((i) => placeOf(i) === "esch"));

  function readRoute(): string {
    const raw = location.hash.replace(/^#/, "");
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  /** Open a file from the full list or from this week's list; its back button returns there. */
  function openFile(from: string | null) {
    return (target: string) => {
      backTo = from;
      return open(target);
    };
  }

  async function open(target: string | null) {
    if (target) location.hash = target;
    else history.pushState(null, "", location.pathname + location.search);
    // Under the Affichage look the old screen peels off and the new one is pasted (see lib/look.ts).
    await new Promise<void>((done) =>
      peel(document.documentElement, async () => {
        route = target ?? "";
        await tick();
        done();
      }),
    );
    window.scrollTo({ top: 0 });
    // Move focus to what just appeared, so keyboard and screen-reader users land on it.
    const focus = target === FILES_ROUTE ? "list-title" : target ? "file-title" : "week-title";
    document.getElementById(focus)?.focus({ preventScroll: true });
  }

  onMount(() => {
    applyTheme(theme.value);
    document.documentElement.lang = ui.lang;
    const onHash = () => peel(document.documentElement, async () => { route = readRoute(); await tick(); });
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    const onNetwork = () => (online = navigator.onLine);
    window.addEventListener("online", onNetwork);
    window.addEventListener("offline", onNetwork);

    loadSnapshot()
      .then((s) => (snapshot = s))
      .catch(() => (loadError = true));
    // Every language in one file, fetched by every device alike: it says nothing about the resident.
    void loadTranslations();

    // In a claude.ai artifact the viewer's own Claude answers; elsewhere the Companion server does.
    findSample().then(async (sample) => {
      if (sample) {
        client = new LocalClient(new SampleProvider(sample));
        return;
      }
      checker = new RemoteFactChecker();
      ideasReader = new RemoteIdeas();
      try {
        const health = (await (await fetch("healthz")).json()) as { companion?: boolean; desk?: boolean };
        client = health.companion ? new RemoteClient() : null;
        desk = health.desk === true ? new RemoteDesk() : null;
      } catch {
        client = null;
      }
    });

    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
      window.removeEventListener("online", onNetwork);
      window.removeEventListener("offline", onNetwork);
    };
  });
</script>

{#snippet nav(where: "top" | "bottom")}
  <nav class="nav nav-{where}" aria-label={t("nav_label")}>
    <button class="tab" aria-current={atWeek || (selected && backTo === null) ? "page" : undefined} onclick={() => open(null)}><Icon name="week" /><span>{t("week_open")}</span></button>
    <button class="tab files-tab" aria-current={listing || (selected && backTo === FILES_ROUTE) ? "page" : undefined} onclick={() => open(FILES_ROUTE)}><Icon name="files" /><span>{t("nav_files")}</span></button>
    {#if hasIdeas}
      <button class="tab" aria-current={readingIdeas ? "page" : undefined} onclick={() => open(IDEAS_ROUTE)}><Icon name="ideas" /><span>{t("nav_ideas")}</span></button>
    {/if}
    <button class="tab" aria-current={inMore ? "page" : undefined} onclick={() => open(MORE_ROUTE)}><Icon name="more" /><span>{t("nav_more")}</span></button>
  </nav>
{/snippet}

<div class="shell" class:has-file={!listing} class:with-nav={!welcoming && !!snapshot}>
  <header class="top">
    <button class="brand" onclick={() => open(null)}>
      <span class="mark" aria-hidden="true">§</span>
      <span class="serif name">{t("app_name")}</span>
    </button>
    {#if !welcoming && snapshot}{@render nav("top")}{/if}
    {#if !welcoming}
      <button class="btn small gear" aria-current={settings ? "page" : undefined} onclick={() => open(SETTINGS_ROUTE)}>
        <Icon name="settings" size={18} />
        <span>{t("settings_open")}</span>
      </button>
    {/if}
  </header>

  {#if !online}
    <p class="offline" role="status">{t("offline")}</p>
  {/if}

  {#if loadError}
    <p class="card notice">{t("error")}</p>
  {:else if !snapshot}
    <!-- Blank sheets in the shape of the week while the list loads; the cut line marches. -->
    <div class="skeleton" role="status" aria-label={t("loading")}>
      <span class="sk-line pulse"></span>
      {#each [0, 1, 2] as i (i)}<span class="sk-sheet"></span>{/each}
    </div>
  {:else if welcoming}
    <Welcome items={snapshot.items} ondone={() => { firstVisit = false; open(null); }} />
  {:else}
    <div class="layout">
      <aside class="list-pane">
        <h1 class="serif list-title" id="list-title" tabindex="-1">{t("back")}</h1>
        <FileList items={snapshot.items} {today} selected={selected ? routeOf(selected) : null} onopen={openFile(FILES_ROUTE)} />
        <p class="muted source-note">{t("data_note", { sites: sitesOf(snapshot), date: date(snapshot.generated_at) })}</p>
      </aside>
      <main class="detail-pane">
        {#if selected}
          <FileView
            item={selected}
            items={snapshot.items}
            {client}
            {checker}
            {today}
            backLabel={t(backTo === FILES_ROUTE ? "back" : "week_open")}
            onback={() => open(backTo)}
          />
        {:else if more}
          <article class="check-page">
            <h2 class="serif" id="file-title" tabindex="-1">{t("nav_more")}</h2>
            <More {sections} onopen={openSection} />
          </article>
        {:else if settings}
          <article class="check-page">
            <button class="back" onclick={() => open(MORE_ROUTE)}>← {t("nav_more")}</button>
            <h2 class="serif" id="file-title" tabindex="-1">{t("settings_title")}</h2>
            <Settings items={snapshot.items} />
          </article>
        {:else if checking && checker}
          <article class="check-page">
            <button class="back" onclick={() => open(MORE_ROUTE)}>← {t("nav_more")}</button>
            <h2 class="serif" id="file-title" tabindex="-1">{t("check_open")}</h2>
            <FactCheck {checker} standalone />
            <p class="muted small">{t("never_recommend")}</p>
          </article>
        {:else if readingIdeas && desk}
          <article class="check-page">
            <h2 class="serif" id="file-title" tabindex="-1">{t("ideas_open")}</h2>
            <DeskIdeas client={desk} onfeedback={sendFeedbackAbout} />
          </article>
        {:else if readingIdeas && ideasReader}
          <article class="check-page">
            <h2 class="serif" id="file-title" tabindex="-1">{t("ideas_open")}</h2>
            <Ideas reader={ideasReader} />
          </article>
        {:else if deskPage && desk}
          <article class="check-page">
            <button class="back" onclick={() => open(MORE_ROUTE)}>← {t("nav_more")}</button>
            <h2 class="serif" id="file-title" tabindex="-1">{t(deskPage === PROCEDURES_ROUTE ? "procedures_open" : deskPage === VOTES_ROUTE ? "votes_open" : "feedback_open")}</h2>
            {#if deskPage === PROCEDURES_ROUTE}
              <Procedures client={desk} onfeedback={sendFeedbackAbout} />
            {:else if deskPage === VOTES_ROUTE}
              <Votes client={desk} />
            {:else}
              <Feedback client={desk} about={feedbackAbout} onclearabout={() => (feedbackAbout = null)} />
            {/if}
          </article>
        {:else}
          <Week items={snapshot.items} {week} {today} intro={t(both ? "tagline_both" : "tagline")} onopen={openFile(null)} onsettings={() => open(SETTINGS_ROUTE)} />
        {/if}
      </main>
    </div>
    {@render nav("bottom")}
  {/if}
</div>

<style>
  .shell {
    max-width: 1320px;
    margin: 0 auto;
    padding-inline: 16px;
    padding-block: 0 48px;
  }
  .top {
    position: sticky;
    top: env(safe-area-inset-top, 0px);
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-block: 12px;
    background: var(--bg);
    border-bottom: var(--rule) solid var(--line);
  }
  .offline {
    margin: 12px 0 0;
    padding: 0.5rem 0.8rem;
    border: var(--rule) solid var(--line);
    background: var(--surface);
    font-size: 0.9rem;
  }
  .brand {
    min-width: 0;
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: 10px;
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
  }
  .mark {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: var(--rule) solid var(--ink);
    background: var(--accent);
    color: var(--accent-ink);
    font: 900 1.1rem/1 var(--serif);
  }
  .name { font-size: 1.45rem; font-family: var(--serif); font-weight: 900; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @media (max-width: 420px) {
    .name { font-size: 1.2rem; }
  }
  .gear { flex: none; display: flex; align-items: center; gap: 6px; padding: 0.4rem 0.7rem; }
  .gear[aria-current="page"] { background: var(--pressed-bg); border-color: var(--pressed-bg); color: var(--pressed-fg); }
  @media (max-width: 420px) {
    .gear span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  }

  /* The sections: a bar along the bottom of a phone, under the thumb; a row in the header on a desktop.
     Each tab is an icon with its name under or beside it, never an icon alone. */
  .nav { display: flex; }
  .tab {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: none;
    border: 0;
    color: var(--fg);
    font: 700 0.95rem/1.1 var(--sans, inherit);
    cursor: pointer;
    white-space: nowrap;
  }
  .tab[aria-current="page"] { color: var(--fg); }
  .nav-top { gap: 4px; }
  .nav-top .tab { padding: 0.5rem 0.8rem; border: var(--rule) solid transparent; }
  .nav-top .tab:hover { border-color: var(--line); }
  .nav-top .tab[aria-current="page"] { background: var(--pressed-bg); border-color: var(--pressed-bg); color: var(--pressed-fg); }
  .nav-bottom {
    position: fixed;
    inset: auto 0 0 0;
    z-index: 6;
    padding-bottom: env(safe-area-inset-bottom, 0px);
    background: var(--bg);
    border-top: var(--rule) solid var(--line);
  }
  .nav-bottom .tab {
    flex: 1 1 0;
    min-width: 0;
    flex-direction: column;
    gap: 4px;
    min-height: 62px;
    padding: 8px 2px 6px;
    font-size: 0.78rem;
    position: relative;
  }
  .nav-bottom .tab span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  /* The lit tab: an amber bar on top and the icon on amber, readable without colour too (bold, bar). */
  .nav-bottom .tab[aria-current="page"]::before { content: ""; position: absolute; inset: -2px 18% auto; height: 4px; background: var(--accent); border: 2px solid var(--accent-line); border-top: 0; }
  .nav-bottom .tab[aria-current="page"] :global(.icon) { background: var(--accent); color: var(--accent-ink); outline: 3px solid var(--accent); }
  .nav-bottom .tab:not([aria-current="page"]) { color: var(--muted); font-weight: 600; }

  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
    padding-top: 20px;
  }
  .list-title { font-size: clamp(1.7rem, 5vw, 2.2rem); line-height: 1.1; margin: 0 0 14px; }
  .list-title:focus { outline: none; }
  .source-note { font-size: 0.82rem; margin-top: 16px; }
  .check-page { display: grid; gap: 16px; padding-top: 4px; }
  .check-page h2 { font-size: clamp(1.6rem, 4.2vw, 2.3rem); line-height: 1.15; margin: 0; }
  .check-page h2:focus { outline: none; }
  .check-page .small { font-size: 0.88rem; margin: 0; }
  .back {
    justify-self: start;
    background: none;
    border: 0;
    padding: 4px 0;
    color: var(--fg);
    font-weight: 600;
    cursor: pointer;
  }
  .detail-pane { min-width: 0; }
  .notice { margin-top: 24px; }
  .skeleton { display: grid; gap: 12px; padding-top: 28px; }
  .sk-line { display: block; width: 40%; height: 2.2rem; }
  .sk-sheet { display: block; height: 104px; border: var(--rule) solid var(--line); background: var(--surface); opacity: 0.6; }
  .sk-sheet:nth-child(3) { opacity: 0.45; }
  .sk-sheet:nth-child(4) { opacity: 0.3; }
  @media (prefers-reduced-motion: no-preference) {
    /* A tab pressed goes flat under the thumb; the tab it lights pastes its amber square on. */
    .tab :global(.icon) { transition: transform 0.12s linear; }
    .tab:active :global(.icon) { transform: translateY(2px); }
    .nav-bottom .tab[aria-current="page"] :global(.icon) { animation: paste 0.4s cubic-bezier(0.2, 0.9, 0.3, 1.2) both; }
    .nav-bottom .tab[aria-current="page"]::before { animation: paste 0.4s cubic-bezier(0.2, 0.9, 0.3, 1.2) both; }
  }

  /* Phone: one page at a time, the sections at the bottom. */
  @media (max-width: 959px) {
    .nav-top { display: none; }
    .shell.with-nav { padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px)); }
    .shell.has-file .list-pane { display: none; }
    .shell:not(.has-file) .detail-pane { display: none; }
  }

  /* Desktop: every file on the left, the page on the right, the sections in the header. */
  @media (min-width: 960px) {
    .nav-bottom, .files-tab { display: none; }
    .layout { grid-template-columns: minmax(320px, 400px) minmax(0, 1fr); gap: 40px; }
    .list-pane { position: sticky; top: 76px; align-self: start; max-height: calc(100vh - 92px); overflow-y: auto; padding-right: 8px; }
    .list-title { font-size: 1.6rem; }
    .shell:not(.has-file) .detail-pane { display: block; }
  }
</style>
