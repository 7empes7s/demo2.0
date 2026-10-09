<script lang="ts">
  /**
   * Enrolment codes: residents' requests for a code by post (print addressed letters or decline),
   * a new batch shown once with copy and download, and every batch with issued and used counts.
   */
  import { onMount } from "svelte";

  import Letters from "./Letters.svelte";
  import Notice from "./Notice.svelte";
  import { get, post } from "../lib/api.ts";
  import { commune } from "../lib/commune.svelte.ts";
  import { LETTER_LANGS, siteAddress } from "../lib/letters.ts";

  // The shell hands every section the route's argument; this one has no sub-route.
  let { arg: _arg = null }: { arg?: string | null } = $props();
  import { type EnrolBatch, type LetterRequest, type PostedLetter } from "../lib/types.ts";
  import { date, failure, t } from "../lib/ui.svelte.ts";

  let batches = $state<EnrolBatch[] | null>(null);
  let listError = $state<string | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let name = $state("");
  let count = $state(50);
  /** The codes of the batch just made: shown once, never fetched again. `to` holds the addresses of posted letters. */
  let fresh = $state<{ batch: string; codes: string[]; to?: string[][] } | null>(null);
  let requests = $state<LetterRequest[] | null>(null);
  let requestsError = $state<string | null>(null);
  /** Requests ticked for printing; every new one starts ticked unless it needs a second look. */
  let picked = $state<Set<string>>(new Set());
  let copied = $state(false);

  async function load() {
    listError = null;
    try {
      batches = (await get<{ batches: EnrolBatch[] }>("/enrol-codes")).batches;
    } catch (e) {
      listError = failure(e);
      batches = [];
    }
  }
  async function loadRequests() {
    requestsError = null;
    try {
      requests = (await get<{ requests: LetterRequest[] }>("/enrol-requests")).requests;
      picked = new Set(requests.filter((r) => !r.sent_before && !r.duplicate).map((r) => r.id));
    } catch (e) {
      requestsError = failure(e);
      requests = [];
    }
  }
  onMount(() => {
    void loadRequests();
    void load();
  });

  function toggle(id: string, on: boolean) {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    picked = next;
  }

  /** The window lines: name, street, the optional line, then postcode and town. */
  const addressOf = (l: PostedLetter) => [l.name, l.street, l.extra, `L-${l.postcode} ${commune.name}`.trim()].filter(Boolean);

  async function printRequests() {
    if (busy || !picked.size) return;
    busy = true;
    requestsError = null;
    copied = false;
    try {
      const out = await post<{ letters: PostedLetter[] }>("/enrol-requests/print", { ids: [...picked] });
      fresh = { batch: t("letters_title"), codes: out.letters.map((l) => l.code), to: out.letters.map(addressOf) };
      await Promise.all([loadRequests(), load()]);
    } catch (err) {
      requestsError = failure(err);
      await loadRequests();
    } finally {
      busy = false;
    }
  }

  async function decline(r: LetterRequest) {
    if (busy || !confirm(t("letters_decline_confirm"))) return;
    busy = true;
    requestsError = null;
    try {
      await post(`/enrol-requests/${encodeURIComponent(r.id)}/decline`);
      await loadRequests();
    } catch (err) {
      requestsError = failure(err);
    } finally {
      busy = false;
    }
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    error = null;
    copied = false;
    try {
      const out = await post<{ codes: string[] }>("/enrol-codes", { batch: name.trim(), count: Number(count) });
      fresh = { batch: name.trim() || "batch", codes: out.codes };
      name = "";
      await load();
    } catch (err) {
      error = failure(err);
    } finally {
      busy = false;
    }
  }

  const asText = () => (fresh ? fresh.codes.join("\n") + "\n" : "");

  async function copy() {
    try {
      await navigator.clipboard.writeText(asText());
      copied = true;
    } catch {
      copied = false;
    }
  }

  function print() {
    window.print();
  }

  function download() {
    if (!fresh) return;
    const blob = new Blob([asText()], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fresh.batch.replace(/[^\w.-]+/g, "_")}.txt`;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
</script>

<div class="page">
  <h1 class="serif">{t("codes_title")}</h1>

  {#if fresh}
    <section class="card stack fresh">
      <h2 class="serif">{fresh.batch}</h2>
      {#if fresh.to}
        <p class="notice error" data-state="posted">{t("letters_ready", { count: fresh.codes.length })}</p>
        <div class="actions">
          <button class="btn primary" onclick={print}>{t("codes_print")}</button>
          <button class="btn" onclick={() => (fresh = null)}>{t("codes_done")}</button>
        </div>
        <p class="muted hint">{t("letters_window")}</p>
      {:else}
        <p class="notice error">{t("codes_once")}</p>
        <div class="actions">
          <button class="btn primary" onclick={copy}>{copied ? t("codes_copied") : t("codes_copy")}</button>
          <button class="btn" onclick={download}>{t("codes_download")}</button>
          <button class="btn" onclick={print}>{t("codes_print")}</button>
          <button class="btn" onclick={() => (fresh = null)}>{t("codes_done")}</button>
        </div>
        <p class="muted hint">{t("codes_print_hint", { langs: LETTER_LANGS.map((l) => t(`lang_${l}`)).join(", ") })}</p>
      {/if}
      <Letters codes={fresh.codes} to={fresh.to} commune={commune.name} site={siteAddress(location.href)} />
      {#if !fresh.to}
        <textarea class="mono codes" readonly rows={Math.min(fresh.codes.length + 1, 14)} value={asText()}></textarea>
      {/if}
    </section>
  {/if}

  <section class="card stack" data-state="requests">
    <h2 class="serif">{t("letters_title")}</h2>
    <p class="muted hint">{t("letters_intro")}</p>
    <Notice text={requestsError} kind="error" />
    {#if requests === null}
      <p class="muted pulse">{t("loading")}</p>
    {:else if !requests.length}
      <p class="empty">{t("letters_empty")}</p>
    {:else}
      <div class="scroll">
        <table class="data">
          <thead><tr><th>{t("letters_pick")}</th><th>{t("letters_name")}</th><th>{t("letters_address")}</th><th>{t("letters_asked")}</th><th></th></tr></thead>
          <tbody>
            {#each requests as r (r.id)}
              <tr data-request={r.id}>
                <td><input type="checkbox" aria-label={`${t("letters_pick")}: ${r.name}`} checked={picked.has(r.id)} onchange={(e) => toggle(r.id, (e.currentTarget as HTMLInputElement).checked)} /></td>
                <td class="wrap">
                  {r.name}
                  {#if r.sent_before}<span class="flag">{t("letters_sent_before")}</span>{/if}
                  {#if r.duplicate}<span class="flag">{t("letters_duplicate")}</span>{/if}
                </td>
                <td class="wrap">{[r.street, r.extra, `L-${r.postcode}`].filter(Boolean).join(", ")}</td>
                <td>{date(r.created_at)}</td>
                <td><button class="btn small" onclick={() => decline(r)} disabled={busy}>{t("letters_decline")}</button></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="actions"><button class="btn primary" onclick={printRequests} disabled={busy || !picked.size}>{busy ? t("busy") : t("letters_print", { count: picked.size })}</button></div>
    {/if}
  </section>

  <form class="card stack" onsubmit={create}>
    <h2 class="serif">{t("codes_new")}</h2>
    <div class="fields two">
      <div class="field">
        <label class="label" for="batch-name">{t("codes_batch")}</label>
        <input id="batch-name" type="text" maxlength="80" bind:value={name} />
      </div>
      <div class="field">
        <label class="label" for="batch-count">{t("codes_count")}</label>
        <input id="batch-count" type="number" min="1" max="5000" required bind:value={count} />
      </div>
    </div>
    <Notice text={error} kind="error" />
    <div class="actions"><button class="btn primary" type="submit" disabled={busy}>{busy ? t("busy") : t("create")}</button></div>
  </form>

  <section class="stack">
    <h2 class="serif">{t("codes_batches")}</h2>
    <Notice text={listError} kind="error" />
    {#if batches === null}
      <p class="muted pulse">{t("loading")}</p>
    {:else if !batches.length}
      <p class="empty">{t("codes_empty")}</p>
    {:else}
      <div class="scroll">
        <table class="data">
          <thead><tr><th>{t("codes_batch")}</th><th>{t("codes_issued")}</th><th>{t("codes_used")}</th><th>{t("codes_created", { date: "" }).replace(/\s+$/, "")}</th></tr></thead>
          <tbody>
            {#each batches as b (b.batch)}
              <tr><td class="wrap">{b.batch}</td><td class="num">{b.issued}</td><td class="num">{b.used}</td><td>{date(b.created_at)}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>

<style>
  .fresh { border-left: 8px solid var(--accent); }
  .codes { font-size: 0.9rem; }
  .hint { margin: 0; font-size: 0.86rem; }
  .flag { display: block; font-size: 0.82rem; font-weight: 700; color: var(--red); }
</style>
