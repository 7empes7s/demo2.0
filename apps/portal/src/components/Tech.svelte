<script lang="ts">
  /** Raw ids and hashes live here, folded away, and nowhere else on the page. */
  import { t } from "../lib/ui.svelte.ts";

  let { rows }: { rows: [string, string | number | null | undefined][] } = $props();
</script>

<details class="tech">
  <summary>{t("tech")}</summary>
  <dl class="kv">
    {#each rows as [k, v] (k)}
      <div><dt>{k}</dt><dd class="mono">{v ?? "—"}</dd></div>
    {/each}
  </dl>
</details>
