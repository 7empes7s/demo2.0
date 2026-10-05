<script lang="ts">
  import type { DocketItem } from "@democracy2/companion";

  import type { CompanionClient } from "../lib/client.ts";
  import { historyOf, nextMeeting, safeUrl, stageOf, statusOf, titleOf } from "../lib/data.ts";
  import { date, t, ui } from "../lib/ui.svelte.ts";
  import Challenge from "./Challenge.svelte";
  import ClaimCheck from "./ClaimCheck.svelte";
  import Explain from "./Explain.svelte";
  import StageTrack from "./StageTrack.svelte";

  let {
    item,
    client,
    today,
    onback,
  }: { item: DocketItem; client: CompanionClient | null | undefined; today: string; onback: () => void } = $props();

  const meeting = $derived(nextMeeting(item, today));
  const official = $derived(safeUrl(item.urls[ui.lang] ?? item.urls.fr));
  const docs = $derived(item.documents.filter((d) => safeUrl(d.url)));
  const history = $derived(historyOf(item));
</script>

<article class="file">
  <button class="back" onclick={onback}>← {t("back")}</button>

  <header class="head">
    <p class="meta">
      <span class="mono no">N° {item.number}</span>
      {#if item.type_label}<span class="label" lang="fr">{item.type_label}</span>{:else}<span class="label">{t(item.type === "bill" ? "type_bill" : item.type === "debate" ? "type_debate" : "type_other")}</span>{/if}
    </p>
    <h2 class="serif title" lang="fr" id="file-title" tabindex="-1">{titleOf(item)}</h2>
    <dl class="facts">
      {#if item.author}<div><dt class="label">{t("fact_author")}</dt><dd>{item.author}</dd></div>{/if}
      {#if item.committee}<div><dt class="label">{t("fact_committee")}</dt><dd lang="fr">{item.committee}</dd></div>{/if}
      {#if item.deposited}<div><dt class="label">{t("fact_filed")}</dt><dd>{date(item.deposited)}</dd></div>{/if}
      <div><dt class="label">{t("fact_status")}</dt><dd lang="fr">{statusOf(item) ?? t("status_unknown")}</dd></div>
    </dl>
    <StageTrack stage={stageOf(item)} />
    {#if official}
      <p class="links"><a href={official} target="_blank" rel="noopener">{t("official_page")} ↗</a></p>
    {/if}
  </header>

  <section class="card next" aria-labelledby="next-h">
    <h3 id="next-h" class="label">{t("next_label")}</h3>
    {#if meeting}
      <p class="when">
        {meeting.time
          ? t("next_meeting", { body: meeting.body, date: date(meeting.date), time: meeting.time })
          : t("next_meeting_no_time", { body: meeting.body, date: date(meeting.date) })}
      </p>
      {#if meeting.steps.length}
        <ul class="steps" lang="fr">
          {#each meeting.steps as step, i (i)}<li>{step}</li>{/each}
        </ul>
      {/if}
    {:else}
      <p class="muted">{t("no_meeting")}</p>
    {/if}
  </section>

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
  .meta { display: flex; gap: 12px; align-items: baseline; margin: 0; }
  .no { color: var(--accent-fg); font-weight: 500; }
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
