<script lang="ts">
  import { onMount } from "svelte";

  import { localizedText, shares, type DeskClient, type Round } from "../lib/desk.ts";
  import { CompanionFailure } from "../lib/errors.ts";
  import { LOCALES, type Key } from "../lib/i18n.ts";
  import { date, t, ui } from "../lib/ui.svelte.ts";
  import SignIn from "./SignIn.svelte";

  /**
   * The questions the commune puts to residents. While a question is open a signed-in resident
   * picks an option and can change it; counts stay hidden until the commune publishes the result.
   */
  let { client }: { client: DeskClient } = $props();

  let rounds = $state<Round[] | null>(null);
  /** The resident's own ballot per open question, fetched when signed in. */
  let mine = $state<Record<string, number>>({});
  let busy = $state(true);
  let failure = $state<Key | null>(null);
  let casting = $state<string | null>(null);
  let castFailure = $state<Key | null>(null);
  let pending = $state<{ id: string; option: number } | null>(null);
  const uid = $props.id();

  function failureKey(e: unknown): Key {
    if (e instanceof CompanionFailure && e.kind === "busy") return "ideas_busy";
    if (e instanceof CompanionFailure && e.kind === "not_found") return "desk_not_found";
    if (e instanceof CompanionFailure && e.kind === "unavailable") return "desk_unavailable";
    return "error";
  }

  async function load() {
    busy = true;
    failure = null;
    try {
      const list = await client.rounds();
      const own: Record<string, number> = {};
      if (client.signedIn()) {
        await Promise.all(
          list.filter((r) => r.status === "open").map(async (r) => {
            try {
              const detail = await client.round(r.id);
              if (detail.my_ballot) own[r.id] = detail.my_ballot.option;
            } catch {
              // Without the ballot the question still shows; a pick fetches it anew.
            }
          }),
        );
      }
      rounds = list;
      mine = own;
    } catch (e) {
      rounds = null;
      failure = failureKey(e);
    } finally {
      busy = false;
    }
  }

  async function cast(round: Round, option: number) {
    if (casting) return;
    if (!client.signedIn()) {
      pending = { id: round.id, option };
      return;
    }
    casting = round.id;
    castFailure = null;
    try {
      const answer = await client.ballot(round.id, option);
      mine = { ...mine, [round.id]: answer.option };
    } catch (e) {
      if (e instanceof CompanionFailure && e.kind === "signin") pending = { id: round.id, option };
      else castFailure = failureKey(e);
    } finally {
      casting = null;
    }
  }

  function signedIn() {
    const todo = pending;
    pending = null;
    const round = todo && rounds?.find((r) => r.id === todo.id);
    if (todo && round) cast(round, todo.option);
  }

  onMount(() => {
    load();
  });

  const count = (n: number) => n.toLocaleString(LOCALES[ui.lang]);
  const open = $derived((rounds ?? []).filter((r) => r.status === "open"));
  const closed = $derived((rounds ?? []).filter((r) => r.status !== "open"));
</script>

{#snippet question(r: Round)}
  {@const q = localizedText(r.question, ui.lang)}
  {@const d = localizedText(r.detail, ui.lang)}
  <h3 id="{uid}-{r.id}" class="serif q" lang={q?.lang}>{q?.text ?? ""}</h3>
  {#if d}<p class="detail" lang={d.lang}>{d.text}</p>{/if}
{/snippet}

<div class="votes">
  <p class="muted intro">{t("votes_intro")}</p>

  {#if pending}
    <SignIn {client} why="vote_signin_why" onsignedin={signedIn} oncancel={() => (pending = null)} />
  {/if}

  <div aria-live="polite" class="status">
    {#if busy}
      <p class="muted pulse" data-state="loading">{t("desk_loading")}</p>
    {:else if failure}
      <div class="notice" data-state="unavailable">
        <p>{t(failure)}</p>
        <button class="btn" onclick={load}>{t("ideas_retry")}</button>
      </div>
    {:else if rounds && rounds.length === 0}
      <div class="empty" data-state="empty"><p class="serif">{t("vote_empty")}</p></div>
    {/if}
  </div>

  {#if !busy && !failure && rounds?.length}
    {#if open.length}
      <section class="group" aria-labelledby="{uid}-open">
        <h3 id="{uid}-open" class="serif group-title">{t("vote_open")}</h3>
        <ol class="list" data-state="open">
          {#each open as r (r.id)}
            <li class="card round" aria-labelledby="{uid}-{r.id}">
              <div class="meta">
                <span class="tag open">{t("vote_open")}</span>
                {#if r.closes_at}<span class="muted">{t("vote_closes", { date: date(r.closes_at) })}</span>{/if}
              </div>
              {@render question(r)}
              <div class="options" role="group" aria-label={t("vote_pick")}>
                {#each r.options as o, i (i)}
                  {@const label = localizedText(o, ui.lang)}
                  <button class="btn option" aria-pressed={mine[r.id] === i} disabled={casting === r.id} onclick={() => cast(r, i)} data-option={i} lang={label?.lang}>
                    {label?.text ?? ""}
                  </button>
                {/each}
              </div>
              {#if mine[r.id] !== undefined}<p class="ok" role="status" data-state="cast">{t("vote_cast")} {t("vote_change")}</p>{/if}
              {#if castFailure && casting === null}<p class="bad" role="alert">{t(castFailure)}</p>{/if}
              <p class="muted small">{r.ballots_so_far !== null ? t("vote_so_far", { n: count(r.ballots_so_far) }) : ""} {t("vote_hidden")}</p>
            </li>
          {/each}
        </ol>
      </section>
    {/if}

    {#if closed.length}
      <section class="group" aria-labelledby="{uid}-closed">
        <h3 id="{uid}-closed" class="serif group-title">{t("vote_closed")}</h3>
        <ol class="list" data-state="closed">
          {#each closed as r (r.id)}
            {@const pct = r.result ? shares(r.result.counts) : null}
            <li class="card round" aria-labelledby="{uid}-{r.id}" data-status={r.status}>
              <div class="meta">
                <span class="tag">{t(r.status === "published" ? "vote_published" : "vote_closed")}</span>
                {#if r.closes_at}<span class="muted">{t("vote_closed_on", { date: date(r.closes_at) })}</span>{/if}
              </div>
              {@render question(r)}
              {#if r.result && pct}
                <ol class="tally" data-state="tally">
                  {#each r.options as o, i (i)}
                    {@const label = localizedText(o, ui.lang)}
                    <li>
                      <span class="opt" lang={label?.lang}>{label?.text ?? ""}</span>
                      <span class="n mono">{count(r.result.counts[i] ?? 0)}</span>
                      <span class="bar" aria-hidden="true"><span class="fill" style="width: {pct[i]}%"></span></span>
                      <span class="pct mono">{pct[i]} %</span>
                    </li>
                  {/each}
                </ol>
                <p class="muted small">{t("vote_voters", { n: count(r.result.voters) })}</p>
              {:else}
                <p class="muted">{t("vote_closed_pending")}</p>
              {/if}
            </li>
          {/each}
        </ol>
      </section>
    {/if}
  {/if}
</div>

<style>
  .votes { display: grid; gap: 16px; }
  .intro { margin: 0; max-width: 62ch; }
  .status:empty { display: none; }
  .status p { margin: 0; }
  .notice { display: grid; gap: 10px; justify-items: start; padding: 0.8rem 0.9rem; border: var(--rule) solid var(--line); background: var(--surface); }
  .empty { display: grid; place-content: center; text-align: center; min-height: 160px; padding: 24px; border: var(--rule) dashed var(--line); }
  .empty .serif { font-size: 1.45rem; margin: 0; }
  .group { display: grid; gap: 10px; }
  .group-title { font-size: 1.1rem; color: var(--muted); }
  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  .round { display: grid; gap: 10px; align-content: start; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; font-size: 0.86rem; }
  .tag { font: 700 0.72rem/1.5 var(--serif); letter-spacing: 0.04em; text-transform: uppercase; padding: 0 6px; border: 2px solid var(--line); background: var(--surface); }
  .tag.open { background: var(--accent); color: var(--accent-ink); border-color: var(--accent-line); }
  .q { font-size: 1.4rem; line-height: 1.1; overflow-wrap: anywhere; }
  .detail { margin: 0; max-width: 68ch; white-space: pre-line; }
  .options { display: grid; gap: 10px; }
  .option { text-align: left; white-space: normal; line-height: 1.3; }
  .ok { margin: 0; font-weight: 600; }
  .bad { margin: 0; color: var(--red); font-weight: 600; }
  .small { font-size: 0.86rem; margin: 0; }
  /* The tally: one row per option, label on its own line, then count, bar and share. */
  .tally { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  .tally li { display: grid; grid-template-columns: max-content minmax(0, 1fr) max-content; gap: 4px 10px; align-items: center; }
  .opt { grid-column: 1 / -1; overflow-wrap: anywhere; }
  .n { font-weight: 700; color: var(--red); min-width: 2.5ch; text-align: right; }
  .bar { display: block; height: 14px; border: 2px solid var(--line); background: var(--surface); }
  .fill { display: block; height: 100%; background: var(--backing-navy); }
  .pct { font-size: 0.86rem; }
  @media (min-width: 960px) {
    .list, .status { max-width: 820px; }
    .options { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
  }
</style>
