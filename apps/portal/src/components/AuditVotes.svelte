<script lang="ts">
  /** Every vote's ballots by voter number, the recount beside the published tally, and whether they match. */
  import { onMount, untrack } from "svelte";

  import Notice from "./Notice.svelte";
  import Tech from "./Tech.svelte";
  import { get } from "../lib/api.ts";
  import { navigate } from "../lib/route.svelte.ts";
  import { pick, short } from "../lib/text.ts";
  import type { Ballot, Round, Tally } from "../lib/types.ts";
  import { dateTime, failure, roundStatusName, t, ui } from "../lib/ui.svelte.ts";

  let { arg }: { arg: string | null } = $props();

  let rounds = $state<Round[] | null>(null);
  let listError = $state<string | null>(null);
  let round = $state<Round | null>(null);
  let audit = $state<{ ballots: Ballot[]; recount: Tally; published: Tally | null } | null>(null);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      rounds = (await get<{ rounds: Round[] }>("/rounds?drafts=1")).rounds;
    } catch (e) {
      listError = failure(e);
      rounds = [];
    }
  });

  async function load(id: string) {
    error = null;
    round = null;
    audit = null;
    try {
      [round, audit] = await Promise.all([get<Round>(`/rounds/${encodeURIComponent(id)}`), get<{ ballots: Ballot[]; recount: Tally; published: Tally | null }>(`/rounds/${encodeURIComponent(id)}/ballots`)]);
    } catch (e) {
      error = failure(e);
    }
  }

  $effect(() => {
    const id = arg;
    untrack(() => {
      if (id) void load(id);
      else round = audit = null;
    });
  });

  /** Equal counts and the same ballots hash: the published tally is what the ballots say. */
  const match = $derived(
    audit?.published ? audit.published.counts.length === audit.recount.counts.length && audit.published.counts.every((c, i) => c === audit!.recount.counts[i]) && audit.published.ballots_sha256 === audit.recount.ballots_sha256 : null,
  );
</script>

<div class="page">
  <h1 class="serif">{t("audit_votes_title")}</h1>
  <div class="split" class:has-item={!!arg}>
    <div class="list-pane">
      <Notice text={listError} kind="error" />
      {#if rounds === null}
        <p class="muted pulse">{t("loading")}</p>
      {:else if !rounds.length}
        <p class="empty">{t("audit_votes_empty")}</p>
      {:else}
        <ul class="list">
          {#each rounds as r (r.id)}
            <li>
              <button class="entry" aria-current={r.id === arg ? "true" : undefined} onclick={() => navigate("audit-votes", r.id)}>
                <span class="title">{pick(r.question, ui.lang).text}</span>
                <span class="meta"><span class="tag">{roundStatusName(r.status)}</span></span>
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
        <button class="back" onclick={() => navigate("audit-votes")}>← {t("back")}</button>
        <Notice text={error} kind="error" />
        {#if round && audit}
          <div class="stack">
            <section class="card stack">
              <h2 class="serif">{pick(round.question, ui.lang).text}</h2>
              <span class="tag amber">{roundStatusName(round.status)}</span>
              {#if audit.published}
                <p class="notice" class:ok={match === true} class:error={match === false} role="status">{match ? t("audit_match") : t("audit_mismatch")}</p>
              {/if}
              <div class="scroll">
                <table class="data">
                  <thead><tr><th>{t("audit_option")}</th><th>{t("audit_recount")}</th><th>{t("audit_published")}</th></tr></thead>
                  <tbody>
                    {#each round.options as o, i (i)}
                      <tr><td class="wrap">{pick(o, ui.lang).text}</td><td class="num">{audit.recount.counts[i] ?? 0}</td><td class="num">{audit.published ? (audit.published.counts[i] ?? 0) : t("audit_not_published")}</td></tr>
                    {/each}
                  </tbody>
                </table>
              </div>
              <p class="m0 muted small">{t("vote_tally_line", { ballots: audit.recount.ballots, voters: audit.recount.voters, date: dateTime(audit.recount.tallied_at) })}</p>
              <Tech rows={[["id", round.id], [`${t("audit_ballots_hash")} (${t("audit_recount")})`, audit.recount.ballots_sha256], [`${t("audit_ballots_hash")} (${t("audit_published")})`, audit.published?.ballots_sha256]]} />
            </section>
            <section class="stack">
              <h2 class="serif">{t("audit_ballots")}</h2>
              <div class="scroll">
                <table class="data">
                  <thead><tr><th>{t("audit_seq")}</th><th>{t("audit_voter")}</th><th>{t("audit_option")}</th><th>{t("audit_time")}</th></tr></thead>
                  <tbody>
                    {#each audit.ballots as b (b.seq)}
                      <tr><td class="num">{b.seq}</td><td class="num">{b.voter}</td><td class="wrap">{pick(round.options[b.option], ui.lang).text || b.option}</td><td class="mono">{dateTime(b.at)}</td></tr>
                    {/each}
                  </tbody>
                </table>
              </div>
              <p class="m0 muted small mono">{short(audit.recount.ballots_sha256, 16)}</p>
            </section>
          </div>
        {:else if !error}
          <p class="muted pulse">{t("loading")}</p>
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .m0 { margin: 0; }
  .small { font-size: 0.85rem; }
</style>
