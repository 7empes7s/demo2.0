<script lang="ts">
  /** The feedback inbox: the list by status on the left, one message and its answer on the right. */
  import { untrack } from "svelte";

  import Notice from "./Notice.svelte";
  import Tech from "./Tech.svelte";
  import { get, patch, post, query } from "../lib/api.ts";
  import { commune } from "../lib/commune.svelte.ts";
  import { navigate } from "../lib/route.svelte.ts";
  import { pick } from "../lib/text.ts";
  import { CATEGORIES, FEEDBACK_STATUSES, type Category, type Feedback, type FeedbackStatus, type Idea, type Lang, type Procedure } from "../lib/types.ts";
  import { categoryName, date, failure, feedbackStatusName, langName, t, ui } from "../lib/ui.svelte.ts";

  let { arg }: { arg: string | null } = $props();

  let status = $state<FeedbackStatus | "">("new");
  let list = $state<Feedback[] | null>(null);
  let listError = $state<string | null>(null);
  let message = $state<Feedback | null>(null);
  let messageError = $state<string | null>(null);
  let aboutTitle = $state<string | null>(null);

  /* The review form. */
  let formStatus = $state<FeedbackStatus>("new");
  let formCategory = $state<Category>("other");
  let formSummary = $state("");
  let answer = $state("");
  let busy = $state<"" | "triage" | "draft" | "review" | "answer">("");
  let error = $state<string | null>(null);
  let done = $state<string | null>(null);
  let suggestion = $state<{ category: Category; summary: string; lang: Lang } | null>(null);
  let drafted = $state(false);

  async function loadList() {
    listError = null;
    try {
      const out = await get<{ feedback: Feedback[] }>(`/feedback${query({ status })}`);
      list = out.feedback;
    } catch (e) {
      listError = failure(e);
      list = [];
    }
  }

  async function loadMessage(id: string) {
    messageError = null;
    message = null;
    aboutTitle = null;
    suggestion = null;
    drafted = false;
    error = null;
    done = null;
    try {
      const f = await get<Feedback>(`/feedback/${encodeURIComponent(id)}`);
      message = f;
      formStatus = f.status;
      formCategory = f.category;
      formSummary = f.summary ?? "";
      answer = f.answer ?? "";
      if (f.about_kind === "procedure" && f.about_id) {
        const p = await get<Procedure>(`/procedures/${encodeURIComponent(f.about_id)}`).catch(() => null);
        aboutTitle = p ? pick(p.title, ui.lang).text : null;
      } else if (f.about_kind === "idea" && f.about_id) {
        const i = await get<Idea>(`/ideas/${encodeURIComponent(f.about_id)}`).catch(() => null);
        aboutTitle = i?.title ?? null;
      }
    } catch (e) {
      messageError = failure(e);
    }
  }

  $effect(() => {
    void status;
    untrack(() => void loadList());
  });
  $effect(() => {
    const id = arg;
    untrack(() => {
      if (id) void loadMessage(id);
      else message = null;
    });
  });

  async function triage() {
    if (!message || busy) return;
    busy = "triage";
    error = null;
    try {
      const out = await post<{ suggestion: { category: Category; summary: string; lang: Lang } }>(`/feedback/${encodeURIComponent(message.id)}/triage`);
      suggestion = out.suggestion;
    } catch (e) {
      error = failure(e);
    } finally {
      busy = "";
    }
  }

  function applySuggestion() {
    if (!suggestion) return;
    formCategory = suggestion.category;
    formSummary = suggestion.summary;
    if (formStatus === "new") formStatus = "in_review";
  }

  async function draft() {
    if (!message || busy) return;
    busy = "draft";
    error = null;
    try {
      const out = await post<{ draft: string }>(`/feedback/${encodeURIComponent(message.id)}/draft`, { context: formSummary || "" });
      answer = out.draft;
      drafted = true;
    } catch (e) {
      error = failure(e);
    } finally {
      busy = "";
    }
  }

  async function saveReview() {
    if (!message || busy) return;
    busy = "review";
    error = null;
    done = null;
    try {
      message = await patch<Feedback>(`/feedback/${encodeURIComponent(message.id)}`, { status: formStatus, category: formCategory, summary: formSummary.trim() || null });
      done = t("saved");
      void loadList();
    } catch (e) {
      error = failure(e);
    } finally {
      busy = "";
    }
  }

  async function send(publish: boolean) {
    if (!message || busy) return;
    busy = "answer";
    error = null;
    done = null;
    try {
      message = await post<Feedback>(`/feedback/${encodeURIComponent(message.id)}/answer`, { answer: answer.trim(), publish });
      formStatus = message.status;
      drafted = false;
      done = publish ? t("answer_published", { what: aboutWord() }) : t("answer_private_sent");
      void loadList();
    } catch (e) {
      error = failure(e);
    } finally {
      busy = "";
    }
  }

  const aboutWord = () => (message?.about_kind === "idea" ? t("the_idea") : t("the_procedure"));
  const aboutLabel = (f: Feedback) => (f.about_kind === "procedure" ? t("feedback_about_procedure") : f.about_kind === "idea" ? t("feedback_about_idea") : t("feedback_about_none"));
</script>

<div class="page">
  <h1 class="serif">{t("inbox_title")}</h1>
  <div class="split" class:has-item={!!arg}>
    <div class="list-pane">
      <div class="row filters" role="group" aria-label={t("inbox_status")}>
        <button class="chip" aria-pressed={status === ""} onclick={() => (status = "")}>{t("all")}</button>
        {#each FEEDBACK_STATUSES as s (s)}
          <button class="chip" aria-pressed={status === s} onclick={() => (status = s)}>{feedbackStatusName(s)}</button>
        {/each}
      </div>
      <Notice text={listError} kind="error" />
      {#if list === null}
        <p class="muted pulse">{t("loading")}</p>
      {:else if !list.length}
        <p class="empty">{t("inbox_empty")}</p>
      {:else}
        <ul class="list">
          {#each list as f (f.id)}
            <li>
              <button class="entry" aria-current={f.id === arg ? "true" : undefined} onclick={() => navigate("inbox", f.id)}>
                <span class="title">{f.summary || f.text.slice(0, 120)}</span>
                <span class="meta">
                  <span class="tag">{feedbackStatusName(f.status)}</span>
                  <span class="muted">{categoryName(f.category)} · {date(f.created_at)}</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="work-pane">
      {#if !arg}
        <p class="empty">{t("inbox_pick")}</p>
      {:else}
        <button class="back" onclick={() => navigate("inbox")}>← {t("back")}</button>
        <Notice text={messageError} kind="error" />
        {#if message}
          <article class="stack">
            <div class="row">
              <span class="tag">{feedbackStatusName(message.status)}</span>
              <span class="tag">{categoryName(message.category)}</span>
              <span class="tag">{langName(message.lang)}</span>
              <span class="muted">{message.enrolled ? t("feedback_from_resident") : t("feedback_anonymous")} · {t("feedback_received", { date: date(message.created_at) })}</span>
            </div>
            <p class="muted about">{aboutLabel(message)}{aboutTitle ? `: ${aboutTitle}` : ""}</p>
            <blockquote class="quote" lang={message.lang}>{message.text}</blockquote>

            <section class="card stack">
              <h2 class="serif">{t("summary")}</h2>
              <div class="actions">
                <button class="btn small" onclick={triage} disabled={!!busy || !commune.model} title={commune.model ? "" : t("model_off")}>{busy === "triage" ? t("triage_busy") : t("triage_go")}</button>
              </div>
              {#if !commune.model}<p class="hint muted">{t("model_off")}</p>{/if}
              {#if suggestion}
                <div class="model">
                  <span class="label">{t("model_label")}</span>
                  <p class="m0">{t("triage_result", { category: categoryName(suggestion.category), lang: langName(suggestion.lang) })}</p>
                  <p class="m0">{suggestion.summary}</p>
                  <div class="actions"><button class="btn small" onclick={applySuggestion}>{t("apply_suggestion")}</button></div>
                </div>
              {/if}
              <div class="fields two">
                <div class="field">
                  <label class="label" for="fb-status">{t("inbox_status")}</label>
                  <select id="fb-status" bind:value={formStatus}>
                    {#each FEEDBACK_STATUSES as s (s)}<option value={s}>{feedbackStatusName(s)}</option>{/each}
                  </select>
                </div>
                <div class="field">
                  <label class="label" for="fb-cat">{t("category")}</label>
                  <select id="fb-cat" bind:value={formCategory}>
                    {#each CATEGORIES as c (c)}<option value={c}>{categoryName(c)}</option>{/each}
                  </select>
                </div>
              </div>
              <div class="field">
                <label class="label" for="fb-summary">{t("summary")}</label>
                <input id="fb-summary" type="text" maxlength="300" bind:value={formSummary} />
                <p class="hint">{t("summary_hint")}</p>
              </div>
              <div class="actions">
                <button class="btn" onclick={saveReview} disabled={!!busy}>{t("review_save")}</button>
              </div>
            </section>

            <section class="card stack">
              <h2 class="serif">{t("answer")}</h2>
              {#if message.answered_at}
                <p class="m0 muted">{t("answered_on", { date: date(message.answered_at) })} · {message.answer_public ? t("answer_published", { what: aboutWord() }) : t("answer_private_sent")}</p>
              {/if}
              <div class="actions">
                <button class="btn small" onclick={draft} disabled={!!busy || !commune.model}>{busy === "draft" ? t("draft_busy") : t("draft_go")}</button>
              </div>
              <div class:model={drafted} class="field">
                {#if drafted}<span class="label">{t("model_label")}</span>{/if}
                <label class="label" for="fb-answer">{t("answer")}</label>
                <textarea id="fb-answer" maxlength="4000" bind:value={answer}></textarea>
                <p class="hint">{t("answer_hint")}</p>
              </div>
              <div class="actions">
                <button class="btn primary" onclick={() => send(false)} disabled={!!busy || answer.trim().length < 2}>{t("answer_private")}</button>
                {#if message.about_kind !== "none"}
                  <button class="btn" onclick={() => send(true)} disabled={!!busy || answer.trim().length < 2}>{t("answer_publish", { what: aboutWord() })}</button>
                {/if}
              </div>
              {#if message.about_kind === "none"}<p class="hint muted">{t("publish_needs_about")}</p>{/if}
            </section>

            <Notice text={error} kind="error" />
            <Notice text={done} kind="ok" />
            <Tech rows={[[t("feedback_code"), message.code], ["id", message.id], ["about", message.about_id]]} />
          </article>
        {:else if !messageError}
          <p class="muted pulse">{t("loading")}</p>
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .filters { margin-bottom: 12px; }
  .about { margin: 0; font-size: 0.9rem; }
  .m0 { margin: 0; }
  .hint { font-size: 0.82rem; margin: 0; }
</style>
