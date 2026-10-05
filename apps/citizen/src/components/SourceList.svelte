<script lang="ts">
  import type { Source } from "@democracy2/companion";

  import { t } from "../lib/ui.svelte.ts";

  let { sources }: { sources: Source[] } = $props();
</script>

<details class="sources">
  <summary class="label">{t("sources")} ({sources.length})</summary>
  <ol>
    {#each sources as s (s.n)}
      <li value={s.n}>
        {#if s.url}<a href={s.url} target="_blank" rel="noopener" lang="fr">{s.label}</a>{:else}<span lang="fr">{s.label}</span>{/if}
        {#if s.date}<span class="muted mono">{s.date}</span>{/if}
      </li>
    {/each}
  </ol>
</details>

<style>
  .sources summary { cursor: pointer; }
  ol { margin: 8px 0 0; padding-left: 1.6rem; display: grid; gap: 6px; font-size: 0.9rem; }
  li span.mono { margin-left: 8px; font-size: 0.8rem; }
</style>
