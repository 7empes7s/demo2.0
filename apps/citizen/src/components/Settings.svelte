<script lang="ts">
  import { LANGS, type DocketItem, type Lang } from "@democracy2/companion";
  import { homeChoices, placeName, topicList } from "@democracy2/pulse";

  import { LANG_LABELS } from "../lib/i18n.ts";
  import { CHARTER, pulse, resetPulse, setHome, toggleGroup } from "../lib/pulse.svelte.ts";
  import { motion, setMotion, type Motion } from "../lib/motion.svelte.ts";
  import { setTheme, theme, type Theme } from "../lib/theme.svelte.ts";
  import { GROUP_LABEL, groupsIn } from "../lib/topics.ts";
  import { setLang, t, ui } from "../lib/ui.svelte.ts";

  let { items }: { items: DocketItem[] } = $props();

  const choices = homeChoices(CHARTER.places);
  const groups = $derived(groupsIn(topicList(items)));
  const THEMES: { value: Theme; key: "theme_auto" | "theme_light" | "theme_dark" }[] = [
    { value: null, key: "theme_auto" },
    { value: "light", key: "theme_light" },
    { value: "dark", key: "theme_dark" },
  ];
  const MOTIONS: { value: Motion; key: "motion_auto" | "motion_on" | "motion_off" }[] = [
    { value: null, key: "motion_auto" },
    { value: "on", key: "motion_on" },
    { value: "off", key: "motion_off" },
  ];
  let forgotten = $state(false);

  function forget() {
    resetPulse();
    forgotten = true;
  }
</script>

<div class="settings" data-testid="settings">
  <section class="card" aria-labelledby="s-lang">
    <h3 class="label" id="s-lang">{t("language")}</h3>
    <div class="row" role="group" aria-labelledby="s-lang">
      {#each LANGS as l (l)}
        <button class="btn choice" lang={l} aria-pressed={ui.lang === l} onclick={() => setLang(l as Lang)}>{LANG_LABELS[l]}</button>
      {/each}
    </div>
  </section>

  <section class="card" aria-labelledby="s-theme">
    <h3 class="label" id="s-theme">{t("settings_theme")}</h3>
    <div class="row" role="group" aria-labelledby="s-theme">
      {#each THEMES as o (o.key)}
        <button class="btn choice" aria-pressed={theme.value === o.value} onclick={() => setTheme(o.value)}>{t(o.key)}</button>
      {/each}
    </div>
  </section>

  <section class="card" aria-labelledby="s-motion">
    <h3 class="label" id="s-motion">{t("settings_motion")}</h3>
    <div class="row" role="group" aria-labelledby="s-motion">
      {#each MOTIONS as o (o.key)}
        <button class="btn choice" aria-pressed={motion.value === o.value} onclick={() => setMotion(o.value)}>{t(o.key)}</button>
      {/each}
    </div>
    <p class="muted hint">{t("motion_hint")}</p>
  </section>

  <section class="card" aria-labelledby="s-home">
    <h3 class="label" id="s-home"><label for="home">{t("week_home_label")}</label></h3>
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
  </section>

  <section class="card" aria-labelledby="s-topics">
    <h3 class="label" id="s-topics">{t("week_topics_label")}</h3>
    <p class="muted hint">{t("welcome_topics_hint")}</p>
    <div class="topics" role="group" aria-labelledby="s-topics">
      {#each groups as g (g)}
        <button class="btn choice topic" aria-pressed={pulse.prefs.groups.includes(g)} onclick={() => toggleGroup(g)}>{t(GROUP_LABEL[g])}</button>
      {:else}
        <p class="muted">{t("week_topics_none")}</p>
      {/each}
    </div>
  </section>

  <p class="private" data-testid="week-private"><span aria-hidden="true">🔒</span> {t("week_private")}</p>

  <div class="forget">
    <button class="btn" onclick={forget} disabled={!pulse.prefs.home && !pulse.prefs.groups.length}>{t("week_forget")}</button>
    {#if forgotten}<p class="muted small" role="status">{t("settings_forgot")}</p>{/if}
  </div>
</div>

<style>
  .settings { display: grid; gap: 16px; }
  .card { display: grid; gap: 10px; }
  .card h3 { margin: 0; }
  .hint { margin: 0; font-size: 0.85rem; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; }
  .choice { min-height: 44px; white-space: normal; text-align: left; }
  .choice[aria-pressed="true"]::before { content: "✓"; margin-right: 0.4em; }
  .topics { display: grid; gap: 8px; }
  .topic { display: flex; align-items: center; min-height: 48px; font-size: 0.95rem; }
  select {
    width: 100%;
    background: var(--surface);
    border: var(--rule) solid var(--line);
    padding: 0.7rem 0.9rem;
    font-size: 1rem;
  }
  .private {
    margin: 0;
    padding: 0.55rem 0.8rem;
    border: var(--rule) solid var(--line);
    background: var(--surface);
    font-size: 0.88rem;
  }
  .forget { display: grid; gap: 8px; justify-items: start; }
  .small { margin: 0; font-size: 0.85rem; }
  @media (min-width: 560px) {
    .topics { grid-template-columns: 1fr 1fr; }
  }
</style>
