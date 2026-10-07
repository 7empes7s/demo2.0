<script lang="ts">
  import { CATEGORIES, type About, type Category, type DeskClient, type FeedbackLookup } from "../lib/desk.ts";
  import { CompanionFailure } from "../lib/errors.ts";
  import type { Key } from "../lib/i18n.ts";
  import { date, t, ui } from "../lib/ui.svelte.ts";

  /**
   * Send feedback to the commune, with no sign-in. The desk answers with a lookup code; the
   * resident keeps it and looks the message up later to read its status and the answer.
   */
  let { client, about = null, onclearabout }: { client: DeskClient; about?: { about: About; title: string } | null; onclearabout?: () => void } = $props();

  let text = $state("");
  let category = $state<Category | "">("");
  let sending = $state(false);
  let code = $state<string | null>(null);
  let sendFailure = $state<Key | null>(null);
  let query = $state("");
  let looking = $state(false);
  let found = $state<FeedbackLookup | null>(null);
  let lookFailure = $state<Key | null>(null);
  const uid = $props.id();

  function failureKey(e: unknown): Key {
    if (e instanceof CompanionFailure && e.kind === "busy") return "ideas_busy";
    if (e instanceof CompanionFailure && e.kind === "not_found") return "fb_lookup_none";
    if (e instanceof CompanionFailure && e.kind === "unavailable") return "desk_unavailable";
    return "error";
  }

  async function send(e: SubmitEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message || sending) return;
    sending = true;
    sendFailure = null;
    try {
      const receipt = await client.feedback({ lang: ui.lang, text: message, category: category || null, about: about?.about ?? null });
      code = receipt.code;
      text = "";
      category = "";
    } catch (err) {
      sendFailure = failureKey(err);
    } finally {
      sending = false;
    }
  }

  async function look(e: SubmitEvent) {
    e.preventDefault();
    const value = query.trim();
    if (!value || looking) return;
    looking = true;
    lookFailure = null;
    found = null;
    try {
      found = await client.lookup(value);
    } catch (err) {
      lookFailure = failureKey(err);
    } finally {
      looking = false;
    }
  }
</script>

<div class="feedback">
  <p class="muted intro">{t("fb_intro")}</p>

  {#if code}
    <section class="card receipt" data-state="sent" aria-labelledby="{uid}-sent">
      <h3 id="{uid}-sent" class="serif">{t("fb_sent_title")}</h3>
      <p class="code mono" data-code={code}>{code}</p>
      <p class="muted">{t("fb_sent_hint")}</p>
      <button class="btn" onclick={() => { query = code ?? ""; code = null; }}>{t("fb_sent_again")}</button>
    </section>
  {:else}
    <form class="card form" onsubmit={send} aria-labelledby="{uid}-h" data-state="form">
      <h3 id="{uid}-h" class="serif">{t("feedback_open")}</h3>
      {#if about}
        <p class="about" data-state="about">
          <span class="label">{t("fb_about")}</span>
          <span class="what">{about.title}</span>
          {#if onclearabout}<button class="link" type="button" onclick={onclearabout}>{t("fb_about_remove")}</button>{/if}
        </p>
      {/if}
      <label class="label" for="{uid}-text">{t("fb_text")}</label>
      <textarea id="{uid}-text" bind:value={text} rows="6" minlength="5" maxlength="4000" required disabled={sending}></textarea>
      <label class="label" for="{uid}-cat">{t("fb_category")}</label>
      <select id="{uid}-cat" bind:value={category} disabled={sending}>
        <option value="">{t("fb_category_none")}</option>
        {#each CATEGORIES as c (c)}<option value={c}>{t(`cat_${c}`)}</option>{/each}
      </select>
      {#if sendFailure}<p class="bad" role="alert">{t(sendFailure)}</p>{/if}
      <button class="btn primary" type="submit" disabled={sending}>{t("fb_send")}</button>
      <p class="muted small">{t("fb_private")}</p>
    </form>
  {/if}

  <form class="card form lookup" onsubmit={look} aria-labelledby="{uid}-l" data-state="lookup">
    <h3 id="{uid}-l" class="serif">{t("fb_lookup_title")}</h3>
    <label class="label" for="{uid}-code">{t("fb_lookup_code")}</label>
    <div class="row">
      <input id="{uid}-code" class="mono" bind:value={query} autocapitalize="off" spellcheck="false" required disabled={looking} />
      <button class="btn" type="submit" disabled={looking}>{t("fb_lookup_go")}</button>
    </div>
    <div aria-live="polite" class="result">
      {#if looking}
        <p class="muted pulse" data-state="loading">{t("desk_loading")}</p>
      {:else if lookFailure}
        <p class="bad" role="alert" data-state="lookup-failed">{t(lookFailure)}</p>
      {:else if found}
        <div class="message" data-state="found">
          <div class="meta">
            <span class="tag {found.status}">{t(`fb_status_${found.status}`)}</span>
            <span class="muted">{t("fb_sent_on", { date: date(found.created_at) })}</span>
            {#if found.category && found.category !== "other"}<span class="muted">{t(`cat_${found.category}`)}</span>{/if}
          </div>
          <p class="text" lang={found.lang}>{found.text}</p>
          <div class="answer">
            <span class="label">{t("fb_answer")}</span>
            {#if found.answer}
              <p>{found.answer}</p>
              {#if found.answered_at}<span class="when mono">{date(found.answered_at)}</span>{/if}
            {:else}
              <p class="muted">{t("fb_no_answer")}</p>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </form>
</div>

<style>
  .feedback { display: grid; gap: 16px; }
  .intro { margin: 0; max-width: 62ch; }
  .form { display: grid; gap: 8px; justify-items: start; }
  .form h3, .receipt h3 { font-size: 1.4rem; }
  .form label { margin-top: 4px; }
  input, textarea, select { width: 100%; background: var(--surface); border: var(--rule) solid var(--line); padding: 0.55rem 0.8rem; }
  textarea { resize: vertical; }
  .row { display: flex; flex-wrap: wrap; gap: 10px; width: 100%; }
  .row input { flex: 1 1 12rem; letter-spacing: 0.08em; }
  .about { display: grid; gap: 2px; margin: 0; padding: 0.5rem 0.7rem; border-left: 4px solid var(--accent); background: var(--surface-2); max-width: 100%; }
  .what { font-weight: 600; overflow-wrap: anywhere; }
  .link { background: none; border: 0; padding: 0; justify-self: start; color: var(--accent-fg); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; font-size: 0.9rem; }
  .receipt { display: grid; gap: 10px; justify-items: start; }
  .receipt p { margin: 0; max-width: 60ch; }
  .code { font-size: clamp(2rem, 9vw, 3.2rem); line-height: 1.1; letter-spacing: 0.12em; font-weight: 700; user-select: all; overflow-wrap: anywhere; }
  .small { font-size: 0.86rem; margin: 0; }
  .bad { margin: 0; color: var(--red); font-weight: 600; }
  .result { width: 100%; }
  .result:empty { display: none; }
  .result p { margin: 0; }
  .message { display: grid; gap: 8px; margin-top: 6px; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; font-size: 0.86rem; }
  .tag { font: 700 0.72rem/1.5 var(--serif); letter-spacing: 0.04em; text-transform: uppercase; padding: 0 6px; border: 2px solid var(--line); background: var(--surface); }
  .tag.answered { background: var(--green-bg); color: var(--green); border-color: var(--green); }
  .tag.in_review { background: var(--accent); color: var(--accent-ink); border-color: var(--accent-line); }
  .text { white-space: pre-line; max-width: 68ch; overflow-wrap: anywhere; }
  .answer { display: grid; gap: 4px; padding: 0.6rem 0.8rem; border-left: 4px solid var(--backing-navy); background: var(--surface-2); }
  .answer p { white-space: pre-line; }
  .when { font-size: 0.8rem; color: var(--red); }
  @media (min-width: 960px) {
    .form, .receipt { max-width: 720px; }
  }
</style>
