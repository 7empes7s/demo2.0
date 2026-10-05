<script lang="ts">
  import { LANGS, type DocketItem, type DocketSnapshot, type Lang } from "@democracy2/companion";
  import { onMount, tick } from "svelte";

  import FileList from "./components/FileList.svelte";
  import FileView from "./components/FileView.svelte";
  import { LocalClient, RemoteClient, type CompanionClient } from "./lib/client.ts";
  import { loadSnapshot, luxembourgToday } from "./lib/data.ts";
  import { LANG_LABELS } from "./lib/i18n.ts";
  import { prefs } from "./lib/prefs.ts";
  import { findSample, SampleProvider } from "./lib/sample-provider.ts";
  import { date, setLang, t, ui } from "./lib/ui.svelte.ts";

  let snapshot = $state<DocketSnapshot | null>(null);
  let loadError = $state(false);
  /** undefined while we look for a model, null when there is none. */
  let client = $state<CompanionClient | null | undefined>(undefined);
  let route = $state(readRoute());
  let theme = $state<"light" | "dark" | null>(prefs.theme());
  const today = luxembourgToday();

  const selected = $derived<DocketItem | null>(
    snapshot && route ? (snapshot.items.find((i) => i.number === route) ?? null) : null,
  );

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

  async function open(number: string | null) {
    if (number) location.hash = number;
    else history.pushState(null, "", location.pathname + location.search);
    route = number ?? "";
    window.scrollTo({ top: 0 });
    // Move focus to what just appeared, so keyboard and screen-reader users land on it.
    await tick();
    document.getElementById(number ? "file-title" : "list-title")?.focus({ preventScroll: true });
  }

  onMount(() => {
    applyTheme(theme);
    document.documentElement.lang = ui.lang;
    const onHash = () => (route = readRoute());
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);

    loadSnapshot()
      .then((s) => (snapshot = s))
      .catch(() => (loadError = true));

    // In a claude.ai artifact the viewer's own Claude answers; elsewhere the Companion server does.
    findSample().then(async (sample) => {
      if (sample) {
        client = new LocalClient(new SampleProvider(sample));
        return;
      }
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
    };
  });
</script>

<div class="shell" class:has-file={!!selected}>
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

  {#if loadError}
    <p class="card notice">{t("error")}</p>
  {:else if !snapshot}
    <p class="muted pulse loading">…</p>
  {:else}
    <div class="layout">
      <aside class="list-pane">
        <div class="intro">
          <h1 class="serif" id="list-title" tabindex="-1">{t("agenda_title")}</h1>
          <p class="muted">{t("tagline")}</p>
        </div>
        <FileList items={snapshot.items} {today} selected={selected?.number ?? null} onopen={open} />
        <p class="muted source-note">{t("data_note", { date: date(snapshot.generated_at) })}</p>
      </aside>
      <main class="detail-pane">
        {#if selected}
          <FileView item={selected} {client} {today} onback={() => open(null)} />
        {:else}
          <div class="empty">
            <p class="serif">{t("pick_file")}</p>
            <p class="muted">{t("never_recommend")}</p>
          </div>
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
  .detail-pane { min-width: 0; }
  .empty { display: none; }
  .loading, .notice { margin-top: 24px; }

  /* Phone: one pane at a time. */
  .shell.has-file .list-pane { display: none; }
  .shell:not(.has-file) .detail-pane { display: none; }

  /* Desktop: the agenda stays on the left while a file is open on the right. */
  @media (min-width: 960px) {
    .layout { grid-template-columns: minmax(320px, 400px) minmax(0, 1fr); gap: 40px; }
    .shell.has-file .list-pane, .shell:not(.has-file) .detail-pane { display: block; }
    .list-pane { position: sticky; top: 76px; align-self: start; max-height: calc(100vh - 92px); overflow-y: auto; padding-right: 8px; }
    .empty {
      display: grid;
      gap: 8px;
      place-content: center;
      text-align: center;
      min-height: 50vh;
      border: 1px dashed var(--line);
      border-radius: var(--radius);
      padding: 32px;
    }
    .empty .serif { font-size: 1.6rem; margin: 0; }
    .empty p { margin: 0; }
  }
</style>
