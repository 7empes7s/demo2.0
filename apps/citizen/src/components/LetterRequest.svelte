<script lang="ts">
  import { onMount } from "svelte";

  import type { DeskClient } from "../lib/desk.ts";
  import { CompanionFailure } from "../lib/errors.ts";
  import type { Key } from "../lib/i18n.ts";
  import { prefs } from "../lib/prefs.ts";
  import { t } from "../lib/ui.svelte.ts";

  /**
   * Asking the commune for a code by post: a name and an address, four plain fields. The commune
   * checks them against its residents' register and posts a letter. This device keeps only the date
   * of the request, so the sign-in sheet can say a letter is on its way.
   */
  let { client, onasked, onclose }: { client: DeskClient; onasked: () => void; onclose: () => void } = $props();

  let name = $state("");
  let street = $state("");
  let extra = $state("");
  let postcode = $state("");
  let busy = $state(false);
  let failure = $state<Key | null>(null);
  let done = $state<Key | null>(null);
  const uid = $props.id();
  let first = $state<HTMLInputElement | null>(null);
  // Opened from a link: the form takes the focus, which also scrolls it into view.
  onMount(() => first?.focus());

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    failure = null;
    try {
      const out = await client.requestLetter({ name: name.trim(), street: street.trim(), extra: extra.trim(), postcode: postcode.trim() });
      prefs.setLetterAsked(new Date().toISOString());
      done = out.already ? "letter_already" : "letter_done";
      name = street = extra = postcode = "";
      onasked();
    } catch (err) {
      if (err instanceof CompanionFailure && err.kind === "busy") failure = "ideas_busy";
      else if (err instanceof CompanionFailure) failure = "desk_unavailable";
      else failure = "letter_bad";
    } finally {
      busy = false;
    }
  }
</script>

<section class="card letter" data-state="letter" aria-labelledby="{uid}-h">
  <h3 id="{uid}-h" class="serif">{t("letter_title")}</h3>
  {#if done}
    <p class="ok" role="status">{t(done)}</p>
    <button class="btn" type="button" onclick={onclose}>{t("letter_cancel")}</button>
  {:else}
    <p class="muted intro">{t("letter_intro")}</p>
    <form onsubmit={submit}>
      <label class="label" for="{uid}-name">{t("letter_name")}</label>
      <input id="{uid}-name" bind:this={first} bind:value={name} autocomplete="name" maxlength="120" required disabled={busy} />
      <label class="label" for="{uid}-street">{t("letter_street")}</label>
      <input id="{uid}-street" bind:value={street} autocomplete="address-line1" maxlength="160" required disabled={busy} />
      <label class="label" for="{uid}-extra">{t("letter_extra")}</label>
      <input id="{uid}-extra" bind:value={extra} autocomplete="address-line2" maxlength="80" disabled={busy} />
      <label class="label" for="{uid}-postcode">{t("letter_postcode")}</label>
      <input id="{uid}-postcode" class="postcode" bind:value={postcode} autocomplete="postal-code" maxlength="8" placeholder="L-4002" required disabled={busy} />
      {#if failure}<p class="bad" role="alert">{t(failure)}</p>{/if}
      <div class="row">
        <button class="btn primary" type="submit" disabled={busy}>{t("letter_go")}</button>
        <button class="btn" type="button" onclick={onclose}>{t("letter_cancel")}</button>
      </div>
    </form>
    <p class="muted small">{t("letter_private")}</p>
  {/if}
</section>

<style>
  .letter { display: grid; gap: 10px; justify-items: start; }
  .letter h3 { font-size: 1.5rem; line-height: 1.1; }
  .intro, .small, .ok { margin: 0; max-width: 60ch; }
  .small { font-size: 0.86rem; }
  .ok { font-weight: 600; }
  form { display: grid; gap: 6px; width: 100%; justify-items: start; }
  form .label { margin-top: 6px; }
  input {
    width: 100%;
    max-width: 28rem;
    padding: 0.6rem 0.8rem;
    background: var(--surface);
    border: var(--rule) solid var(--line);
    font-size: 1.05rem;
  }
  .postcode { max-width: 9rem; }
  .bad { margin: 0; color: var(--red); font-weight: 600; }
  .row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px; }
</style>
