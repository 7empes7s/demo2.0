<script lang="ts">
  import { onMount } from "svelte";

  import { currentStage, localizedText, PROCEDURE_STATUSES, VERDICTS, type About, type DeskClient, type Procedure, type ProcedureDetail, type Stage, type Verdict } from "../lib/desk.ts";
  import { CompanionFailure } from "../lib/errors.ts";
  import { LOCALES, type Key } from "../lib/i18n.ts";
  import { date, t, ui } from "../lib/ui.svelte.ts";
  import SignIn from "./SignIn.svelte";

  /**
   * Official procedures: what the commune is doing, stage by stage, with dated updates. On a
   * finished, stalled or cancelled one a signed-in resident says whether it was done.
   */
  let { client, onfeedback }: { client: DeskClient; onfeedback?: (about: About, title: string) => void } = $props();

  let list = $state<Procedure[] | null>(null);
  let busy = $state(true);
  let failure = $state<Key | null>(null);
  let open = $state<ProcedureDetail | null>(null);
  let opening = $state(false);
  let openFailure = $state<Key | null>(null);
  let verdictBusy = $state(false);
  let verdictFailure = $state<Key | null>(null);
  let askSignIn = $state<Verdict | null>(null);
  const uid = $props.id();

  function failureKey(e: unknown): Key {
    if (e instanceof CompanionFailure && e.kind === "busy") return "ideas_busy";
    if (e instanceof CompanionFailure && e.kind === "not_found") return "desk_not_found";
    if (e instanceof CompanionFailure && e.kind === "signin") return "desk_signin_needed";
    return "desk_unavailable";
  }

  async function load() {
    busy = true;
    failure = null;
    try {
      list = await client.procedures();
    } catch (e) {
      list = null;
      failure = failureKey(e);
    } finally {
      busy = false;
    }
  }

  async function show(p: Procedure) {
    opening = true;
    openFailure = null;
    verdictFailure = null;
    askSignIn = null;
    try {
      open = await client.procedure(p.id);
    } catch (e) {
      open = null;
      openFailure = failureKey(e);
    } finally {
      opening = false;
    }
  }

  function close() {
    open = null;
    openFailure = null;
    askSignIn = null;
  }

  async function give(verdict: Verdict) {
    if (!open || verdictBusy) return;
    if (!client.signedIn()) {
      askSignIn = verdict;
      return;
    }
    verdictBusy = true;
    verdictFailure = null;
    try {
      const answer = await client.verdict(open.id, verdict);
      open = { ...open, verdicts: answer.verdicts, my_verdict: answer.my_verdict ?? verdict };
    } catch (e) {
      if (e instanceof CompanionFailure && e.kind === "signin") askSignIn = verdict;
      else verdictFailure = failureKey(e);
    } finally {
      verdictBusy = false;
    }
  }

  onMount(() => {
    load();
  });

  const title = (p: Procedure) => localizedText(p.title, ui.lang);
  const count = (n: number) => n.toLocaleString(LOCALES[ui.lang]);
  /** Finished one way or another: residents may say whether it was done. */
  const judgeable = (p: Procedure) => p.status === "done" || p.status === "stalled" || p.status === "cancelled";
  const groups = $derived(PROCEDURE_STATUSES.map((status) => ({ status, items: (list ?? []).filter((p) => p.status === status) })).filter((g) => g.items.length));
</script>

{#snippet track(stages: Stage[], withDates: boolean)}
  {@const now = currentStage(stages)}
  <ol class="track" class:dated={withDates} style="--n: {stages.length}" aria-label={t("proc_stages")}>
    {#each stages as s, i (i)}
      {@const name = localizedText(s.name, ui.lang)}
      <li class:done={!!s.done} class:now={i === now && !s.done}>
        <span class="pip" aria-hidden="true"></span>
        <span class="name" lang={name?.lang}>{name?.text ?? ""}</span>
        {#if withDates}
          <span class="when mono">{s.done ? t("proc_done_on", { date: date(s.done) }) : s.planned ? t("proc_planned", { date: date(s.planned) }) : ""}</span>
        {/if}
      </li>
    {/each}
  </ol>
{/snippet}

<div class="procedures">
  {#if open}
    {@const name = title(open)}
    {@const body = localizedText(open.body, ui.lang)}
    <article class="detail" data-state="detail">
      <button class="back" onclick={close}>← {t("proc_back")}</button>
      <div class="marks">
        <span class="tag">{t(`proc_kind_${open.kind}`)}</span>
        <span class="tag status {open.status}">{t(`proc_status_${open.status}`)}</span>
      </div>
      <h3 class="serif title" lang={name?.lang}>{name?.text ?? ""}</h3>
      {#if body}<p class="body" lang={body.lang}>{body.text}</p>{/if}
      <dl class="facts">
        <dt>{t("proc_owner")}</dt><dd>{open.owner}</dd>
        {#if open.started_on}<dt>{t("proc_started")}</dt><dd class="mono">{date(open.started_on)}</dd>{/if}
        {#if open.due_on}<dt>{t("proc_due")}</dt><dd class="mono">{date(open.due_on)}</dd>{/if}
      </dl>

      {#if open.stages.length}
        <section class="card block">
          <h4 class="serif sub">{t("proc_stages")}</h4>
          {@render track(open.stages, true)}
        </section>
      {/if}

      <section class="card block" data-state="updates">
        <h4 class="serif sub">{t("proc_updates")}</h4>
        {#if open.updates.length}
          <ol class="updates">
            {#each [...open.updates].reverse() as u (u.id)}
              {@const text = localizedText(u.text, ui.lang)}
              <li>
                <span class="when mono">{date(u.at)}</span>
                <span class="tag status {u.status_after}">{t(`proc_status_${u.status_after}`)}</span>
                <p lang={text?.lang}>{text?.text ?? ""}</p>
              </li>
            {/each}
          </ol>
        {:else}
          <p class="muted">{t("proc_no_updates")}</p>
        {/if}
      </section>

      {#if open.answers.length}
        <section class="card block" data-state="answers">
          <h4 class="serif sub">{t("proc_answers")}</h4>
          <ol class="answers">
            {#each open.answers as a (a.id)}
              <li>
                {#if a.summary}<p class="muted" lang={a.lang}>{a.summary}</p>{/if}
                <p lang={a.lang}>{a.answer}</p>
                <span class="when mono">{date(a.answered_at)}</span>
              </li>
            {/each}
          </ol>
        </section>
      {/if}

      {#if open.ideas.length}
        <section class="card block" data-state="linked-ideas">
          <h4 class="serif sub">{t("proc_ideas")}</h4>
          <ul class="linked">
            {#each open.ideas as i (i.id)}
              <li><span lang={i.lang}>{i.title}</span> <span class="tag">{t(`idea_status_${i.status}`)}</span></li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if open.links.length}
        <ul class="links">
          {#each open.links as l (l.url)}
            {#if /^https?:\/\//.test(l.url)}<li><a href={l.url} target="_blank" rel="noopener">{l.label} ↗</a></li>{/if}
          {/each}
        </ul>
      {/if}

      {#if judgeable(open)}
        <section class="card block verdicts" data-state="verdict">
          <h4 class="serif sub">{t("proc_verdict_title")}</h4>
          <p class="muted">{t("proc_verdict_hint")}</p>
          <div class="choices" role="group" aria-label={t("proc_verdict_title")}>
            {#each VERDICTS as v (v)}
              <button class="btn" aria-pressed={open.my_verdict === v} disabled={verdictBusy} onclick={() => give(v)} data-verdict={v}>
                {t(`verdict_${v}`)} <span class="n mono">{count(open.verdicts[v])}</span>
              </button>
            {/each}
          </div>
          {#if open.my_verdict}<p class="muted small">{t("proc_verdict_mine")}</p>{/if}
          {#if verdictFailure}<p class="bad" role="alert">{t(verdictFailure)}</p>{/if}
          {#if askSignIn}
            <SignIn {client} why="proc_signin_why" onsignedin={() => { const v = askSignIn; askSignIn = null; if (v) give(v); }} oncancel={() => (askSignIn = null)} />
          {/if}
        </section>
      {/if}

      {#if onfeedback}
        <button class="btn" onclick={() => onfeedback({ kind: "procedure", id: open!.id }, name?.text ?? "")}>{t("proc_feedback")}</button>
      {/if}
    </article>
  {:else}
    <p class="muted intro">{t("proc_intro")}</p>
    <div aria-live="polite" class="status">
      {#if busy || opening}
        <p class="muted pulse" data-state="loading">{t("desk_loading")}</p>
      {:else if failure || openFailure}
        <div class="notice" data-state="unavailable">
          <p>{t(failure ?? openFailure ?? "desk_unavailable")}</p>
          <button class="btn" onclick={failure ? load : close}>{t("ideas_retry")}</button>
        </div>
      {:else if list && list.length === 0}
        <div class="empty" data-state="empty"><p class="serif">{t("proc_empty")}</p></div>
      {/if}
    </div>
    {#if !busy && !opening && !failure && list?.length}
      {#each groups as g (g.status)}
        <section class="group" data-status={g.status} aria-labelledby="{uid}-{g.status}">
          <h3 id="{uid}-{g.status}" class="serif group-title">{t(`proc_status_${g.status}`)}</h3>
          <ol class="list" data-state="list">
            {#each g.items as p (p.id)}
              {@const name = title(p)}
              <li>
                <button class="card proc" onclick={() => show(p)}>
                  <span class="marks"><span class="tag">{t(`proc_kind_${p.kind}`)}</span>{#if p.due_on}<span class="when mono">{t("proc_due_short", { date: date(p.due_on) })}</span>{/if}</span>
                  <span class="serif name" lang={name?.lang}>{name?.text ?? ""}</span>
                  {#if p.stages.length}{@render track(p.stages, false)}{/if}
                  {#if judgeable(p)}
                    <span class="counts muted">{t("proc_verdict_counts", { done: count(p.verdicts.done), work: count(p.verdicts.needs_work), not: count(p.verdicts.not_done) })}</span>
                  {/if}
                </button>
              </li>
            {/each}
          </ol>
        </section>
      {/each}
    {/if}
  {/if}
</div>

<style>
  .procedures { display: grid; gap: 16px; }
  .intro { margin: 0; max-width: 62ch; }
  .status:empty { display: none; }
  .status p { margin: 0; }
  .notice { display: grid; gap: 10px; justify-items: start; padding: 0.8rem 0.9rem; border: var(--rule) solid var(--line); background: var(--surface); }
  .empty { display: grid; place-content: center; text-align: center; min-height: 160px; padding: 24px; border: var(--rule) dashed var(--line); }
  .empty .serif { font-size: 1.45rem; margin: 0; }
  .group { display: grid; gap: 10px; }
  .group-title { font-size: 1.1rem; color: var(--muted); }
  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  .proc { display: grid; gap: 8px; width: 100%; text-align: left; cursor: pointer; font: inherit; }
  .proc .name { font-size: 1.35rem; line-height: 1.05; overflow-wrap: anywhere; }
  .marks { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; font-size: 0.86rem; }
  .tag {
    font: 700 0.72rem/1.5 var(--serif);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 0 6px;
    border: 2px solid var(--line);
    background: var(--surface);
    white-space: nowrap;
  }
  .tag.status.done { background: var(--green-bg); color: var(--green); border-color: var(--green); }
  .tag.status.stalled, .tag.status.cancelled { background: var(--red-bg); color: var(--red); border-color: var(--red); }
  .tag.status.in_progress { background: var(--accent); color: var(--accent-ink); border-color: var(--accent-line); }
  .when { font-size: 0.8rem; color: var(--red); }
  .counts { font-size: 0.86rem; }

  /* The stage track: the look of the file page's track, with the procedure's own stages and dates. */
  .track { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 4px; }
  .track li { display: grid; gap: 6px; font-size: 0.78rem; color: var(--muted); min-width: 0; }
  .track .name { overflow-wrap: anywhere; }
  .pip { height: 6px; border: 2px solid var(--line); background: var(--surface); }
  .track li.done .pip { background: var(--fg); }
  .track li.now .pip { background: var(--accent); }
  .track li.now .name { color: var(--fg); font-weight: 600; }
  .track.dated { grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .track.dated li { grid-template-columns: 14px minmax(0, 1fr); grid-template-rows: auto auto; gap: 2px 10px; font-size: 0.95rem; }
  .track.dated .pip { grid-row: 1 / 3; height: auto; width: 10px; }
  .track.dated .when { grid-column: 2; }
  /* Phone: four stage names side by side would wrap mid-word, so the track turns into rows there. */
  @media (max-width: 599px) {
    .track:not(.dated) { grid-template-columns: minmax(0, 1fr); gap: 6px; }
    .track:not(.dated) li { grid-template-columns: 14px minmax(0, 1fr); align-items: center; gap: 0 10px; font-size: 0.9rem; }
    .track:not(.dated) .pip { width: 10px; height: 10px; }
  }

  .detail { display: grid; gap: 14px; }
  .back { justify-self: start; background: none; border: 0; padding: 4px 0; color: var(--fg); font-weight: 600; cursor: pointer; }
  .title { font-size: clamp(1.5rem, 4.2vw, 2.1rem); line-height: 1.05; overflow-wrap: anywhere; }
  .body { margin: 0; max-width: 68ch; white-space: pre-line; }
  .facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 14px; margin: 0; font-size: 0.92rem; }
  .facts dt { color: var(--muted); white-space: nowrap; }
  .facts dd { margin: 0; overflow-wrap: anywhere; }
  .block { display: grid; gap: 10px; }
  .sub { font-size: 1.05rem; }
  .updates, .answers { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  .updates li, .answers li { display: grid; gap: 4px; }
  .updates li { grid-template-columns: max-content max-content; }
  .updates li p { grid-column: 1 / -1; margin: 0; white-space: pre-line; }
  .answers li p { margin: 0; white-space: pre-line; }
  .linked { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .linked li { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
  .links { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 16px; }
  .choices { display: flex; flex-wrap: wrap; gap: 10px; }
  .choices .n { margin-left: 6px; }
  .small { font-size: 0.86rem; margin: 0; }
  .bad { margin: 0; color: var(--red); font-weight: 600; }
  @media (min-width: 960px) {
    .list, .status, .detail { max-width: 820px; }
  }
</style>
