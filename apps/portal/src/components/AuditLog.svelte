<script lang="ts">
  /** The event log: every entry with its hash prefix, paged by entry number, and a button that replays the chain. */
  import { onMount } from "svelte";

  import Notice from "./Notice.svelte";
  import { get, query } from "../lib/api.ts";
  import { short } from "../lib/text.ts";
  import type { AuditEvent, Verification } from "../lib/types.ts";
  import { dateTime, failure, t } from "../lib/ui.svelte.ts";

  // The shell hands every section the route's argument; this one has no sub-route.
  let { arg: _arg = null }: { arg?: string | null } = $props();

  const PAGE = 100;
  let events = $state<AuditEvent[] | null>(null);
  let error = $state<string | null>(null);
  let kind = $state("");
  let subject = $state("");
  let from = $state(1);
  let verifying = $state(false);
  let verification = $state<Verification | null>(null);
  let verifyError = $state<string | null>(null);

  async function load() {
    error = null;
    try {
      events = (await get<{ events: AuditEvent[] }>(`/audit/events${query({ from, kind: kind.trim(), subject: subject.trim(), limit: PAGE })}`)).events;
    } catch (e) {
      error = failure(e);
      events = [];
    }
  }
  onMount(() => void load());

  function filter(e: SubmitEvent) {
    e.preventDefault();
    from = 1;
    void load();
  }

  function next() {
    if (!events?.length) return;
    from = events[events.length - 1].seq + 1;
    void load();
  }

  async function verify() {
    if (verifying) return;
    verifying = true;
    verifyError = null;
    verification = null;
    try {
      verification = await get<Verification>("/audit/verify");
    } catch (e) {
      verifyError = failure(e);
    } finally {
      verifying = false;
    }
  }
</script>

<div class="page">
  <h1 class="serif">{t("audit_title")}</h1>

  <section class="card stack">
    <div class="actions">
      <button class="btn primary" onclick={verify} disabled={verifying}>{verifying ? t("audit_verifying") : t("audit_verify")}</button>
    </div>
    <Notice text={verifyError} kind="error" />
    {#if verification}
      <p class="notice" class:ok={verification.ok} class:error={!verification.ok} role="status">
        {verification.ok ? t("audit_ok", { n: verification.entries, head: short(verification.head, 12) }) : t("audit_broken", { n: verification.broken_at ?? 0 })}
      </p>
    {/if}
  </section>

  <form class="row filters" onsubmit={filter}>
    <div class="field">
      <label class="label" for="a-kind">{t("audit_kind")}</label>
      <input id="a-kind" type="text" placeholder="feedback." bind:value={kind} />
    </div>
    <div class="field">
      <label class="label" for="a-subject">{t("audit_subject")}</label>
      <input id="a-subject" type="text" placeholder="procedure:…" bind:value={subject} />
    </div>
    <div class="field">
      <label class="label" for="a-from">{t("audit_from")}</label>
      <input id="a-from" type="number" min="1" bind:value={from} />
    </div>
    <button class="btn small" type="submit">{t("audit_filter")}</button>
  </form>

  <Notice text={error} kind="error" />
  {#if events === null}
    <p class="muted pulse">{t("loading")}</p>
  {:else if !events.length}
    <p class="empty">{t("audit_empty")}</p>
  {:else}
    <div class="scroll">
      <table class="data">
        <thead>
          <tr><th>#</th><th>{t("audit_time")}</th><th>{t("audit_kind")}</th><th>{t("audit_actor")}</th><th>{t("audit_subject")}</th><th>{t("audit_payload")}</th><th>{t("audit_hash")}</th></tr>
        </thead>
        <tbody>
          {#each events as e (e.seq)}
            <tr>
              <td class="num">{e.seq}</td>
              <td class="mono">{dateTime(e.at)}</td>
              <td>{e.kind}</td>
              <td class="mono">{e.actor}</td>
              <td class="mono">{e.subject}</td>
              <td class="wrap"><details><summary>{t("audit_payload")}</summary><pre class="payload">{JSON.stringify(e.payload, null, 1)}</pre></details></td>
              <td class="mono">{short(e.hash)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="actions">
      <button class="btn" onclick={next} disabled={events.length < PAGE}>{t("audit_more")}</button>
    </div>
  {/if}
</div>

<style>
  .filters { align-items: end; }
  .filters .field { flex: 1 1 10rem; }
</style>
