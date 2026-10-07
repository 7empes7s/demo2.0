<script lang="ts">
  import { LANGS, type DocketItem, type Lang } from "@democracy2/companion";
  import { homeChoices, placeName, topicList } from "@democracy2/pulse";

  import { LANG_LABELS } from "../lib/i18n.ts";
  import { CHARTER, finishSetup, pulse, setHome, toggleGroup } from "../lib/pulse.svelte.ts";
  import { GROUP_LABEL, groupsIn } from "../lib/topics.ts";
  import { setLang, t, ui } from "../lib/ui.svelte.ts";

  let {
    items,
    ondone,
  }: {
    items: DocketItem[];
    /** The steps are over, finished or skipped: show the week. */
    ondone: () => void;
  } = $props();

  const choices = homeChoices(CHARTER.places);
  const groups = $derived(groupsIn(topicList(items)));
  const STEPS = 3;
  let step = $state(1);

  function next() {
    if (step < STEPS) step += 1;
    else done();
  }

  function done() {
    finishSetup();
    ondone();
  }
</script>

<section class="welcome" aria-labelledby="welcome-title" data-testid="welcome">
  <div class="card sheet">
    <p class="label step">{t("welcome_step", { i: step, n: STEPS })}</p>

    {#if step === 1}
      <h1 class="serif" id="welcome-title" tabindex="-1">{t("welcome_lang_title")}</h1>
      <div class="options" role="group" aria-label={t("language")}>
        {#each LANGS as l (l)}
          <button class="btn option-btn" lang={l} aria-pressed={ui.lang === l} onclick={() => setLang(l as Lang)}>{LANG_LABELS[l]}</button>
        {/each}
      </div>
    {:else if step === 2}
      <h1 class="serif" id="welcome-title" tabindex="-1">{t("welcome_home_title")}</h1>
      <p class="hint">{t("welcome_home_hint")}</p>
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
      <p class="muted hint small">{t("week_home_hint")}</p>
      <p class="private" data-testid="week-private"><span aria-hidden="true">🔒</span> {t("week_private")}</p>
    {:else}
      <h1 class="serif" id="welcome-title" tabindex="-1">{t("welcome_topics_title")}</h1>
      <p class="hint">{t("welcome_topics_hint")}</p>
      <div class="options topics" role="group" aria-label={t("week_topics_label")}>
        {#each groups as g (g)}
          <button class="btn option-btn" aria-pressed={pulse.prefs.groups.includes(g)} onclick={() => toggleGroup(g)}>{t(GROUP_LABEL[g])}</button>
        {:else}
          <p class="muted">{t("week_topics_none")}</p>
        {/each}
      </div>
      <p class="private" data-testid="week-private"><span aria-hidden="true">🔒</span> {t("week_private")}</p>
    {/if}

    <div class="actions">
      {#if step > 1}
        <button class="btn" onclick={() => (step -= 1)}>{t("welcome_back")}</button>
      {/if}
      <button class="btn primary next" onclick={next}>{t(step === STEPS ? "welcome_done" : "welcome_next")}</button>
    </div>
    <button class="skip" onclick={done}>{t("welcome_skip")}</button>
    <p class="muted small later">{t("welcome_later")}</p>
  </div>
</section>

<style>
  .welcome { display: grid; justify-items: center; padding-block: 24px 48px; }
  .sheet {
    width: 100%;
    max-width: 560px;
    display: grid;
    gap: 16px;
    padding: 1.4rem 1.2rem 1.2rem;
    box-shadow: 8px 8px 0 0 var(--accent), 8px 8px 0 var(--rule) var(--backing);
  }
  .step { margin: 0; color: var(--muted); }
  h1 { font-size: clamp(1.9rem, 6vw, 2.6rem); line-height: 1.05; }
  h1:focus { outline: none; }
  .hint { margin: 0; max-width: 48ch; }
  .small { font-size: 0.85rem; }
  select {
    width: 100%;
    background: var(--surface);
    border: var(--rule) solid var(--line);
    padding: 0.8rem 0.9rem;
    font-size: 1.05rem;
  }
  /* One big choice per line: easy to read and to tap, whatever the age or the thumb. */
  .options { display: grid; gap: 10px; }
  .option-btn {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 52px;
    padding: 0.7rem 1rem;
    font-size: 1rem;
    text-align: left;
    white-space: normal;
  }
  .option-btn::before {
    content: "";
    flex: none;
    width: 20px;
    height: 20px;
    border: 2px solid currentColor;
  }
  .option-btn[aria-pressed="true"]::before { content: "✓"; display: grid; place-items: center; font-size: 0.9rem; line-height: 1; background: var(--accent); color: var(--accent-ink); border-color: var(--accent-line); }
  .private {
    margin: 0;
    padding: 0.55rem 0.8rem;
    border: var(--rule) solid var(--line);
    background: var(--surface-2);
    font-size: 0.88rem;
  }
  .actions { display: flex; gap: 10px; margin-top: 4px; }
  .next { flex: 1 1 auto; min-height: 52px; font-size: 1rem; }
  .skip {
    justify-self: center;
    background: none;
    border: 0;
    padding: 6px 4px;
    color: var(--fg);
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .later { margin: 0; text-align: center; }
  @media (min-width: 560px) {
    .topics { grid-template-columns: 1fr 1fr; }
  }
</style>
