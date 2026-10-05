<script lang="ts">
  import type { DocketItem } from "@democracy2/companion";

  import { kindOf, placeOf } from "../lib/data.ts";
  import { t } from "../lib/ui.svelte.ts";

  let { item }: { item: DocketItem } = $props();
  const kind = $derived(kindOf(item));
</script>

<span class="who">
  <span class="place">{t(placeOf(item) === "esch" ? "place_esch" : "place_chamber")}</span>
  {#if item.number && kind === "chamber"}<span class="mono no">N° {item.number}</span>
  {:else if item.number && kind === "council"}<span class="mono no">{t("point_no", { n: item.number })}</span>{/if}
</span>
{#if item.type_label}<span class="label" lang="fr">{item.type_label}</span>{:else}<span class="label">{t(item.type === "bill" ? "type_bill" : item.type === "debate" ? "type_debate" : "type_other")}</span>{/if}

<style>
  .who { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; }
  .place { font-size: 0.82rem; font-weight: 600; color: var(--muted); }
  .no { color: var(--accent-fg); font-weight: 500; font-size: 0.9rem; }
</style>
