<script lang="ts">
  import Notice from "./Notice.svelte";
  import { commune } from "../lib/commune.svelte.ts";
  import { signIn } from "../lib/session.svelte.ts";
  import { failure, t } from "../lib/ui.svelte.ts";

  let login = $state("");
  let password = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    error = null;
    try {
      await signIn(login.trim(), password);
      password = "";
    } catch (err) {
      error = failure(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="signin">
  <form class="card sheet" onsubmit={submit}>
    <p class="label">{commune.name || t("app_name")}</p>
    <h1 class="serif">{t("sign_in")}</h1>
    <p class="intro">{t("sign_in_intro")}</p>
    <div class="fields">
      <div class="field">
        <label class="label" for="login">{t("login")}</label>
        <input id="login" name="login" type="text" autocomplete="username" autocapitalize="off" spellcheck="false" required bind:value={login} />
      </div>
      <div class="field">
        <label class="label" for="password">{t("password")}</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required bind:value={password} />
      </div>
    </div>
    <Notice text={error} kind="error" />
    <div class="actions">
      <button class="btn primary" type="submit" disabled={busy}>{busy ? t("signing_in") : t("sign_in")}</button>
    </div>
  </form>
</div>

<style>
  .signin { display: grid; justify-items: center; padding-top: 32px; }
  .sheet { width: min(100%, 440px); display: grid; gap: 14px; }
  .sheet h1 { font-size: 2.4rem; }
  .intro { margin: 0; color: var(--muted); }
</style>
