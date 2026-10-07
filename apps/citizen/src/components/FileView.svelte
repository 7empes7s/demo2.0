<script lang="ts">
  import type { DocketItem } from "@democracy2/companion";

  import type { CompanionClient, FactChecker } from "../lib/client.ts";
  import { historyOf, kindOf, lastMeeting, nextMeeting, safeUrl, stageOf, statusOf, titleOf, voteKey } from "../lib/data.ts";
  import { langOf, tx } from "../lib/translations.svelte.ts";
  import { date, t, ui } from "../lib/ui.svelte.ts";
  import Challenge from "./Challenge.svelte";
  import ClaimCheck from "./ClaimCheck.svelte";
  import Explain from "./Explain.svelte";
  import FactCheck from "./FactCheck.svelte";
  import FileMeta from "./FileMeta.svelte";
  import OriginalToggle from "./OriginalToggle.svelte";
  import StageTrack from "./StageTrack.svelte";
  import Understand from "./Understand.svelte";

  let {
    item,
    items = [item],
    client,
    checker = null,
    today,
    backLabel = t("back"),
    onback,
  }: {
    item: DocketItem;
    /** Every file in the snapshot: the questions take their wrong answers from the other files. */
    items?: DocketItem[];
    client: CompanionClient | null | undefined;
    /** The claim checker (Provenance). Without it, the Companion checks claims itself (the shareable demo). */
    checker?: FactChecker | null;
    today: string;
    /** Where the back button (phones) leads, in words: the full list unless opened from this week's list. */
    backLabel?: string;
    onback: () => void;
  } = $props();

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
  /** Some official titles run to a whole paragraph: those are set in plain type and folded after a few lines. */
  const title = $derived(tx(titleOf(item)) ?? "");
  const long = $derived(title.length > 110);
  let fullTitle = $state(false);
  $effect(() => {
    void item.id;
    fullTitle = false;
  });
</script>

<article class="file-page">
  <button class="back" onclick={onback}>← {backLabel}</button>

  <header class="head">
    <p class="meta"><FileMeta {item} /></p>
    <h2 class={long ? "title long" : "serif title"} class:folded={long && !fullTitle} lang={langOf(titleOf(item))} id="file-title" tabindex="-1">{title}</h2>
    {#if long}
      <button class="more-title" aria-expanded={fullTitle} onclick={() => (fullTitle = !fullTitle)}>{t(fullTitle ? "title_less" : "title_more")}</button>
    {/if}
    <OriginalToggle />
    {#if item.summary}<p class="summary" lang={langOf(item.summary)}>{tx(item.summary)}</p>{/if}
    <dl class="facts">
      {#if item.author}<div><dt class="label">{t("fact_author")}</dt><dd>{item.author}</dd></div>{/if}
      {#if item.committee}<div><dt class="label">{t("fact_committee")}</dt><dd lang={langOf(item.committee)}>{tx(item.committee)}</dd></div>{/if}
      {#if item.deposited}<div><dt class="label">{t("fact_filed")}</dt><dd>{date(item.deposited)}</dd></div>{/if}
      {#if item.reference}<div><dt class="label">{t("fact_reference")}</dt><dd class="mono">{item.reference}</dd></div>{/if}
      {#if item.theme}<div><dt class="label">{t("fact_theme")}</dt><dd lang={langOf(item.theme)}>{tx(item.theme)}</dd></div>{/if}
      {#if item.opens}<div><dt class="label">{t("fact_opens")}</dt><dd>{date(item.opens)}</dd></div>{/if}
      {#if item.closes}<div><dt class="label">{t("fact_closes")}</dt><dd>{date(item.closes)}</dd></div>{/if}
      {#if item.when}<div><dt class="label">{t("fact_when")}</dt><dd lang={langOf(item.when)}>{tx(item.when)}</dd></div>{/if}
      <div><dt class="label">{t("fact_status")}</dt><dd lang={statusOf(item) ? langOf(statusOf(item)) : ui.lang}>{tx(statusOf(item)) ?? t("status_unknown")}</dd></div>
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
            ? t("next_meeting", { body: tx(m.body), date: date(m.date), time: m.time })
            : t("next_meeting_no_time", { body: tx(m.body), date: date(m.date) })}
        </p>
        {#if m.steps.length}
          <ul class="steps">
            {#each m.steps as step, i (i)}<li lang={langOf(step)}>{tx(step)}</li>{/each}
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
      {#if votes.members?.length}
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
    <details class="fold">
      <summary><h3 id="phases-h" class="serif sub">{t("phases")}</h3><span class="n">{phases.length}</span></summary>
      <ol class="history">
        {#each phases as p, i (i)}
          <li>
            <span class="small muted">{p.start ? date(p.start) : "—"}{#if p.end}{" – "}{date(p.end)}{/if}</span>
            <span lang={langOf(p.title)}>{tx(p.title)}</span>
          </li>
        {/each}
      </ol>
    </details>
  {/if}

  <p class="never">{t("never_recommend")}</p>

  {#if client === undefined}
    <p class="card muted pulse">{t("connecting")}</p>
  {:else if client}
    {#key item.id}
      <Explain {item} {client} />
      <Challenge {item} {client} />
      {#if !checker}<ClaimCheck {item} {client} />{/if}
    {/key}
  {:else}
    <p class="card muted">{t("ai_unavailable")}</p>
  {/if}

  {#if checker}
    {#key item.id}<FactCheck {item} {checker} />{/key}
  {/if}

  {#key item.id}<Understand {item} {items} />{/key}

  <details class="fold">
    <summary><h3 id="docs-h" class="serif sub">{t("documents")}</h3><span class="n">{docs.length}</span></summary>
    <p class="muted small">{t("orig_language")}</p>
    {#if docs.length}
      <ul class="docs">
        {#each docs as doc, i (i)}
          <li>
            <a href={safeUrl(doc.url)} target="_blank" rel="noopener" lang={langOf(doc.label)}>{tx(doc.label)}</a>
            {#if doc.date}<span class="muted small">{date(doc.date)}</span>{/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="muted">{t("no_documents")}</p>
    {/if}
  </details>

  {#if history.length}
    <details class="fold">
      <summary><h3 id="hist-h" class="serif sub">{t("history")}</h3><span class="n">{history.length}</span></summary>
      <ol class="history">
        {#each history as a, i (i)}
          <li>
            <span class="small muted">{a.date ? date(a.date) : "—"}</span>
            <span><span lang={langOf(a.description)}>{tx(a.description)}</span>{#if a.actors.length}<span class="muted"> · {a.actors.join(", ")}</span>{/if}</span>
          </li>
        {/each}
      </ol>
    </details>
  {/if}
</article>

<style>
  .file-page { display: grid; gap: 24px; padding-top: 4px; }
  .back {
    justify-self: start;
    background: none;
    border: 0;
    padding: 4px 0;
    color: var(--fg);
    font-weight: 600;
    cursor: pointer;
  }
  .head { display: grid; gap: 14px; }
  .meta { display: flex; flex-wrap: wrap; gap: 12px; align-items: baseline; margin: 0; }
  .summary { margin: 0; font-size: 1.02rem; }
  .title:focus { outline: none; }
  .title { font-size: clamp(1.6rem, 4.2vw, 2.3rem); line-height: 1.15; }
  .title.long { font-size: clamp(1.2rem, 3vw, 1.45rem); font-weight: 700; line-height: 1.35; overflow-wrap: anywhere; }
  .title.folded { display: -webkit-box; -webkit-line-clamp: 4; line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  .more-title {
    justify-self: start;
    margin-top: -6px;
    background: none;
    border: 0;
    padding: 4px 0;
    color: var(--fg);
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  /* Long sections stay folded until asked for: the name and how many lines are inside. */
  .fold { border-top: var(--rule) solid var(--line); padding-top: 12px; }
  .fold > summary { display: flex; align-items: center; gap: 10px; cursor: pointer; list-style: none; }
  .fold > summary::-webkit-details-marker { display: none; }
  .fold > summary::after { content: "+"; margin-left: auto; font: 900 1.6rem/1 var(--serif); }
  .fold[open] > summary::after { content: "–"; }
  .fold > summary .sub { margin: 0; }
  .fold .n { padding: 0 6px; border: 2px solid var(--line); font: 700 0.8rem/1.5 var(--serif); }
  .fold[open] > summary { margin-bottom: 8px; }
  .facts { display: flex; flex-wrap: wrap; gap: 6px 20px; margin: 0; font-size: 0.92rem; }
  .facts div { display: flex; gap: 6px; align-items: baseline; }
  .facts dd { margin: 0; }
  .links { margin: 0; }
  .next { display: grid; gap: 6px; box-shadow: 7px 7px 0 0 var(--backing-navy), 7px 7px 0 var(--rule) var(--backing); }
  .next p { margin: 0; }
  .when { font-weight: 600; }
  .steps { margin: 4px 0 0; padding-left: 1.2rem; color: var(--muted); }
  .votes { display: grid; gap: 8px; }
  .votes p { margin: 0; }
  .parties { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 0.92rem; }
  .parties li { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  details summary { cursor: pointer; color: var(--fg); font-weight: 600; font-size: 0.92rem; }
  details[open] summary { margin-bottom: 6px; }
  .never {
    margin: 0;
    font-size: 0.88rem;
    color: var(--fg);
    border-top: var(--rule) solid var(--line);
    border-bottom: var(--rule) solid var(--line);
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
