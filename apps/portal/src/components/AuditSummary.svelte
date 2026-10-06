<script lang="ts">
  /** The counts, the chain's state and the staff list, in one glance. */
  import { onMount } from "svelte";

  import Notice from "./Notice.svelte";
  import { get } from "../lib/api.ts";
  import { short } from "../lib/text.ts";
  import type { Summary } from "../lib/types.ts";
  import { failure, roleName, t } from "../lib/ui.svelte.ts";
  import type { Key } from "../lib/i18n.ts";

  // The shell hands every section the route's argument; this one has no sub-route.
  let { arg: _arg = null }: { arg?: string | null } = $props();

  let summary = $state<Summary | null>(null);
  let error = $state<string | null>(null);

  const COUNTS: [string, Key][] = [
    ["events", "count_events"],
    ["residents", "count_residents"],
    ["codes_issued", "count_codes_issued"],
    ["codes_used", "count_codes_used"],
    ["procedures", "count_procedures"],
    ["ideas", "count_ideas"],
    ["feedback", "count_feedback"],
    ["feedback_answered", "count_feedback_answered"],
    ["rounds", "count_rounds"],
    ["ballots", "count_ballots"],
    ["ai_calls", "count_ai_calls"],
  ];

  onMount(async () => {
    try {
      summary = await get<Summary>("/audit/summary");
    } catch (e) {
      error = failure(e);
    }
  });
</script>

<div class="page">
  <h1 class="serif">{t("audit_summary_title")}</h1>
  <Notice text={error} kind="error" />
  {#if summary}
    <p class="notice" class:ok={summary.log.ok} class:error={!summary.log.ok} role="status">
      {summary.log.ok ? t("audit_ok", { n: summary.log.entries, head: short(summary.log.head, 12) }) : t("audit_broken", { n: summary.log.broken_at ?? 0 })}
    </p>
    <ul class="tiles">
      {#each COUNTS as [k, key] (k)}
        <li class="card tile"><span class="n mono">{summary.counts[k] ?? 0}</span><span class="label">{t(key)}</span></li>
      {/each}
    </ul>
    <section class="stack">
      <h2 class="serif">{t("staff_list")}</h2>
      <div class="scroll">
        <table class="data">
          <thead><tr><th>{t("staff_name")}</th><th>{t("staff_role")}</th><th>{t("staff_disabled")}</th></tr></thead>
          <tbody>
            {#each summary.staff as s (s.id)}
              <tr><td class="wrap">{s.name}</td><td>{roleName(s.role)}</td><td>{s.disabled ? t("yes") : t("no")}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {:else if !error}
    <p class="muted pulse">{t("loading")}</p>
  {/if}
</div>

<style>
  .tiles { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
  .tile { display: grid; gap: 2px; }
  .n { font-size: 2rem; font-weight: 700; color: var(--red); line-height: 1; }
</style>
