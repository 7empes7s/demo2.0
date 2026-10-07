<script lang="ts">
  /** The shell: sign-in, then a top bar, a left nav of the sections the person's role opens, and the work area. */
  import { onMount, type Component } from "svelte";

  import AuditLog from "./components/AuditLog.svelte";
  import AuditModel from "./components/AuditModel.svelte";
  import AuditSummary from "./components/AuditSummary.svelte";
  import AuditVotes from "./components/AuditVotes.svelte";
  import Codes from "./components/Codes.svelte";
  import Ideas from "./components/Ideas.svelte";
  import Inbox from "./components/Inbox.svelte";
  import Procedures from "./components/Procedures.svelte";
  import Settings from "./components/Settings.svelte";
  import SignIn from "./components/SignIn.svelte";
  import StaffPage from "./components/StaffPage.svelte";
  import Votes from "./components/Votes.svelte";
  import { commune, loadCommune } from "./lib/commune.svelte.ts";
  import { UI_LANG_LABELS, UI_LANGS, type Key, type UiLang } from "./lib/i18n.ts";
  import { navigate, route, syncRoute } from "./lib/route.svelte.ts";
  import { canOpen, homeOf, type Section, session, signOut } from "./lib/session.svelte.ts";
  import { applyTheme, roleName, setLang, t, toggleTheme, ui } from "./lib/ui.svelte.ts";

  const GROUPS: { label: Key; items: { section: Section; label: Key }[] }[] = [
    { label: "nav_operator", items: [{ section: "inbox", label: "nav_inbox" }, { section: "ideas", label: "nav_ideas" }, { section: "procedures", label: "nav_procedures" }, { section: "votes", label: "nav_votes" }] },
    { label: "nav_admin", items: [{ section: "staff", label: "nav_staff" }, { section: "codes", label: "nav_codes" }, { section: "settings", label: "nav_settings" }] },
    { label: "nav_audit", items: [{ section: "audit", label: "nav_audit_log" }, { section: "audit-votes", label: "nav_audit_votes" }, { section: "audit-model", label: "nav_audit_model" }, { section: "audit-summary", label: "nav_audit_summary" }] },
  ];

  const PAGES: Record<Section, Component<{ arg: string | null }>> = {
    inbox: Inbox,
    ideas: Ideas,
    procedures: Procedures,
    votes: Votes,
    staff: StaffPage,
    codes: Codes,
    settings: Settings,
    audit: AuditLog,
    "audit-votes": AuditVotes,
    "audit-model": AuditModel,
    "audit-summary": AuditSummary,
  };

  const role = $derived(session.staff?.role);
  const visible = $derived(GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => canOpen(role, i.section)) })).filter((g) => g.items.length));
  const section = $derived<Section | null>(route.section && canOpen(role, route.section) ? route.section : null);
  const Page = $derived(section ? PAGES[section] : null);

  onMount(() => {
    applyTheme(ui.theme);
    document.documentElement.lang = ui.lang;
    void loadCommune();
    const onHash = () => syncRoute();
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  });

  // A signed-in person with no section open lands on their role's first one.
  $effect(() => {
    if (session.staff && !section) navigate(homeOf(session.staff.role));
  });

  async function leave() {
    await signOut();
    location.hash = "";
  }
</script>

<div class="shell">
  <header class="top">
    <div class="brand">
      <span class="mark" aria-hidden="true">§</span>
      <span class="serif name">{commune.name || t("app_name")}</span>
    </div>
    <div class="tools">
      {#if session.staff}
        <span class="who">{t("signed_in_as", { name: session.staff.name, role: roleName(session.staff.role) })}</span>
      {/if}
      <label class="sr-only" for="lang">{t("language")}</label>
      <select id="lang" class="narrow" value={ui.lang} onchange={(e) => setLang((e.currentTarget as HTMLSelectElement).value as UiLang)}>
        {#each UI_LANGS as l (l)}<option value={l}>{UI_LANG_LABELS[l]}</option>{/each}
      </select>
      <button class="icon" onclick={toggleTheme} aria-label={t("theme_toggle")} title={t("theme_toggle")}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z" /></svg>
      </button>
      {#if session.staff}
        <button class="btn small" onclick={leave}>{t("sign_out")}</button>
      {/if}
    </div>
  </header>

  {#if !session.staff}
    <SignIn />
  {:else}
    <div class="layout">
      <nav class="nav" aria-label={t("app_name")}>
        {#each visible as g (g.label)}
          <div class="group">
            <span class="label group-label">{t(g.label)}</span>
            {#each g.items as item (item.section)}
              <a href="#{item.section}" aria-current={section === item.section ? "page" : undefined}>{t(item.label)}</a>
            {/each}
          </div>
        {/each}
      </nav>
      <main class="work">
        {#if Page}
          {#key section}
            <Page arg={route.arg} />
          {/key}
        {:else if route.section}
          <p class="notice error">{t("no_access")}</p>
        {/if}
      </main>
    </div>
  {/if}
</div>

<style>
  .shell { max-width: 1400px; margin: 0 auto; padding-inline: 16px; padding-block: 0 48px; }
  .top {
    position: sticky;
    top: env(safe-area-inset-top, 0px);
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-block: 10px;
    background: var(--bg);
    border-bottom: var(--rule) solid var(--line);
  }
  .brand { min-width: 0; flex: 1 1 auto; display: flex; align-items: center; gap: 10px; }
  .mark { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border: var(--rule) solid var(--ink); background: var(--accent); color: var(--accent-ink); font: 900 1.1rem/1 var(--serif); }
  .name { font-size: 1.35rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tools { flex: none; display: flex; gap: 8px; align-items: center; }
  .who { font-size: 0.85rem; color: var(--muted); display: none; }
  .narrow { width: auto; padding-block: 0.35rem; }
  .icon { display: grid; place-items: center; padding: 0.35rem; cursor: pointer; background: var(--surface); border: var(--rule) solid var(--line); }
  .layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; padding-top: 16px; }
  .nav { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
  .group { display: contents; }
  .group-label { display: none; }
  .nav a {
    text-decoration: none;
    border: 2px solid var(--line);
    background: var(--surface);
    padding: 0.3rem 0.7rem;
    font-family: var(--serif);
    font-weight: 700;
    text-transform: uppercase;
    font-size: 0.8rem;
    letter-spacing: 0.02em;
    color: var(--fg);
    white-space: nowrap;
  }
  .nav a[aria-current="page"] { background: var(--pressed-bg); border-color: var(--pressed-bg); color: var(--pressed-fg); }
  .work { min-width: 0; }
  @media (max-width: 420px) {
    .name { font-size: 1.1rem; }
  }
  @media (min-width: 960px) {
    .who { display: inline; }
    .layout { grid-template-columns: 220px minmax(0, 1fr); gap: 40px; padding-top: 24px; }
    .nav { display: grid; gap: 18px; align-content: start; position: sticky; top: 72px; }
    .group { display: grid; gap: 6px; }
    .group-label { display: block; color: var(--muted); }
    .nav a { display: block; border: 0; border-left: 4px solid transparent; background: none; padding: 0.25rem 0.6rem; font-size: 0.95rem; }
    .nav a:hover { border-left-color: var(--line); }
    .nav a[aria-current="page"] { background: none; color: var(--fg); border-left-color: var(--accent); }
  }
</style>
