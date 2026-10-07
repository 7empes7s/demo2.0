<script lang="ts">
  /** Every call Desk made to the model: purpose, model, prompt hash, sizes, timing and outcome. Never any text. */
  import { onMount } from "svelte";

  import Notice from "./Notice.svelte";
  import { get } from "../lib/api.ts";
  import { short } from "../lib/text.ts";
  import type { AiCall } from "../lib/types.ts";
  import { dateTime, failure, t } from "../lib/ui.svelte.ts";

  // The shell hands every section the route's argument; this one has no sub-route.
  let { arg: _arg = null }: { arg?: string | null } = $props();

  let calls = $state<AiCall[] | null>(null);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      calls = (await get<{ desk_calls: AiCall[] }>("/audit/ai-calls")).desk_calls;
    } catch (e) {
      error = failure(e);
      calls = [];
    }
  });
</script>

<div class="page">
  <h1 class="serif">{t("audit_model_title")}</h1>
  <Notice text={error} kind="error" />
  {#if calls === null}
    <p class="muted pulse">{t("loading")}</p>
  {:else if !calls.length}
    <p class="empty">{t("audit_model_empty")}</p>
  {:else}
    <div class="scroll">
      <table class="data">
        <thead>
          <tr><th>{t("audit_time")}</th><th>{t("audit_purpose")}</th><th>{t("audit_model")}</th><th>{t("audit_prompt_hash")}</th><th>{t("audit_sizes")}</th><th>{t("audit_ms")}</th><th>{t("audit_outcome")}</th></tr>
        </thead>
        <tbody>
          {#each calls as c, i (i)}
            <tr>
              <td class="mono">{dateTime(c.at)}</td>
              <td>{c.purpose}</td>
              <td class="mono">{c.model}</td>
              <td class="mono">{short(c.prompt_sha256, 12)}</td>
              <td class="num">{c.input_chars} / {c.output_chars}</td>
              <td class="num">{c.ms}</td>
              <td class="wrap">{#if c.ok}<span class="tag green">{t("yes")}</span>{:else}<span class="tag red">{t("no")}</span> {c.error ?? ""}{/if}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
