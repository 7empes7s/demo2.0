<script lang="ts">
  import type { DocketItem } from "@democracy2/companion";

  import { kindOf, placeOf } from "../lib/data.ts";
  import { langOf, tx } from "../lib/translations.svelte.ts";
  import { t } from "../lib/ui.svelte.ts";

  /** `brief` (lists): the place and a plain word for the kind of file, no number and no official label. */
  let { item, brief = false }: { item: DocketItem; brief?: boolean } = $props();
  const kind = $derived(kindOf(item));
  const plain = $derived(
    kind === "council" ? "type_council" : kind === "consultation" ? "proc_kind_consultation" : item.type === "bill" ? "type_bill" : item.type === "debate" ? "type_debate" : "type_other",
  );
</script>

<span class="who">
  <span class="place">{t(placeOf(item) === "esch" ? "place_esch" : "place_chamber")}</span>
  {#if brief}<span class="kind">{t(plain)}</span>
  {:else if item.number && kind === "chamber"}<span class="mono no">N° {item.number}</span>
  {:else if item.number && kind === "council"}<span class="mono no">{t("point_no", { n: item.number })}</span>{/if}
</span>
{#if !brief}
  {#if item.type_label}<span class="label" lang={langOf(item.type_label)}>{tx(item.type_label)}</span>{:else}<span class="label">{t(item.type === "bill" ? "type_bill" : item.type === "debate" ? "type_debate" : "type_other")}</span>{/if}
{/if}

<style>
  .who { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; }
  .place { --fg: var(--sheet-fg); --line: var(--sheet-line); color: var(--fg); padding: 0 6px; border: 2px solid var(--line); background: var(--surface); font: 700 0.72rem/1.5 var(--serif); text-transform: uppercase; letter-spacing: 0.02em; }
  .no { color: var(--fg); font-weight: 700; font-size: 0.9rem; }
  .kind { color: var(--muted); font-size: 0.85rem; }
</style>
