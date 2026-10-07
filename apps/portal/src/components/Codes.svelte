<script lang="ts">
  /** Enrolment codes: a new batch, shown once with copy and download, and every batch with issued and used counts. */
  import { onMount } from "svelte";

  import Letters from "./Letters.svelte";
  import Notice from "./Notice.svelte";
  import { get, post } from "../lib/api.ts";
  import { commune } from "../lib/commune.svelte.ts";
  import { LETTER_LANGS, siteAddress } from "../lib/letters.ts";

  // The shell hands every section the route's argument; this one has no sub-route.
  let { arg: _arg = null }: { arg?: string | null } = $props();
  import { type EnrolBatch } from "../lib/types.ts";
  import { date, failure, t } from "../lib/ui.svelte.ts";

  let batches = $state<EnrolBatch[] | null>(null);
  let listError = $state<string | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let name = $state("");
  let count = $state(50);
  /** The codes of the batch just made: shown once, never fetched again. */
  let fresh = $state<{ batch: string; codes: string[] } | null>(null);
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
  onMount(() => void load());

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
      <p class="notice error">{t("codes_once")}</p>
      <div class="actions">
        <button class="btn primary" onclick={copy}>{copied ? t("codes_copied") : t("codes_copy")}</button>
        <button class="btn" onclick={download}>{t("codes_download")}</button>
        <button class="btn" onclick={print}>{t("codes_print")}</button>
        <button class="btn" onclick={() => (fresh = null)}>{t("codes_done")}</button>
      </div>
      <p class="muted hint">{t("codes_print_hint", { langs: LETTER_LANGS.map((l) => t(`lang_${l}`)).join(", ") })}</p>
      <Letters codes={fresh.codes} commune={commune.name} site={siteAddress(location.href)} />
      <textarea class="mono codes" readonly rows={Math.min(fresh.codes.length + 1, 14)} value={asText()}></textarea>
    </section>
  {/if}

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
</style>
