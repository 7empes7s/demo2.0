<script lang="ts">
  import type { DeskClient } from "../lib/desk.ts";
  import { CompanionFailure } from "../lib/errors.ts";
  import type { Key } from "../lib/i18n.ts";
  import { prefs } from "../lib/prefs.ts";
  import { date, t } from "../lib/ui.svelte.ts";
  import LetterRequest from "./LetterRequest.svelte";

  /**
   * The inline sign-in sheet: the one-time enrolment code the commune handed out, turned into a
   * token kept on this device. Shown only when a resident tries something that needs it. A resident
   * without a code can ask for one by post from here.
   */
  let { client, why, onsignedin, oncancel }: { client: DeskClient; why: Key; onsignedin: () => void; oncancel: () => void } = $props();

  let code = $state("");
  let busy = $state(false);
  let failure = $state<Key | null>(null);
  let asking = $state(false);
  let asked = $state(prefs.letterAsked());
  const uid = $props.id();

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const value = code.trim();
    if (!value || busy) return;
    busy = true;
    failure = null;
    try {
      await client.enrol(value);
      code = "";
      onsignedin();
    } catch (err) {
      if (err instanceof CompanionFailure && err.kind === "busy") failure = "ideas_busy";
      else if (err instanceof CompanionFailure && err.kind === "unavailable") failure = "desk_unavailable";
      else failure = "signin_bad";
    } finally {
      busy = false;
    }
  }
</script>

<form class="card signin" data-state="signin" onsubmit={submit} aria-labelledby="{uid}-h">
  <h3 id="{uid}-h" class="serif">{t("signin_title")}</h3>
  <p class="muted why">{t(why)}</p>
  <p class="muted hint">{t("signin_hint")}</p>
  {#if asked}<p class="asked" data-state="letter-asked">{t("letter_asked", { date: date(asked) })}</p>{/if}
  <label class="label" for="{uid}-code">{t("signin_code")}</label>
  <input id="{uid}-code" class="mono" bind:value={code} autocomplete="one-time-code" autocapitalize="off" spellcheck="false" placeholder="xxxx-xxxx-xxxx" required disabled={busy} />
  {#if failure}<p class="bad" role="alert">{t(failure)}</p>{/if}
  <div class="row">
    <button class="btn primary" type="submit" disabled={busy}>{t("signin_go")}</button>
    <button class="btn" type="button" onclick={oncancel}>{t("signin_cancel")}</button>
  </div>
  <p class="muted small">{t("signin_private")}</p>
  {#if !asking}
    <button class="link" type="button" onclick={() => (asking = true)}>{t("signin_no_code")}</button>
  {/if}
</form>
{#if asking}
  <LetterRequest {client} onasked={() => (asked = prefs.letterAsked())} onclose={() => (asking = false)} />
{/if}

<style>
  .signin { display: grid; gap: 10px; justify-items: start; }
  .signin h3 { font-size: 1.5rem; line-height: 1.1; }
  .why, .hint, .small { margin: 0; max-width: 60ch; }
  .small { font-size: 0.86rem; }
  input {
    width: 100%;
    max-width: 22rem;
    padding: 0.6rem 0.8rem;
    background: var(--surface);
    border: var(--rule) solid var(--line);
    font-size: 1.1rem;
    letter-spacing: 0.08em;
  }
  .bad { margin: 0; color: var(--red); font-weight: 600; }
  .asked { margin: 0; max-width: 60ch; font-weight: 600; border-left: 4px solid var(--accent); padding-left: 10px; }
  .link {
    padding: 0.5rem 0;
    min-height: 44px;
    background: none;
    border: 0;
    color: var(--fg);
    font: inherit;
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 0.2em;
    cursor: pointer;
  }
  .row { display: flex; flex-wrap: wrap; gap: 10px; }
</style>
