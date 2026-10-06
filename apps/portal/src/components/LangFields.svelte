<script lang="ts">
  /** One text in several languages: a field per language the commune offers, label on its own line. */
  import type { Lang, Localized } from "../lib/types.ts";
  import { langName } from "../lib/ui.svelte.ts";

  let {
    value = $bindable({}),
    label,
    langs,
    multiline = false,
    maxlength,
    id,
    required = false,
  }: { value: Localized; label: string; langs: Lang[]; multiline?: boolean; maxlength?: number; id: string; required?: boolean } = $props();

  function set(lang: Lang, text: string) {
    value = { ...value, [lang]: text };
  }
</script>

<fieldset class="lang-fields">
  <legend>{label}</legend>
  <div class="fields">
    {#each langs as lang (lang)}
      <div class="field">
        <label class="label" for="{id}-{lang}">{langName(lang)}{required && lang === langs[0] ? " *" : ""}</label>
        {#if multiline}
          <textarea id="{id}-{lang}" {maxlength} value={value[lang] ?? ""} oninput={(e) => set(lang, e.currentTarget.value)}></textarea>
        {:else}
          <input id="{id}-{lang}" type="text" {maxlength} value={value[lang] ?? ""} oninput={(e) => set(lang, e.currentTarget.value)} />
        {/if}
      </div>
    {/each}
  </div>
</fieldset>
