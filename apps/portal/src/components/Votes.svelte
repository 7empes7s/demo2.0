<script lang="ts">
  /** Questions put to residents: the list on the left; on the right, one question's wording, its state and its tally. */
  import { untrack } from "svelte";

  import LangFields from "./LangFields.svelte";
  import Notice from "./Notice.svelte";
  import Tech from "./Tech.svelte";
  import { get, patch, post, query } from "../lib/api.ts";
  import { commune } from "../lib/commune.svelte.ts";
  import { navigate } from "../lib/route.svelte.ts";
  import { compact, fromLocalInput, langsOf, pick, toLocalInput } from "../lib/text.ts";
  import { ROUND_STATUSES, type Localized, type Round, type RoundStatus } from "../lib/types.ts";
  import { dateTime, failure, roundStatusName, t, ui } from "../lib/ui.svelte.ts";

  let { arg }: { arg: string | null } = $props();

  let status = $state<RoundStatus | "">("");
  let list = $state<Round[] | null>(null);
  let listError = $state<string | null>(null);
  let current = $state<Round | null>(null);
  let loadError = $state<string | null>(null);
  const isNew = $derived(arg === "new");

  let question = $state<Localized>({});
  let detail = $state<Localized>({});
  let options = $state<Localized[]>([{}, {}]);
  let closesAt = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);
  let done = $state<string | null>(null);

  async function loadList() {
    listError = null;
    try {
      list = (await get<{ rounds: Round[] }>(`/rounds${query({ status, drafts: 1 })}`)).rounds;
    } catch (e) {
      listError = failure(e);
      list = [];
    }
  }

  function fill(r: Round | null) {
    question = { ...(r?.question ?? {}) };
    detail = { ...(r?.detail ?? {}) };
    options = r ? r.options.map((o) => ({ ...o })) : [{}, {}];
    closesAt = toLocalInput(r?.closes_at);
    error = null;
    done = null;
  }

  async function load(id: string | null) {
    loadError = null;
    current = null;
    if (id === null) return;
    if (id === "new") {
      fill(null);
      return;
    }
    try {
      current = await get<Round>(`/rounds/${encodeURIComponent(id)}`);
      fill(current);
    } catch (e) {
      loadError = failure(e);
    }
  }

  $effect(() => {
    void status;
    untrack(() => void loadList());
  });
  $effect(() => {
    const id = arg;
    untrack(() => void load(id));
  });

  const editable = $derived(isNew || current?.status === "draft");
  const canClose = $derived(current?.status === "open");

  async function save() {
    if (busy) return;
    busy = true;
    error = null;
    done = null;
    try {
      if (isNew) {
        const created = await post<Round>("/rounds", { question: compact(question), detail: compact(detail), options: options.map(compact), closes_at: fromLocalInput(closesAt) });
        done = t("vote_created");
        void loadList();
        navigate("votes", created.id);
      } else if (current) {
        const body = editable ? { question: compact(question), detail: compact(detail), options: options.map(compact), closes_at: fromLocalInput(closesAt) } : { closes_at: fromLocalInput(closesAt) };
        current = await patch<Round>(`/rounds/${encodeURIComponent(current.id)}`, body);
        fill(current);
        done = t("vote_saved");
        void loadList();
      }
    } catch (e) {
      error = failure(e);
    } finally {
      busy = false;
    }
  }

  async function move(to: "open" | "close" | "publish") {
    if (!current || busy) return;
    busy = true;
    error = null;
    done = null;
    try {
      // The answer to close carries the tally, which the public view hides until it is published.
      const moved = await post<Round>(`/rounds/${encodeURIComponent(current.id)}/${to}`);
      current = { ...moved, result: moved.result ?? current.result };
      closesAt = toLocalInput(current.closes_at);
      void loadList();
    } catch (e) {
      error = failure(e);
    } finally {
      busy = false;
    }
  }

  const addOption = () => (options = [...options, {}]);
  const removeOption = (i: number) => (options = options.filter((_, j) => j !== i));
  const complete = $derived(langsOf(question).length > 0 && options.length >= 2 && options.every((o) => langsOf(o).length > 0));
</script>

<div class="page">
  <h1 class="serif">{t("votes_title")}</h1>
  <div class="split" class:has-item={!!arg}>
    <div class="list-pane">
      <div class="actions top-actions">
        <button class="btn primary small" onclick={() => navigate("votes", "new")}>{t("vote_new")}</button>
      </div>
      <div class="row filters" role="group" aria-label={t("inbox_status")}>
        <button class="chip" aria-pressed={status === ""} onclick={() => (status = "")}>{t("all")}</button>
        {#each ROUND_STATUSES as s (s)}
          <button class="chip" aria-pressed={status === s} onclick={() => (status = s)}>{roundStatusName(s)}</button>
        {/each}
      </div>
      <Notice text={listError} kind="error" />
      {#if list === null}
        <p class="muted pulse">{t("loading")}</p>
      {:else if !list.length}
        <p class="empty">{t("votes_empty")}</p>
      {:else}
        <ul class="list">
          {#each list as r (r.id)}
            <li>
              <button class="entry" aria-current={r.id === arg ? "true" : undefined} onclick={() => navigate("votes", r.id)}>
                <span class="title">{pick(r.question, ui.lang).text}</span>
                <span class="meta">
                  <span class="tag">{roundStatusName(r.status)}</span>
                  {#if r.closes_at}<span class="muted">{t("vote_closes_at", { date: dateTime(r.closes_at) })}</span>{/if}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="work-pane">
      {#if !arg}
        <p class="empty">{t("vote_pick")}</p>
      {:else}
        <button class="back" onclick={() => navigate("votes")}>← {t("back")}</button>
        <Notice text={loadError} kind="error" />
        {#if isNew || current}
          <div class="stack">
            <section class="card stack">
              <div class="row">
                <h2 class="serif">{isNew ? t("vote_new") : pick(current!.question, ui.lang).text}</h2>
                {#if current}<span class="tag amber">{roundStatusName(current.status)}</span>{/if}
              </div>
              {#if current?.opens_at}<p class="m0 muted small">{t("vote_opened_at", { date: dateTime(current.opens_at) })}</p>{/if}
              {#if current?.status === "open"}
                <p class="notice">{t("vote_ballots_so_far", { n: current.ballots_so_far ?? 0 })}</p>
              {/if}
              {#if current?.result}
                <div class="tally">
                  <h3 class="serif">{t("vote_tally")}</h3>
                  <ol class="counts">
                    {#each current.options as o, i (i)}
                      <li><span class="count mono">{current.result.counts[i] ?? 0}</span><span>{pick(o, ui.lang).text}</span></li>
                    {/each}
                  </ol>
                  <p class="m0 muted small">{t("vote_tally_line", { ballots: current.result.ballots, voters: current.result.voters, date: dateTime(current.result.tallied_at) })}</p>
                </div>
              {/if}
              {#if current && current.status !== "draft"}<p class="m0 muted small">{t("vote_frozen")}</p>{/if}

              {#if editable}
                <LangFields id="v-question" label={t("vote_question")} langs={commune.languages} maxlength={300} required bind:value={question} />
                <LangFields id="v-detail" label={t("vote_detail")} langs={commune.languages} multiline maxlength={4000} bind:value={detail} />
                <fieldset>
                  <legend>{t("vote_options")}</legend>
                  <div class="stack">
                    {#each options as _, i (i)}
                      <div class="option-row">
                        <LangFields id="v-option-{i}" label={t("vote_option_n", { n: i + 1 })} langs={commune.languages} maxlength={140} required bind:value={options[i]} />
                        <div class="actions"><button class="btn small" type="button" onclick={() => removeOption(i)} disabled={options.length <= 2}>{t("remove")}</button></div>
                      </div>
                    {/each}
                    <div class="actions"><button class="btn small" type="button" onclick={addOption} disabled={options.length >= 12}>{t("vote_add_option")}</button></div>
                  </div>
                </fieldset>
              {:else if current}
                <p class="quote">{pick(current.detail, ui.lang).text || "—"}</p>
                <ol class="options">
                  {#each current.options as o, i (i)}<li>{pick(o, ui.lang).text}</li>{/each}
                </ol>
              {/if}

              {#if editable || canClose}
                <div class="field">
                  <label class="label" for="v-closes">{t("vote_closes")}</label>
                  <input id="v-closes" type="datetime-local" bind:value={closesAt} />
                  <p class="hint">{t("vote_closes_hint")}</p>
                </div>
              {/if}

              <div class="actions">
                {#if editable || canClose}
                  <button class="btn primary" onclick={save} disabled={busy || (editable && !complete)}>{isNew ? t("create") : t("save")}</button>
                {/if}
                {#if current?.status === "draft"}<button class="btn" onclick={() => move("open")} disabled={busy}>{t("vote_open")}</button>{/if}
                {#if current?.status === "open"}<button class="btn" onclick={() => move("close")} disabled={busy}>{t("vote_close")}</button>{/if}
                {#if current?.status === "closed"}<button class="btn" onclick={() => move("publish")} disabled={busy}>{t("vote_publish")}</button>{/if}
              </div>
              <Notice text={error} kind="error" />
              <Notice text={done} kind="ok" />
            </section>
            {#if current}<Tech rows={[["id", current.id], ["about", current.about_id], ["ballots sha256", current.result?.ballots_sha256]]} />{/if}
          </div>
        {:else if !loadError}
          <p class="muted pulse">{t("loading")}</p>
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .top-actions { margin: 0 0 12px; }
  .filters { margin-bottom: 12px; }
  .m0 { margin: 0; }
  .small { font-size: 0.85rem; }
  .hint { font-size: 0.82rem; margin: 0; }
  .option-row { display: grid; gap: 8px; padding-bottom: 10px; border-bottom: 2px solid var(--line); }
  .options { margin: 0; padding-left: 1.4rem; display: grid; gap: 4px; }
  .tally { display: grid; gap: 8px; border: var(--rule) solid var(--navy); border-left-width: 8px; padding: 0.7rem 0.9rem; }
  .counts { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
  .counts li { display: grid; grid-template-columns: 4rem minmax(0, 1fr); gap: 10px; align-items: baseline; }
  .count { color: var(--red); font-weight: 700; font-size: 1.3rem; text-align: right; }
</style>
