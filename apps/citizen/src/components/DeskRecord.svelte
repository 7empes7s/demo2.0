<script lang="ts">
  import { onMount } from "svelte";

  import type { DeskClient, Fingerprints } from "../lib/desk.ts";
  import { CompanionFailure } from "../lib/errors.ts";
  import type { Key } from "../lib/i18n.ts";
  import { date, t } from "../lib/ui.svelte.ts";

  /**
   * The desk's daily fingerprint, for anyone: the latest one, every day so far, a copy to keep,
   * and how to check it from outside. What the record holds stays with the auditors.
   */
  let { client, origin = location.origin }: { client: DeskClient; origin?: string } = $props();

  let record = $state<Fingerprints | null>(null);
  let busy = $state(true);
  let failure = $state<Key | null>(null);

  const days = $derived(record ? [...record.days].reverse() : []);
  const latest = $derived(days[0] ?? null);
  const command = $derived(
    `node --experimental-strip-types modules/desk/src/check-log.ts --url ${origin}/api/desk --vkey '${record?.key ?? ""}' --keep desk-record.json`,
  );

  /** The root, cut into groups of four so it can be read out and compared. */
  const short = (root: string) => root.slice(0, 16).match(/.{1,4}/g)?.join(" ") ?? root;

  async function load() {
    busy = true;
    failure = null;
    try {
      record = await client.fingerprints();
    } catch (e) {
      record = null;
      failure = e instanceof CompanionFailure && e.kind === "busy" ? "ideas_busy" : "desk_unavailable";
    } finally {
      busy = false;
    }
  }

  function save() {
    if (!record || !latest) return;
    const copy = { enabled: true, key: record.key, days: record.days.map(({ day, size, note, ots }) => ({ day, size, note, ots })) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(copy, null, 1)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `desk-record-${latest.day}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  onMount(load);
</script>

<div class="record">
  <p class="muted intro">{t("record_intro")}</p>

  <div aria-live="polite" class="status">
    {#if busy}
      <p class="muted pulse" data-state="loading">{t("desk_loading")}</p>
    {:else if failure}
      <div class="notice" data-state="unavailable">
        <p>{t(failure)}</p>
        <button class="btn" onclick={load}>{t("ideas_retry")}</button>
      </div>
    {:else if record && (!record.enabled || !latest)}
      <div class="empty" data-state="off"><p class="serif">{t("record_off")}</p></div>
    {/if}
  </div>

  {#if record?.enabled && latest}
    <section class="card latest" data-state="latest" aria-labelledby="record-latest">
      <h3 id="record-latest" class="serif label">{t("record_latest")}</h3>
      <p class="print mono" data-testid="print">{short(latest.root)}</p>
      <p class="facts">
        <span>{date(latest.signed_at)}</span>
        <span>{t("record_entries", { n: latest.size.toLocaleString() })}</span>
      </p>
      <p class="muted small">{t(latest.ots ? "record_stamped" : "record_stamp_pending")}</p>
    </section>

    <section class="group" aria-labelledby="record-check">
      <h3 id="record-check" class="serif group-title">{t("record_check_title")}</h3>
      <p class="text">{t("record_check_text")}</p>
      <button class="btn primary save" onclick={save} data-testid="save">{t("record_save")}</button>
      <p class="muted small">{t("record_hidden")}</p>
    </section>

    <details class="fold">
      <summary><h3 class="serif sub">{t("record_days")}</h3><span class="n">{days.length}</span></summary>
      <ol class="days" data-state="days">
        {#each days as d (d.day)}
          <li><span>{date(d.signed_at)}</span><span class="muted">{t("record_entries", { n: d.size.toLocaleString() })}</span><span class="mono muted">{short(d.root)}</span></li>
        {/each}
      </ol>
    </details>

    <details class="fold">
      <summary><h3 class="serif sub">{t("record_tech")}</h3></summary>
      <div class="tech">
        <p class="small">{t("record_key")}</p>
        <code class="mono block">{record.key}</code>
        <p class="small">{t("record_command")}</p>
        <code class="mono block" data-testid="command">{command}</code>
        <p class="muted small">{t("record_tech_line")}</p>
      </div>
    </details>
  {/if}
</div>

<style>
  .record { display: grid; gap: 16px; }
  .intro { margin: 0; max-width: 62ch; }
  .status:empty { display: none; }
  .status p { margin: 0; }
  .notice { display: grid; gap: 10px; justify-items: start; padding: 0.8rem 0.9rem; border: var(--rule) solid var(--line); background: var(--surface); }
  .empty { display: grid; place-content: center; text-align: center; min-height: 160px; padding: 24px; border: var(--rule) dashed var(--line); }
  .empty .serif { font-size: 1.45rem; margin: 0; }
  .latest { display: grid; gap: 8px; align-content: start; }
  .label { font-size: 1rem; color: var(--muted); margin: 0; }
  .print { margin: 0; font-size: clamp(1.3rem, 6vw, 1.9rem); font-weight: 700; letter-spacing: 0.04em; overflow-wrap: anywhere; }
  .facts { margin: 0; display: flex; flex-wrap: wrap; gap: 4px 16px; font-weight: 600; }
  .group { display: grid; gap: 10px; justify-items: start; }
  .group-title { font-size: 1.1rem; color: var(--muted); margin: 0; }
  .text { margin: 0; max-width: 62ch; }
  .small { font-size: 0.86rem; margin: 0; }
  .days { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .days li { display: flex; flex-wrap: wrap; gap: 2px 14px; padding: 6px 0; border-bottom: 1px solid var(--line); }
  .fold { border-top: var(--rule) solid var(--line); padding-top: 12px; }
  .fold > summary { display: flex; align-items: center; gap: 10px; cursor: pointer; list-style: none; }
  .fold > summary::-webkit-details-marker { display: none; }
  .fold > summary::after { content: "+"; margin-left: auto; font: 900 1.6rem/1 var(--serif); }
  .fold[open] > summary::after { content: "–"; }
  .fold[open] > summary { margin-bottom: 8px; }
  .sub { margin: 0; font-size: 1.1rem; }
  .n { padding: 0 6px; border: 2px solid var(--line); font: 700 0.8rem/1.5 var(--serif); }
  .tech { display: grid; gap: 8px; }
  .block { display: block; padding: 8px 10px; border: var(--rule) solid var(--line); background: var(--surface); font-size: 0.8rem; overflow-wrap: anywhere; white-space: pre-wrap; }
</style>
