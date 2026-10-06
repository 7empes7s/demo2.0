<script lang="ts">
  /** Residents' ideas: the list by status on the left, one idea and the commune's decision on the right. */
  import { untrack } from "svelte";

  import LangFields from "./LangFields.svelte";
  import Notice from "./Notice.svelte";
  import Tech from "./Tech.svelte";
  import { get, post, query } from "../lib/api.ts";
  import { commune } from "../lib/commune.svelte.ts";
  import { handProcedureFromIdea } from "../lib/handoff.ts";
  import { navigate } from "../lib/route.svelte.ts";
  import { compact, pick } from "../lib/text.ts";
  import { IDEA_STATUSES, type Idea, type IdeaStatus, type Localized, type Procedure } from "../lib/types.ts";
  import { date, failure, ideaStatusName, langName, t, ui } from "../lib/ui.svelte.ts";

  let { arg }: { arg: string | null } = $props();

  let status = $state<IdeaStatus | "">("open");
  let list = $state<Idea[] | null>(null);
  let listError = $state<string | null>(null);
  let idea = $state<Idea | null>(null);
  let ideaError = $state<string | null>(null);
  let procedures = $state<Procedure[]>([]);

  let formStatus = $state<IdeaStatus>("open");
  let formAnswer = $state<Localized>({});
  let formProcedure = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);
  let done = $state<string | null>(null);

  async function loadList() {
    listError = null;
    try {
      list = (await get<{ ideas: Idea[] }>(`/ideas${query({ status, limit: 500 })}`)).ideas;
    } catch (e) {
      listError = failure(e);
      list = [];
    }
  }

  async function loadIdea(id: string) {
    ideaError = null;
    idea = null;
    error = null;
    done = null;
    try {
      const i = await get<Idea>(`/ideas/${encodeURIComponent(id)}`);
      idea = i;
      formStatus = i.status;
      formAnswer = { ...(i.answer ?? {}) };
      formProcedure = i.procedure_id ?? "";
      if (!procedures.length) procedures = (await get<{ procedures: Procedure[] }>("/procedures").catch(() => ({ procedures: [] }))).procedures;
    } catch (e) {
      ideaError = failure(e);
    }
  }

  $effect(() => {
    void status;
    untrack(() => void loadList());
  });
  $effect(() => {
    const id = arg;
    untrack(() => {
      if (id) void loadIdea(id);
      else idea = null;
    });
  });

  const needsAnswer = $derived(formStatus !== "open");
  const hasAnswer = $derived(Object.keys(compact(formAnswer)).length > 0);

  async function decide() {
    if (!idea || busy) return;
    busy = true;
    error = null;
    done = null;
    try {
      const body: Record<string, unknown> = { status: formStatus, answer: compact(formAnswer) };
      if (formStatus === "taken_up" || formProcedure) body.procedure_id = formProcedure || null;
      idea = await post<Idea>(`/ideas/${encodeURIComponent(idea.id)}/decision`, body);
      done = t("idea_decided");
      void loadList();
    } catch (e) {
      error = failure(e);
    } finally {
      busy = false;
    }
  }

  function createProcedure() {
    if (!idea) return;
    handProcedureFromIdea(idea);
    navigate("procedures", "new");
  }
</script>

<div class="page">
  <h1 class="serif">{t("ideas_title")}</h1>
  <div class="split" class:has-item={!!arg}>
    <div class="list-pane">
      <div class="row filters" role="group" aria-label={t("inbox_status")}>
        <button class="chip" aria-pressed={status === ""} onclick={() => (status = "")}>{t("all")}</button>
        {#each IDEA_STATUSES as s (s)}
          <button class="chip" aria-pressed={status === s} onclick={() => (status = s)}>{ideaStatusName(s)}</button>
        {/each}
      </div>
      <Notice text={listError} kind="error" />
      {#if list === null}
        <p class="muted pulse">{t("loading")}</p>
      {:else if !list.length}
        <p class="empty">{t("ideas_empty")}</p>
      {:else}
        <ul class="list">
          {#each list as i (i.id)}
            <li>
              <button class="entry" aria-current={i.id === arg ? "true" : undefined} onclick={() => navigate("ideas", i.id)}>
                <span class="title">{i.title}</span>
                <span class="meta">
                  <span class="tag">{ideaStatusName(i.status)}</span>
                  <span class="muted">{t("idea_supporters", { n: i.supporters })} · {date(i.created_at)}</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="work-pane">
      {#if !arg}
        <p class="empty">{t("idea_pick")}</p>
      {:else}
        <button class="back" onclick={() => navigate("ideas")}>← {t("back")}</button>
        <Notice text={ideaError} kind="error" />
        {#if idea}
          <article class="stack">
            <h2 class="serif title">{idea.title}</h2>
            <div class="row">
              <span class="tag">{ideaStatusName(idea.status)}</span>
              <span class="tag">{langName(idea.lang)}</span>
              <span class="muted">{t("idea_supporters", { n: idea.supporters })} · {t("idea_posted", { date: date(idea.created_at) })}</span>
            </div>
            <blockquote class="quote" lang={idea.lang}>{idea.text}</blockquote>
            {#if idea.answered_at}
              <p class="m0 muted">{t("idea_answered", { date: date(idea.answered_at) })}: {pick(idea.answer, ui.lang).text}</p>
            {/if}

            <section class="card stack">
              <h2 class="serif">{t("idea_decide")}</h2>
              <div class="field">
                <label class="label" for="idea-status">{t("idea_decision")}</label>
                <select id="idea-status" bind:value={formStatus}>
                  {#each IDEA_STATUSES as s (s)}<option value={s}>{ideaStatusName(s)}</option>{/each}
                </select>
                <p class="hint">{t("idea_decision_hint")}</p>
              </div>
              {#if formStatus === "taken_up"}
                <div class="field">
                  <label class="label" for="idea-proc">{t("idea_procedure")}</label>
                  <select id="idea-proc" bind:value={formProcedure}>
                    <option value="">{t("idea_procedure_pick")}</option>
                    {#each procedures as p (p.id)}<option value={p.id}>{pick(p.title, ui.lang).text}</option>{/each}
                  </select>
                </div>
                <div class="actions"><button class="btn small" onclick={createProcedure}>{t("idea_procedure_new")}</button></div>
              {/if}
              <LangFields id="idea-answer" label={t("idea_answer")} langs={commune.languages} multiline required={needsAnswer} bind:value={formAnswer} />
              <div class="actions">
                <button class="btn primary" onclick={decide} disabled={busy || (needsAnswer && !hasAnswer) || (formStatus === "taken_up" && !formProcedure)}>{t("save")}</button>
              </div>
              <Notice text={error} kind="error" />
              <Notice text={done} kind="ok" />
            </section>
            <Tech rows={[["id", idea.id], ["procedure", idea.procedure_id]]} />
          </article>
        {:else if !ideaError}
          <p class="muted pulse">{t("loading")}</p>
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .filters { margin-bottom: 12px; }
  .title { font-size: 1.6rem; }
  .m0 { margin: 0; }
  .hint { font-size: 0.82rem; margin: 0; }
</style>
