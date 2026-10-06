<script lang="ts">
  import { LANGS, type DocketItem, type DocketSnapshot, type Lang } from "@democracy2/companion";
  import { onMount, tick } from "svelte";

  import FileList from "./components/FileList.svelte";
  import FactCheck from "./components/FactCheck.svelte";
  import FileView from "./components/FileView.svelte";
  import Ideas from "./components/Ideas.svelte";
  import Week from "./components/Week.svelte";
  import { LocalClient, RemoteClient, RemoteFactChecker, RemoteIdeas, type CompanionClient, type FactChecker, type IdeasReader } from "./lib/client.ts";
  import { weekAt } from "@democracy2/pulse";

  import { loadSnapshot, luxembourgToday, placeOf, routeOf, sitesOf } from "./lib/data.ts";
  import { LANG_LABELS } from "./lib/i18n.ts";
  import { peel } from "./lib/look.ts";
  import { prefs } from "./lib/prefs.ts";
  import { findSample, SampleProvider } from "./lib/sample-provider.ts";
  import { date, setLang, t, ui } from "./lib/ui.svelte.ts";

  let snapshot = $state<DocketSnapshot | null>(null);
  let loadError = $state(false);
  /** undefined while we look for a model, null when there is none. */
  let client = $state<CompanionClient | null | undefined>(undefined);
  /** The claim checker, on the served app only: the shareable demo has no Provenance service. */
  let checker = $state<FactChecker | null>(null);
  /** The ideas list (Agora, read only), on the served app only, like the claim checker. */
  let ideasReader = $state<IdeasReader | null>(null);
  let route = $state(readRoute());
  let theme = $state<"light" | "dark" | null>(prefs.theme());
  let online = $state(navigator.onLine);
  const now = new Date();
  const today = luxembourgToday(now);
  /** This week's list (Pulse), built on this device. */
  const week = weekAt(now);
  const CHECK_ROUTE = "check";
  const IDEAS_ROUTE = "ideas";
  /** `#files`: the full list on a phone. With no route the app opens on this week's list. */
  const FILES_ROUTE = "files";
  /** Where a file's back button leads: the full list, or this week's list when opened from there. */
  let backTo = $state<string | null>(FILES_ROUTE);

  const selected = $derived<DocketItem | null>(
    snapshot && route ? (snapshot.items.find((i) => routeOf(i) === route) ?? null) : null,
  );

  /** `#check`: the claim checker on its own page. */
  const checking = $derived(route === CHECK_ROUTE && !!checker && !selected);
  /** `#ideas`: the ideas residents posted, read only. */
  const readingIdeas = $derived(route === IDEAS_ROUTE && !!ideasReader && !selected);

  /** The full list on its own (phones). On a wide screen it is always beside the other views. */
  const listing = $derived(route === FILES_ROUTE && !selected);

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

  function applyTheme(value: "light" | "dark" | null) {
    if (value) document.documentElement.dataset.theme = value;
    else delete document.documentElement.dataset.theme;
  }

  function toggleTheme() {
    const current = theme ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    theme = current === "dark" ? "light" : "dark";
    prefs.setTheme(theme);
    applyTheme(theme);
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
    applyTheme(theme);
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

    // In a claude.ai artifact the viewer's own Claude answers; elsewhere the Companion server does.
    findSample().then(async (sample) => {
      if (sample) {
        client = new LocalClient(new SampleProvider(sample));
        return;
      }
      checker = new RemoteFactChecker();
      ideasReader = new RemoteIdeas();
      try {
        const health = (await (await fetch("healthz")).json()) as { companion?: boolean };
        client = health.companion ? new RemoteClient() : null;
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

<div class="shell" class:has-file={!listing}>
  <header class="top">
    <button class="brand" onclick={() => open(null)}>
      <span class="mark" aria-hidden="true">§</span>
      <span class="serif name">{t("app_name")}</span>
    </button>
    <div class="tools">
      <label class="sr-only" for="lang">{t("language")}</label>
      <select id="lang" value={ui.lang} onchange={(e) => setLang((e.currentTarget as HTMLSelectElement).value as Lang)}>
        {#each LANGS as l (l)}
          <option value={l}>{LANG_LABELS[l]}</option>
        {/each}
      </select>
      <button class="icon" onclick={toggleTheme} aria-label={t("theme_toggle")} title={t("theme_toggle")}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path fill="currentColor" d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z" />
        </svg>
      </button>
    </div>
  </header>

  {#if !online}
    <p class="offline" role="status">{t("offline")}</p>
  {/if}

  {#if loadError}
    <p class="card notice">{t("error")}</p>
  {:else if !snapshot}
    <p class="muted pulse loading">…</p>
  {:else}
    <div class="layout">
      <aside class="list-pane">
        <div class="intro">
          <h1 class="serif" id="list-title" tabindex="-1">{t(both ? "agenda_title_both" : "agenda_title")}</h1>
          <p class="muted">{t(both ? "tagline_both" : "tagline")}</p>
          <div class="page-links">
            <button class="btn check-open" aria-current={!selected && !checking && !readingIdeas && !listing ? "page" : undefined} onclick={() => open(null)}>{t("week_open")}</button>
            {#if checker}
              <button class="btn check-open" aria-current={checking ? "page" : undefined} onclick={() => open(CHECK_ROUTE)}>{t("check_open")}</button>
            {/if}
            {#if ideasReader}
              <button class="btn check-open" aria-current={readingIdeas ? "page" : undefined} onclick={() => open(IDEAS_ROUTE)}>{t("ideas_open")}</button>
            {/if}
          </div>
        </div>
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
        {:else if checking && checker}
          <article class="check-page">
            <button class="back" onclick={() => open(FILES_ROUTE)}>← {t("back")}</button>
            <h2 class="serif" id="file-title" tabindex="-1">{t("check_open")}</h2>
            <FactCheck {checker} standalone />
            <p class="muted small">{t("never_recommend")}</p>
          </article>
        {:else if readingIdeas && ideasReader}
          <article class="check-page">
            <button class="back" onclick={() => open(FILES_ROUTE)}>← {t("back")}</button>
            <h2 class="serif" id="file-title" tabindex="-1">{t("ideas_open")}</h2>
            <Ideas reader={ideasReader} />
          </article>
        {:else}
          <Week items={snapshot.items} {week} onopen={openFile(null)} onall={() => open(FILES_ROUTE)} />
        {/if}
      </main>
    </div>
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
    border-bottom: 1px solid var(--line);
  }
  .offline {
    margin: 12px 0 0;
    padding: 0.5rem 0.8rem;
    border-radius: var(--radius);
    background: var(--yellow-bg);
    color: var(--yellow);
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
    border-radius: 8px;
    background: var(--accent);
    color: var(--accent-ink);
    font: 700 1.1rem/1 var(--serif);
  }
  .name { font-size: 1.45rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @media (max-width: 420px) {
    .name { font-size: 1.2rem; }
    select { max-width: 7.5rem; }
  }
  .tools { flex: none; display: flex; gap: 8px; align-items: center; }
  select, .icon {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.4rem 0.8rem;
    font-size: 0.9rem;
  }
  .icon { display: grid; place-items: center; padding: 0.45rem; cursor: pointer; }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 32px;
    padding-top: 20px;
  }
  .intro { display: grid; gap: 4px; margin-bottom: 16px; }
  .intro h1:focus { outline: none; }
  .intro h1 { font-size: clamp(1.9rem, 5vw, 2.4rem); line-height: 1.1; }
  .intro p { margin: 0; }
  .source-note { font-size: 0.82rem; margin-top: 16px; }
  .page-links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .check-open[aria-current="page"] { border-color: var(--accent); background: var(--surface-2); }
  .check-page { display: grid; gap: 16px; padding-top: 4px; }
  .check-page h2 { font-size: clamp(1.6rem, 4.2vw, 2.3rem); line-height: 1.15; margin: 0; }
  .check-page h2:focus { outline: none; }
  .check-page .small { font-size: 0.88rem; margin: 0; }
  .back {
    justify-self: start;
    background: none;
    border: 0;
    padding: 4px 0;
    color: var(--accent-fg);
    font-weight: 600;
    cursor: pointer;
  }
  .detail-pane { min-width: 0; }
  .loading, .notice { margin-top: 24px; }

  /* Phone: one pane at a time. */
  .shell.has-file .list-pane { display: none; }
  .shell:not(.has-file) .detail-pane { display: none; }

  /* Desktop: the agenda stays on the left while a file is open on the right. */
  @media (min-width: 960px) {
    .layout { grid-template-columns: minmax(320px, 400px) minmax(0, 1fr); gap: 40px; }
    .shell.has-file .list-pane, .shell:not(.has-file) .detail-pane { display: block; }
    .back { display: none; }
    .list-pane { position: sticky; top: 76px; align-self: start; max-height: calc(100vh - 92px); overflow-y: auto; padding-right: 8px; }
  }
</style>
