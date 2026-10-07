<script lang="ts">
  /** Staff accounts: the list, a new member, and per member the role, on or off, and a new password. */
  import { onMount } from "svelte";

  import Notice from "./Notice.svelte";
  import Tech from "./Tech.svelte";

  // The shell hands every section the route's argument; this one has no sub-route.
  let { arg: _arg = null }: { arg?: string | null } = $props();
  import { get, patch, post } from "../lib/api.ts";
  import { session } from "../lib/session.svelte.ts";
  import { ROLES, type Role, type Staff } from "../lib/types.ts";
  import { date, failure, roleName, t } from "../lib/ui.svelte.ts";

  let list = $state<Staff[] | null>(null);
  let listError = $state<string | null>(null);
  let error = $state<string | null>(null);
  let done = $state<string | null>(null);
  let busy = $state(false);

  let newLogin = $state("");
  let newName = $state("");
  let newRole = $state<Role>("operator");
  let newPassword = $state("");
  /** The member whose password is being reset, and the new one. */
  let resetting = $state<string | null>(null);
  let resetPassword = $state("");

  async function load() {
    listError = null;
    try {
      list = (await get<{ staff: Staff[] }>("/staff")).staff;
    } catch (e) {
      listError = failure(e);
      list = [];
    }
  }
  onMount(() => void load());

  async function run(action: () => Promise<string>) {
    if (busy) return;
    busy = true;
    error = null;
    done = null;
    try {
      done = await action();
      await load();
    } catch (e) {
      error = failure(e);
    } finally {
      busy = false;
    }
  }

  const create = (e: SubmitEvent) => {
    e.preventDefault();
    void run(async () => {
      await post("/staff", { login: newLogin.trim(), name: newName.trim(), role: newRole, password: newPassword });
      newLogin = newName = newPassword = "";
      newRole = "operator";
      return t("staff_created");
    });
  };
  const setRole = (s: Staff, role: Role) =>
    run(async () => {
      await patch(`/staff/${encodeURIComponent(s.id)}`, { role });
      return t("staff_updated");
    });
  const toggle = (s: Staff) =>
    run(async () => {
      await patch(`/staff/${encodeURIComponent(s.id)}`, { disabled: !s.disabled });
      return t("staff_updated");
    });
  const reset = (s: Staff) =>
    run(async () => {
      await patch(`/staff/${encodeURIComponent(s.id)}`, { password: resetPassword });
      resetting = null;
      resetPassword = "";
      return t("staff_password_set");
    });
</script>

<div class="page">
  <h1 class="serif">{t("staff_title")}</h1>
  <Notice text={listError} kind="error" />
  <Notice text={error} kind="error" />
  <Notice text={done} kind="ok" />

  {#if list === null}
    <p class="muted pulse">{t("loading")}</p>
  {:else}
    <ul class="members">
      {#each list as s (s.id)}
        <li class="card member">
          <div class="row">
            <strong>{s.name}</strong>
            <span class="tag" class:amber={s.id === session.staff?.id}>{roleName(s.role)}</span>
            {#if s.disabled}<span class="tag red">{t("staff_disabled")}</span>{/if}
            <span class="muted mono small">{s.login}</span>
          </div>
          <div class="row">
            <label class="label" for="role-{s.id}">{t("staff_role")}</label>
            <select id="role-{s.id}" class="narrow" value={s.role} disabled={busy} onchange={(e) => setRole(s, e.currentTarget.value as Role)}>
              {#each ROLES as r (r)}<option value={r}>{roleName(r)}</option>{/each}
            </select>
            <button class="btn small" disabled={busy || s.id === session.staff?.id} onclick={() => toggle(s)}>{s.disabled ? t("staff_enable") : t("staff_disable")}</button>
            <button class="btn small" disabled={busy} onclick={() => ((resetting = resetting === s.id ? null : s.id), (resetPassword = ""))}>{t("staff_reset")}</button>
          </div>
          {#if resetting === s.id}
            <form class="row" onsubmit={(e) => (e.preventDefault(), reset(s))}>
              <div class="field grow">
                <label class="label" for="pw-{s.id}">{t("staff_new_password")}</label>
                <input id="pw-{s.id}" type="password" autocomplete="new-password" minlength="10" required bind:value={resetPassword} />
              </div>
              <button class="btn small" type="submit" disabled={busy || resetPassword.length < 10}>{t("save")}</button>
            </form>
          {/if}
          <Tech rows={[["id", s.id], ["created", date(s.created_at)]]} />
        </li>
      {/each}
    </ul>
  {/if}

  <form class="card stack" onsubmit={create}>
    <h2 class="serif">{t("staff_new")}</h2>
    <div class="fields two">
      <div class="field">
        <label class="label" for="new-login">{t("login")}</label>
        <input id="new-login" type="text" autocomplete="off" autocapitalize="off" minlength="2" maxlength="40" pattern="[a-z0-9._\-]+" required bind:value={newLogin} />
      </div>
      <div class="field">
        <label class="label" for="new-name">{t("staff_name")}</label>
        <input id="new-name" type="text" maxlength="80" bind:value={newName} />
      </div>
      <div class="field">
        <label class="label" for="new-role">{t("staff_role")}</label>
        <select id="new-role" bind:value={newRole}>{#each ROLES as r (r)}<option value={r}>{roleName(r)}</option>{/each}</select>
      </div>
      <div class="field">
        <label class="label" for="new-password">{t("staff_new_password")}</label>
        <input id="new-password" type="password" autocomplete="new-password" minlength="10" required bind:value={newPassword} />
      </div>
    </div>
    <div class="actions"><button class="btn primary" type="submit" disabled={busy}>{t("create")}</button></div>
  </form>
</div>

<style>
  .members { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  .member { display: grid; gap: 10px; }
  .small { font-size: 0.85rem; }
  .narrow { width: auto; }
  .grow { flex: 1 1 14rem; }
</style>
