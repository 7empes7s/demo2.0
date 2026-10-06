<script lang="ts">
  /** The commune's settings and the model. The key is write-only: the desk only ever says whether one is set. */
  import { onMount } from "svelte";

  import LangFields from "./LangFields.svelte";
  import Notice from "./Notice.svelte";
  import { get, patch, post } from "../lib/api.ts";
  import { applyCommune } from "../lib/commune.svelte.ts";
  import { compact } from "../lib/text.ts";
  import { LANGS, type AdminSettings, type Lang, type Localized } from "../lib/types.ts";
  import { failure, langName, t } from "../lib/ui.svelte.ts";

  // The shell hands every section the route's argument; this one has no sub-route.
  let { arg: _arg = null }: { arg?: string | null } = $props();

  let settings = $state<AdminSettings | null>(null);
  let loadError = $state<string | null>(null);
  let error = $state<string | null>(null);
  let done = $state<string | null>(null);
  let busy = $state<"" | "save" | "test">("");

  let commune = $state("");
  let languages = $state<Lang[]>([]);
  let intro = $state<Localized>({});
  let baseUrl = $state("");
  let model = $state("");
  let key = $state("");
  let timeout = $state(30000);
  let timeoutTouched = $state(false);

  function fill(s: AdminSettings) {
    settings = s;
    commune = s.commune;
    languages = [...s.languages];
    intro = { ...s.intro };
    baseUrl = s.ai.base_url ?? "";
    model = s.ai.model ?? "";
    key = "";
  }

  async function load() {
    loadError = null;
    try {
      fill(await get<AdminSettings>("/settings"));
    } catch (e) {
      loadError = failure(e);
    }
  }
  onMount(() => void load());

  function toggleLang(l: Lang, on: boolean) {
    languages = on ? LANGS.filter((x) => x === l || languages.includes(x)) : languages.filter((x) => x !== l);
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    busy = "save";
    error = null;
    done = null;
    try {
      // The desk never returns the timeout, so it is only sent when the admin touched it.
      const ai: Record<string, unknown> = { base_url: baseUrl.trim(), model: model.trim() };
      if (timeoutTouched) ai.timeout_ms = Number(timeout);
      if (key) ai.api_key = key;
      const out = await patch<AdminSettings>("/settings", { commune: commune.trim(), languages, intro: compact(intro), ai });
      fill(out);
      applyCommune(out);
      done = t("settings_saved");
    } catch (err) {
      error = failure(err);
    } finally {
      busy = "";
    }
  }

  async function test() {
    if (busy) return;
    busy = "test";
    error = null;
    done = null;
    try {
      const out = await post<{ ok: true; model: string; ms: number; sample: string }>("/ai/test");
      done = t("settings_test_ok", { ms: out.ms, sample: out.sample });
    } catch (err) {
      error = failure(err);
    } finally {
      busy = "";
    }
  }
</script>

<div class="page">
  <h1 class="serif">{t("settings_title")}</h1>
  <Notice text={loadError} kind="error" />
  {#if settings}
    <form class="stack" onsubmit={save}>
      <section class="card stack">
        <h2 class="serif">{t("settings_commune")}</h2>
        <div class="field">
          <label class="label" for="s-commune">{t("settings_commune")}</label>
          <input id="s-commune" type="text" maxlength="80" required bind:value={commune} />
        </div>
        <fieldset>
          <legend>{t("settings_languages")}</legend>
          <div class="row">
            {#each LANGS as l (l)}
              <label class="check"><input type="checkbox" checked={languages.includes(l)} onchange={(e) => toggleLang(l, e.currentTarget.checked)} /> {langName(l)}</label>
            {/each}
          </div>
        </fieldset>
        <LangFields id="s-intro" label={t("settings_intro")} langs={languages.length ? languages : [...LANGS]} multiline maxlength={600} bind:value={intro} />
      </section>

      <section class="card stack">
        <h2 class="serif">{t("settings_model")}</h2>
        <p class="m0 muted small">{t("settings_model_hint")}</p>
        {#if settings.ai.from_env}<p class="notice">{t("settings_key_env")}</p>{/if}
        <div class="fields two">
          <div class="field">
            <label class="label" for="s-url">{t("settings_base_url")}</label>
            <input id="s-url" type="url" maxlength="300" placeholder="https://" bind:value={baseUrl} />
          </div>
          <div class="field">
            <label class="label" for="s-model">{t("settings_model_name")}</label>
            <input id="s-model" type="text" maxlength="120" bind:value={model} />
          </div>
          <div class="field">
            <label class="label" for="s-key">{t("settings_key")}</label>
            <input id="s-key" type="password" autocomplete="off" maxlength="500" bind:value={key} />
            <p class="hint">{settings.ai.key_set ? t("settings_key_set") : t("settings_key_unset")}</p>
          </div>
          <div class="field">
            <label class="label" for="s-timeout">{t("settings_timeout")}</label>
            <input id="s-timeout" type="number" min="1000" max="600000" step="1000" bind:value={timeout} oninput={() => (timeoutTouched = true)} />
          </div>
        </div>
        <div class="actions">
          <button class="btn small" type="button" onclick={test} disabled={!!busy}>{busy === "test" ? t("settings_testing") : t("settings_test")}</button>
        </div>
      </section>

      <Notice text={error} kind="error" />
      <Notice text={done} kind="ok" />
      <div class="actions"><button class="btn primary" type="submit" disabled={!!busy}>{busy === "save" ? t("busy") : t("save")}</button></div>
    </form>
  {:else if !loadError}
    <p class="muted pulse">{t("loading")}</p>
  {/if}
</div>

<style>
  .m0 { margin: 0; }
  .small { font-size: 0.85rem; }
  .hint { font-size: 0.82rem; margin: 0; }
  .check { display: inline-flex; gap: 6px; align-items: center; border: 2px solid var(--line); padding: 0.3rem 0.7rem; background: var(--surface); }
</style>
