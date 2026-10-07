<script lang="ts">
  import { LANGS, type Lang } from "@democracy2/companion";
  import { onMount } from "svelte";

  import { localizedText, type About, type DeskClient, type Idea } from "../lib/desk.ts";
  import { CompanionFailure } from "../lib/errors.ts";
  import { LANG_LABELS, LOCALES, type Key } from "../lib/i18n.ts";
  import { ageOf, supportKey } from "../lib/ideas.ts";
  import { date, t, ui } from "../lib/ui.svelte.ts";
  import SignIn from "./SignIn.svelte";

  /**
   * Ideas on the commune's desk: residents post them and support others' (one support per
   * resident, never your own). Posting and supporting ask for the enrolment code first.
   */
  let { client, now = Date.now, onfeedback }: { client: DeskClient; now?: () => number; onfeedback?: (about: About, title: string) => void } = $props();

  let ideas = $state<Idea[] | null>(null);
  let busy = $state(true);
  let failure = $state<Key | null>(null);
  /** What to do once signed in: post the draft, or support an idea. */
  let pending = $state<{ kind: "post" } | { kind: "support"; id: string; on: boolean } | null>(null);
  let supporting = $state<string | null>(null);
  let actionFailure = $state<Key | null>(null);
  let composing = $state(false);
  let draft = $state({ lang: ui.lang as Lang, title: "", text: "" });
  let posting = $state(false);
  let posted = $state(false);
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
      ideas = await client.ideas();
    } catch (e) {
      ideas = null;
      failure = failureKey(e);
    } finally {
      busy = false;
    }
  }

  async function support(idea: Idea) {
    if (supporting) return;
    const on = !idea.supported;
    if (!client.signedIn()) {
      pending = { kind: "support", id: idea.id, on };
      return;
    }
    supporting = idea.id;
    actionFailure = null;
    try {
      const updated = await client.support(idea.id, on);
      ideas = (ideas ?? []).map((i) => (i.id === updated.id ? updated : i));
    } catch (e) {
      if (e instanceof CompanionFailure && e.kind === "signin") pending = { kind: "support", id: idea.id, on };
      else actionFailure = failureKey(e);
    } finally {
      supporting = null;
    }
  }

  async function post(e?: SubmitEvent) {
    e?.preventDefault();
    const title = draft.title.trim();
    const text = draft.text.trim();
    if (!title || !text || posting) return;
    if (!client.signedIn()) {
      pending = { kind: "post" };
      return;
    }
    posting = true;
    actionFailure = null;
    try {
      const idea = await client.postIdea({ lang: draft.lang, title, text });
      ideas = [idea, ...(ideas ?? [])];
      draft = { lang: ui.lang, title: "", text: "" };
      composing = false;
      posted = true;
    } catch (err) {
      if (err instanceof CompanionFailure && err.kind === "signin") pending = { kind: "post" };
      else actionFailure = failureKey(err);
    } finally {
      posting = false;
    }
  }

  function signedIn() {
    const todo = pending;
    pending = null;
    if (!todo) return;
    if (todo.kind === "post") post();
    else {
      const idea = ideas?.find((i) => i.id === todo.id);
      if (idea) support({ ...idea, supported: !todo.on });
    }
  }

  onMount(() => {
    load();
  });

  const count = (n: number) => n.toLocaleString(LOCALES[ui.lang]);
  /** Supporting is open only while the commune has not decided (or has taken the idea up). */
  const supportable = (i: Idea) => i.status === "open" || i.status === "taken_up";
</script>

<div class="ideas">
  <p class="muted intro">{t("didea_intro")}</p>

  {#if pending}
    <SignIn {client} why="idea_signin_why" onsignedin={signedIn} oncancel={() => (pending = null)} />
  {/if}

  <section class="compose" data-state="compose">
    {#if composing}
      <form class="card form" onsubmit={post} aria-labelledby="{uid}-post">
        <h3 id="{uid}-post" class="serif">{t("idea_post_title")}</h3>
        <label class="label" for="{uid}-lang">{t("idea_post_lang")}</label>
        <select id="{uid}-lang" bind:value={draft.lang} disabled={posting}>
          {#each LANGS as l (l)}<option value={l}>{LANG_LABELS[l]}</option>{/each}
        </select>
        <label class="label" for="{uid}-title">{t("idea_post_name")}</label>
        <input id="{uid}-title" bind:value={draft.title} maxlength="140" required disabled={posting} />
        <label class="label" for="{uid}-text">{t("idea_post_text")}</label>
        <textarea id="{uid}-text" bind:value={draft.text} rows="5" maxlength="4000" required disabled={posting}></textarea>
        <div class="row">
          <button class="btn primary" type="submit" disabled={posting}>{t("idea_post_go")}</button>
          <button class="btn" type="button" onclick={() => (composing = false)} disabled={posting}>{t("signin_cancel")}</button>
        </div>
      </form>
    {:else}
      <button class="btn primary" onclick={() => { composing = true; posted = false; }}>{t("idea_post_title")}</button>
      {#if posted}<p class="ok" role="status" data-state="posted">{t("idea_posted")}</p>{/if}
    {/if}
    {#if actionFailure}<p class="bad" role="alert">{t(actionFailure)}</p>{/if}
  </section>

  <div aria-live="polite" class="status">
    {#if busy}
      <p class="muted pulse" data-state="loading">{t("ideas_loading")}</p>
    {:else if failure}
      <div class="notice" data-state="unavailable">
        <p>{t(failure)}</p>
        <button class="btn" onclick={load}>{t("ideas_retry")}</button>
      </div>
    {:else if ideas && ideas.length === 0}
      <div class="empty" data-state="empty"><p class="serif">{t("ideas_empty")}</p></div>
    {/if}
  </div>

  {#if !busy && !failure && ideas?.length}
    <ol class="list" data-state="list">
      {#each ideas as idea (idea.id)}
        {@const age = ageOf(idea.created_at, now())}
        {@const answer = localizedText(idea.answer, ui.lang)}
        <li class="card idea" data-status={idea.status} aria-labelledby="{uid}-{idea.id}">
          <div class="meta">
            <span class="tag {idea.status}">{t(`idea_status_${idea.status}`)}</span>
            {#if idea.mine}<span class="tag mine">{t("idea_yours")}</span>{/if}
            <span class="muted">{t(age.key, { n: age.n ?? 0, date: date(idea.created_at) })}</span>
          </div>
          <h3 id="{uid}-{idea.id}" class="serif" lang={idea.lang}>{idea.title}</h3>
          <p class="text" lang={idea.lang}>{idea.text}</p>
          {#if answer}
            <div class="answer" data-state="answer">
              <span class="label">{t("idea_answer")}</span>
              <p lang={answer.lang}>{answer.text}</p>
            </div>
          {/if}
          {#each idea.answers as a (a.id)}
            <div class="answer" data-state="answer">
              <span class="label">{t("idea_answer")}</span>
              {#if a.summary}<p class="muted" lang={a.lang}>{a.summary}</p>{/if}
              <p lang={a.lang}>{a.answer}</p>
            </div>
          {/each}
          <div class="support-row">
            <span class="support" data-support={idea.supporters}>{t(supportKey(ui.lang, idea.supporters), { n: count(idea.supporters) })}</span>
            {#if supportable(idea) && !idea.mine}
              <button class="btn small" aria-pressed={idea.supported} disabled={supporting === idea.id} onclick={() => support(idea)} data-action="support">
                {t(idea.supported ? "idea_supported" : "idea_support")}
              </button>
            {/if}
            {#if onfeedback}
              <button class="link" onclick={() => onfeedback({ kind: "idea", id: idea.id }, idea.title)}>{t("proc_feedback")}</button>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  .ideas { display: grid; gap: 16px; }
  .intro { margin: 0; max-width: 62ch; }
  .compose { display: grid; gap: 10px; justify-items: start; }
  .form { display: grid; gap: 8px; justify-items: start; width: 100%; max-width: 640px; }
  .form h3 { font-size: 1.4rem; }
  .form label { margin-top: 4px; }
  input, textarea, select { width: 100%; background: var(--surface); border: var(--rule) solid var(--line); padding: 0.55rem 0.8rem; }
  textarea { resize: vertical; }
  .row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
  .ok { margin: 0; font-weight: 600; }
  .bad { margin: 0; color: var(--red); font-weight: 600; }
  .status:empty { display: none; }
  .status p { margin: 0; }
  .notice { display: grid; gap: 10px; justify-items: start; padding: 0.8rem 0.9rem; border: var(--rule) solid var(--line); background: var(--surface); }
  .empty { display: grid; place-content: center; text-align: center; min-height: 160px; padding: 24px; border: var(--rule) dashed var(--line); }
  .empty .serif { font-size: 1.45rem; margin: 0; }
  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  .idea { display: grid; gap: 8px; align-content: start; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; font-size: 0.86rem; }
  .tag {
    font: 700 0.72rem/1.5 var(--serif);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 0 6px;
    border: 2px solid var(--line);
    background: var(--surface);
  }
  .tag.taken_up { background: var(--accent); color: var(--accent-ink); border-color: var(--accent-line); }
  .tag.declined { background: var(--red-bg); color: var(--red); border-color: var(--red); }
  .tag.answered, .tag.merged { background: var(--surface-2); }
  .tag.mine { background: var(--pressed-bg); color: var(--pressed-fg); border-color: var(--pressed-bg); }
  .idea h3 { font-size: 1.45rem; line-height: 1.2; overflow-wrap: anywhere; }
  .text { margin: 0; max-width: 68ch; white-space: pre-line; overflow-wrap: anywhere; }
  .answer { display: grid; gap: 4px; padding: 0.6rem 0.8rem; border-left: 4px solid var(--backing-navy); background: var(--surface-2); }
  .answer p { margin: 0; white-space: pre-line; }
  .support-row { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; }
  .support { font-weight: 600; font-size: 0.92rem; }
  .link { background: none; border: 0; padding: 0; color: var(--accent-fg); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; font-size: 0.9rem; }
  @media (min-width: 960px) {
    .list, .status { max-width: 820px; }
    .list { gap: 14px; }
    .idea { padding: 1.3rem 1.5rem; }
  }
</style>
