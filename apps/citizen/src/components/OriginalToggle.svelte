<script lang="ts">
  import { canTranslate, toggleOriginal, translations } from "../lib/translations.svelte.ts";
  import { t } from "../lib/ui.svelte.ts";
</script>

{#if canTranslate()}
  <p class="original" data-testid="original-toggle">
    <span class="note">{t(translations.original ? "original_shown" : "translated_note")}</span>
    <button class="btn small" aria-pressed={translations.original} onclick={toggleOriginal}>{t(translations.original ? "show_translation" : "show_original")}</button>
  </p>
{/if}

<style>
  .original { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; font-size: 0.88rem; color: var(--muted); }
  .note { min-width: 0; }
  .btn { flex: none; white-space: nowrap; }
  /* A switch, not a choice: it keeps the paper face whether on or off. */
  .btn[aria-pressed="true"] { background: var(--surface); border-color: var(--line); color: var(--fg); }
</style>
