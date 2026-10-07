<script lang="ts">
  /** Procedures: the list on the left; on the right, one procedure's form and its dated updates, or a new one. */
  import { untrack } from "svelte";

  import LangFields from "./LangFields.svelte";
  import Notice from "./Notice.svelte";
  import Tech from "./Tech.svelte";
  import { get, patch, post, query } from "../lib/api.ts";
  import { commune } from "../lib/commune.svelte.ts";
  import { takeProcedureFromIdea } from "../lib/handoff.ts";
  import { navigate } from "../lib/route.svelte.ts";
  import { compact, langsOf, pick } from "../lib/text.ts";
  import { PROCEDURE_KINDS, PROCEDURE_STATUSES, type Lang, type Link, type Localized, type Procedure, type ProcedureKind, type ProcedureStatus, type Stage } from "../lib/types.ts";
  import { date, failure, kindName, langName, procedureStatusName, t, ui } from "../lib/ui.svelte.ts";

  let { arg }: { arg: string | null } = $props();

  let status = $state<ProcedureStatus | "">("");
  let list = $state<Procedure[] | null>(null);
  let listError = $state<string | null>(null);
  let current = $state<Procedure | null>(null);
  let loadError = $state<string | null>(null);

  const isNew = $derived(arg === "new");

  /* The form. */
  let title = $state<Localized>({});
  let body = $state<Localized>({});
  let kind = $state<ProcedureKind>("project");
  let formStatus = $state<ProcedureStatus>("planned");
  let owner = $state("");
  let startedOn = $state("");
  let dueOn = $state("");
  let stages = $state<Stage[]>([]);
  let links = $state<Link[]>([]);
  let busy = $state<"" | "save" | "translate" | "update" | "translate-update">("");
  let error = $state<string | null>(null);
  let done = $state<string | null>(null);
  let translated = $state(false);

  /* A new update. */
  let updateText = $state<Localized>({});
  let updateStatus = $state<ProcedureStatus | "">("");
  let updateTranslated = $state(false);

  async function loadList() {
    listError = null;
    try {
      list = (await get<{ procedures: Procedure[] }>(`/procedures${query({ status })}`)).procedures;
    } catch (e) {
      listError = failure(e);
      list = [];
    }
  }

  function fill(p: Procedure | null) {
    title = { ...(p?.title ?? {}) };
    body = { ...(p?.body ?? {}) };
    kind = p?.kind ?? "project";
    formStatus = p?.status ?? "planned";
    owner = p?.owner ?? "";
    startedOn = p?.started_on ?? "";
    dueOn = p?.due_on ?? "";
    stages = (p?.stages ?? []).map((s) => ({ name: { ...s.name }, planned: s.planned ?? "", done: s.done ?? "" }));
    links = (p?.links ?? []).map((l) => ({ ...l }));
    translated = false;
    updateText = {};
    updateStatus = "";
    updateTranslated = false;
    error = null;
    done = null;
  }

  async function load(id: string | null) {
    loadError = null;
    current = null;
    if (id === null) return;
    if (id === "new") {
      fill(null);
      const idea = takeProcedureFromIdea();
      if (idea) {
        title = { [idea.lang]: idea.title.slice(0, 140) };
        body = { [idea.lang]: idea.text };
        kind = "request";
      }
      return;
    }
    try {
      current = await get<Procedure>(`/procedures/${encodeURIComponent(id)}`);
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

  function payload() {
    return {
      kind,
      status: formStatus,
      title: compact(title),
      body: compact(body),
      owner: owner.trim(),
      started_on: startedOn || null,
      due_on: dueOn || null,
      stages: stages.map((s) => ({ name: compact(s.name), planned: s.planned || null, done: s.done || null })),
      links: links.map((l) => ({ label: l.label.trim(), url: l.url.trim() })),
    };
  }

  async function save() {
    if (busy) return;
    busy = "save";
    error = null;
    done = null;
    try {
      if (isNew) {
        const created = await post<Procedure>("/procedures", payload());
        done = t("procedure_created");
        void loadList();
        navigate("procedures", created.id);
      } else if (current) {
        current = await patch<Procedure>(`/procedures/${encodeURIComponent(current.id)}`, payload());
        fill(current);
        done = t("procedure_saved");
        void loadList();
      }
    } catch (e) {
      error = failure(e);
    } finally {
      busy = "";
    }
  }

  /** Fills the languages a text is missing, from the first language it has. */
  async function fillMissing(loc: Localized): Promise<Localized> {
    const from = langsOf(loc)[0];
    if (!from) return loc;
    const to = commune.languages.filter((l) => l !== from && !loc[l]);
    if (!to.length) return loc;
    const out = await post<{ translations: Localized }>("/ai/translate", { text: loc[from], from, to });
    return { ...loc, ...out.translations };
  }

  async function translateForm() {
    if (busy) return;
    busy = "translate";
    error = null;
    try {
      title = await fillMissing(title);
      body = await fillMissing(body);
      translated = true;
    } catch (e) {
      error = failure(e);
    } finally {
      busy = "";
    }
  }

  async function translateUpdate() {
    if (busy) return;
    busy = "translate-update";
    error = null;
    try {
      updateText = await fillMissing(updateText);
      updateTranslated = true;
    } catch (e) {
      error = failure(e);
    } finally {
      busy = "";
    }
  }

  async function postUpdate() {
    if (!current || busy) return;
    busy = "update";
    error = null;
    done = null;
    try {
      const b: Record<string, unknown> = { text: compact(updateText) };
      if (updateStatus) b.status = updateStatus;
      await post(`/procedures/${encodeURIComponent(current.id)}/updates`, b);
      current = await get<Procedure>(`/procedures/${encodeURIComponent(current.id)}`);
      fill(current);
      done = t("procedure_update_posted");
      void loadList();
    } catch (e) {
      error = failure(e);
    } finally {
      busy = "";
    }
  }

  const addStage = () => (stages = [...stages, { name: {}, planned: "", done: "" }]);
  const removeStage = (i: number) => (stages = stages.filter((_, j) => j !== i));
  const addLink = () => (links = [...links, { label: "", url: "" }]);
  const removeLink = (i: number) => (links = links.filter((_, j) => j !== i));
  const sourceLang = (loc: Localized): Lang | undefined => langsOf(loc)[0];
</script>

<div class="page">
  <h1 class="serif">{t("procedures_title")}</h1>
  <div class="split" class:has-item={!!arg}>
    <div class="list-pane">
      <div class="actions top-actions">
        <button class="btn primary small" onclick={() => navigate("procedures", "new")}>{t("procedure_new")}</button>
      </div>
      <div class="row filters" role="group" aria-label={t("procedure_status")}>
        <button class="chip" aria-pressed={status === ""} onclick={() => (status = "")}>{t("all")}</button>
        {#each PROCEDURE_STATUSES as s (s)}
          <button class="chip" aria-pressed={status === s} onclick={() => (status = s)}>{procedureStatusName(s)}</button>
        {/each}
      </div>
      <Notice text={listError} kind="error" />
      {#if list === null}
        <p class="muted pulse">{t("loading")}</p>
      {:else if !list.length}
        <p class="empty">{t("procedures_empty")}</p>
      {:else}
        <ul class="list">
          {#each list as p (p.id)}
            <li>
              <button class="entry" aria-current={p.id === arg ? "true" : undefined} onclick={() => navigate("procedures", p.id)}>
                <span class="title">{pick(p.title, ui.lang).text}</span>
                <span class="meta">
                  <span class="tag">{procedureStatusName(p.status)}</span>
                  <span class="muted">{kindName(p.kind)} · {date(p.updated_at)}</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="work-pane">
      {#if !arg}
        <p class="empty">{t("procedure_pick")}</p>
      {:else}
        <button class="back" onclick={() => navigate("procedures")}>← {t("back")}</button>
        <Notice text={loadError} kind="error" />
        {#if isNew || current}
          <div class="stack">
            <section class="card stack">
              <h2 class="serif">{isNew ? t("procedure_new") : pick(current!.title, ui.lang).text}</h2>
              {#if current?.verdicts}
                <p class="m0 muted small">{t("procedure_verdicts", current.verdicts)}</p>
              {/if}
              <div class="actions">
                <button class="btn small" onclick={translateForm} disabled={!!busy || !commune.model || !sourceLang(title)}>{busy === "translate" ? t("translate_busy") : t("translate_go")}</button>
                {#if sourceLang(title)}<span class="muted small">{t("translate_from")}: {langName(sourceLang(title)!)}</span>{/if}
              </div>
              {#if translated}<p class="model"><span class="label">{t("model_translation_label")}</span></p>{/if}
              <LangFields id="p-title" label={t("procedure_title")} langs={commune.languages} maxlength={140} required bind:value={title} />
              <LangFields id="p-body" label={t("procedure_body")} langs={commune.languages} multiline maxlength={4000} bind:value={body} />
              <div class="fields two">
                <div class="field">
                  <label class="label" for="p-kind">{t("procedure_kind")}</label>
                  <select id="p-kind" bind:value={kind}>{#each PROCEDURE_KINDS as k (k)}<option value={k}>{kindName(k)}</option>{/each}</select>
                </div>
                <div class="field">
                  <label class="label" for="p-status">{t("procedure_status")}</label>
                  <select id="p-status" bind:value={formStatus}>{#each PROCEDURE_STATUSES as s (s)}<option value={s}>{procedureStatusName(s)}</option>{/each}</select>
                </div>
                <div class="field">
                  <label class="label" for="p-owner">{t("procedure_owner")}</label>
                  <input id="p-owner" type="text" maxlength="120" bind:value={owner} />
                </div>
                <div class="field">
                  <label class="label" for="p-started">{t("procedure_started")}</label>
                  <input id="p-started" type="date" bind:value={startedOn} />
                </div>
                <div class="field">
                  <label class="label" for="p-due">{t("procedure_due")}</label>
                  <input id="p-due" type="date" bind:value={dueOn} />
                </div>
              </div>

              <fieldset>
                <legend>{t("procedure_stages")}</legend>
                <div class="stack">
                  {#each stages as stage, i (i)}
                    <div class="stage">
                      <LangFields id="p-stage-{i}" label="{t('procedure_stage_name')} {i + 1}" langs={commune.languages} maxlength={140} bind:value={stage.name} />
                      <div class="fields two">
                        <div class="field">
                          <label class="label" for="p-stage-{i}-planned">{t("procedure_stage_planned")}</label>
                          <input id="p-stage-{i}-planned" type="date" bind:value={stage.planned} />
                        </div>
                        <div class="field">
                          <label class="label" for="p-stage-{i}-done">{t("procedure_stage_done")}</label>
                          <input id="p-stage-{i}-done" type="date" bind:value={stage.done} />
                        </div>
                      </div>
                      <div class="actions"><button class="btn small" type="button" onclick={() => removeStage(i)}>{t("remove")}</button></div>
                    </div>
                  {/each}
                  <div class="actions"><button class="btn small" type="button" onclick={addStage} disabled={stages.length >= 20}>{t("procedure_add_stage")}</button></div>
                </div>
              </fieldset>

              <fieldset>
                <legend>{t("procedure_links")}</legend>
                <div class="stack">
                  {#each links as link, i (i)}
                    <div class="fields two">
                      <div class="field">
                        <label class="label" for="p-link-{i}-label">{t("procedure_link_label")}</label>
                        <input id="p-link-{i}-label" type="text" maxlength="120" bind:value={link.label} />
                      </div>
                      <div class="field">
                        <label class="label" for="p-link-{i}-url">{t("procedure_link_url")}</label>
                        <input id="p-link-{i}-url" type="url" maxlength="500" bind:value={link.url} />
                      </div>
                      <div class="actions"><button class="btn small" type="button" onclick={() => removeLink(i)}>{t("remove")}</button></div>
                    </div>
                  {/each}
                  <div class="actions"><button class="btn small" type="button" onclick={addLink} disabled={links.length >= 20}>{t("procedure_add_link")}</button></div>
                </div>
              </fieldset>

              <div class="actions">
                <button class="btn primary" onclick={save} disabled={!!busy || !langsOf(title).length || !owner.trim()}>{isNew ? t("create") : t("save")}</button>
              </div>
              <Notice text={error} kind="error" />
              <Notice text={done} kind="ok" />
            </section>

            {#if current}
              <section class="card stack">
                <h2 class="serif">{t("procedure_updates")}</h2>
                {#if current.updates?.length}
                  <ol class="updates">
                    {#each current.updates as u (u.id)}
                      <li>
                        <div class="row"><span class="mono red">{date(u.at)}</span><span class="tag">{procedureStatusName(u.status_after)}</span></div>
                        <p class="m0">{pick(u.text, ui.lang).text}</p>
                      </li>
                    {/each}
                  </ol>
                {/if}
                <h3 class="serif">{t("procedure_update_new")}</h3>
                <div class="actions">
                  <button class="btn small" onclick={translateUpdate} disabled={!!busy || !commune.model || !sourceLang(updateText)}>{busy === "translate-update" ? t("translate_busy") : t("translate_go")}</button>
                </div>
                {#if updateTranslated}<p class="model"><span class="label">{t("model_translation_label")}</span></p>{/if}
                <LangFields id="p-update" label={t("procedure_update_text")} langs={commune.languages} multiline maxlength={4000} required bind:value={updateText} />
                <div class="field">
                  <label class="label" for="p-update-status">{t("procedure_update_status")}</label>
                  <select id="p-update-status" bind:value={updateStatus}>
                    <option value="">{t("procedure_update_keep")} ({procedureStatusName(current.status)})</option>
                    {#each PROCEDURE_STATUSES as s (s)}<option value={s}>{procedureStatusName(s)}</option>{/each}
                  </select>
                </div>
                <div class="actions">
                  <button class="btn primary" onclick={postUpdate} disabled={!!busy || !langsOf(updateText).length}>{t("procedure_update_new")}</button>
                </div>
              </section>
              <Tech rows={[["id", current.id], ["docket", current.docket_item_id]]} />
            {/if}
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
  .red { color: var(--red); font-weight: 700; }
  .stage { display: grid; gap: 10px; padding-bottom: 10px; border-bottom: 2px solid var(--line); }
  .updates { margin: 0; padding: 0; list-style: none; display: grid; gap: 12px; }
  .updates li { display: grid; gap: 4px; border-left: 4px solid var(--navy); padding-left: 10px; }
  p.model { margin: 0; }
</style>
