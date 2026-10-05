<script lang="ts">
  import type { DocketItem } from "@democracy2/companion";

  import type { CompanionClient } from "../lib/client.ts";
  import { historyOf, kindOf, lastMeeting, nextMeeting, safeUrl, stageOf, statusOf, titleOf, voteKey } from "../lib/data.ts";
  import { date, t, ui } from "../lib/ui.svelte.ts";
  import Challenge from "./Challenge.svelte";
  import ClaimCheck from "./ClaimCheck.svelte";
  import Explain from "./Explain.svelte";
  import FileMeta from "./FileMeta.svelte";
  import StageTrack from "./StageTrack.svelte";

  let {
    item,
    client,
    today,
    onback,
  }: { item: DocketItem; client: CompanionClient | null | undefined; today: string; onback: () => void } = $props();

  const kind = $derived(kindOf(item));
  const meeting = $derived(nextMeeting(item, today));
  const last = $derived(meeting ? undefined : lastMeeting(item, today));
  const votes = $derived(item.votes && Object.keys(item.votes.counts).length ? item.votes : null);
  const phases = $derived(item.phases ?? []);
  /** "Oui" becomes "Yes" in English; a missing vote reads "No vote recorded"; a value the app does not know stays in French. */
  const voteName = (value: string | null) => {
    const key = voteKey(value);
    return key ? t(key) : (value ?? t("vote_none"));
  };
  /** Yes, then no, then abstained, then anything else the council publishes. */
  const ORDER = ["vote_yes", "vote_no", "vote_abstain"];
  const rank = (value: string) => {
    const i = ORDER.indexOf(voteKey(value) ?? "");
    return i < 0 ? ORDER.length : i;
  };
  const tally = (counts: Record<string, number>) =>
    Object.entries(counts)
      .sort(([a], [b]) => rank(a) - rank(b))
      .map(([v, n]) => `${voteName(v)} ${n}`)
      .join(" · ");
  const official = $derived(safeUrl(item.urls[ui.lang] ?? item.urls.fr));
  const docs = $derived(item.documents.filter((d) => safeUrl(d.url)));
  const history = $derived(historyOf(item));
</script>

<article class="file">
  <button class="back" onclick={onback}>← {t("back")}</button>

  <header class="head">
    <p class="meta"><FileMeta {item} /></p>
    <h2 class="serif title" lang="fr" id="file-title" tabindex="-1">{titleOf(item)}</h2>
    {#if item.summary}<p class="summary" lang="fr">{item.summary}</p>{/if}
    <dl class="facts">
      {#if item.author}<div><dt class="label">{t("fact_author")}</dt><dd>{item.author}</dd></div>{/if}
      {#if item.committee}<div><dt class="label">{t("fact_committee")}</dt><dd lang="fr">{item.committee}</dd></div>{/if}
      {#if item.deposited}<div><dt class="label">{t("fact_filed")}</dt><dd>{date(item.deposited)}</dd></div>{/if}
      {#if item.reference}<div><dt class="label">{t("fact_reference")}</dt><dd class="mono">{item.reference}</dd></div>{/if}
      {#if item.theme}<div><dt class="label">{t("fact_theme")}</dt><dd lang="fr">{item.theme}</dd></div>{/if}
      {#if item.opens}<div><dt class="label">{t("fact_opens")}</dt><dd>{date(item.opens)}</dd></div>{/if}
      {#if item.closes}<div><dt class="label">{t("fact_closes")}</dt><dd>{date(item.closes)}</dd></div>{/if}
      {#if item.when}<div><dt class="label">{t("fact_when")}</dt><dd lang="fr">{item.when}</dd></div>{/if}
      <div><dt class="label">{t("fact_status")}</dt><dd lang="fr">{statusOf(item) ?? t("status_unknown")}</dd></div>
    </dl>
    {#if kind === "chamber"}<StageTrack stage={stageOf(item)} />{/if}
    {#if official}
      <p class="links"><a href={official} target="_blank" rel="noopener">{t("official_page")} ↗</a></p>
    {/if}
  </header>

  {#if kind !== "consultation"}
    <section class="card next" aria-labelledby="next-h">
      <h3 id="next-h" class="label">{t(meeting || !last ? "next_label" : "last_label")}</h3>
      {#if meeting ?? last}
        {@const m = (meeting ?? last)!}
        <p class="when">
          {m.time
            ? t("next_meeting", { body: m.body, date: date(m.date), time: m.time })
            : t("next_meeting_no_time", { body: m.body, date: date(m.date) })}
        </p>
        {#if m.steps.length}
          <ul class="steps" lang="fr">
            {#each m.steps as step, i (i)}<li>{step}</li>{/each}
          </ul>
        {/if}
      {:else}
        <p class="muted">{t("no_meeting")}</p>
      {/if}
    </section>
  {/if}

  {#if votes}
    <section class="card votes" aria-labelledby="votes-h">
      <h3 id="votes-h" class="label">{t("votes_title")}</h3>
      <p class="when">{tally(votes.counts)}</p>
      <ul class="parties">
        {#each Object.entries(votes.by_party) as [party, counts] (party)}
          <li><span>{party === "null" || !party ? "—" : party}</span><span class="muted">{tally(counts)}</span></li>
        {/each}
      </ul>
      {#if votes.members.length}
        <details>
          <summary>{t("votes_members")}</summary>
          <ul class="parties">
            {#each votes.members as m, i (i)}
              <li><span>{m.name ?? "—"}{#if m.party && m.party !== "null"}<span class="muted">{" · "}{m.party}</span>{/if}</span><span>{voteName(m.vote)}</span></li>
            {/each}
          </ul>
        </details>
      {/if}
    </section>
  {/if}

  {#if phases.length}
    <section aria-labelledby="phases-h">
      <h3 id="phases-h" class="serif sub">{t("phases")}</h3>
      <ol class="history" lang="fr">
        {#each phases as p, i (i)}
          <li>
            <span class="small muted">{p.start ? date(p.start) : "—"}{#if p.end}{" – "}{date(p.end)}{/if}</span>
            <span>{p.title}</span>
          </li>
        {/each}
      </ol>
    </section>
  {/if}

  <p class="never">{t("never_recommend")}</p>

  {#if client === undefined}
    <p class="card muted pulse">{t("connecting")}</p>
  {:else if client}
    {#key item.id}
      <Explain {item} {client} />
      <Challenge {item} {client} />
      <ClaimCheck {item} {client} />
    {/key}
  {:else}
    <p class="card muted">{t("ai_unavailable")}</p>
  {/if}

  <section aria-labelledby="docs-h">
    <h3 id="docs-h" class="serif sub">{t("documents")}</h3>
    <p class="muted small">{t("orig_language")}</p>
    {#if docs.length}
      <ul class="docs">
        {#each docs as doc, i (i)}
          <li>
            <a href={safeUrl(doc.url)} target="_blank" rel="noopener" lang="fr">{doc.label}</a>
            {#if doc.date}<span class="muted small">{date(doc.date)}</span>{/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">{t("no_documents")}</p>
    {/if}
  </section>

  {#if history.length}
    <section aria-labelledby="hist-h">
      <h3 id="hist-h" class="serif sub">{t("history")}</h3>
      <ol class="history" lang="fr">
        {#each history as a, i (i)}
          <li>
            <span class="small muted">{a.date ? date(a.date) : "—"}</span>
            <span>{a.description}{#if a.actors.length}<span class="muted"> · {a.actors.join(", ")}</span>{/if}</span>
          </li>
        {/each}
      </ol>
    </section>
  {/if}
</article>

<style>
  .file { display: grid; gap: 24px; padding-top: 4px; }
  .back {
    justify-self: start;
    background: none;
    border: 0;
    padding: 4px 0;
    color: var(--accent-fg);
    font-weight: 600;
    cursor: pointer;
  }
  .head { display: grid; gap: 14px; }
  .meta { display: flex; flex-wrap: wrap; gap: 12px; align-items: baseline; margin: 0; }
  .summary { margin: 0; font-size: 1.02rem; }
  .title:focus { outline: none; }
  .title { font-size: clamp(1.6rem, 4.2vw, 2.3rem); line-height: 1.15; }
  .facts { display: flex; flex-wrap: wrap; gap: 6px 20px; margin: 0; font-size: 0.92rem; }
  .facts div { display: flex; gap: 6px; align-items: baseline; }
  .facts dd { margin: 0; }
  .links { margin: 0; }
  .next { display: grid; gap: 6px; border-left: 3px solid var(--accent); }
  .next p { margin: 0; }
  .when { font-weight: 600; }
  .steps { margin: 4px 0 0; padding-left: 1.2rem; color: var(--muted); }
  .votes { display: grid; gap: 8px; }
  .votes p { margin: 0; }
  .parties { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 0.92rem; }
  .parties li { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  details summary { cursor: pointer; color: var(--accent-fg); font-weight: 600; font-size: 0.92rem; }
  details[open] summary { margin-bottom: 6px; }
  .never {
    margin: 0;
    font-size: 0.88rem;
    color: var(--muted);
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    padding-block: 10px;
  }
  .sub { font-size: 1.5rem; margin-bottom: 4px; }
  .small { font-size: 0.82rem; }
  .docs, .history { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 10px; }
  .docs li { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; }
  .history li { display: grid; grid-template-columns: 8.5rem minmax(0, 1fr); gap: 12px; font-size: 0.92rem; }
  @media (min-width: 960px) {
    .back { display: none; }
  }
</style>
