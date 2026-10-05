<script lang="ts">
  import type { Argument, ChatMessage, DocketItem, Position } from "@democracy2/companion";

  import { untrack } from "svelte";

  import type { CompanionClient } from "../lib/client.ts";
  import { prefs } from "../lib/prefs.ts";
  import { t, ui } from "../lib/ui.svelte.ts";

  let { item, client }: { item: DocketItem; client: CompanionClient } = $props();

  type Turn = ChatMessage & { by?: string[] };

  // The component is re-created per file (keyed in FileView), so reading the stance once is right.
  let stance = $state<Position | null>(untrack(() => prefs.stance(item.id)));
  let turns = $state<Turn[]>([]);
  let args = $state<Argument[] | null>(null);
  let draft = $state("");
  let busy = $state(false);
  let failed = $state(false);

  function choose(value: Position) {
    stance = value;
    prefs.setStance(item.id, value);
    turns = [];
  }

  async function ask(message?: string) {
    if (!stance || busy) return;
    busy = true;
    failed = false;
    const history: ChatMessage[] = turns.map(({ role, content }) => ({ role, content }));
    if (message) {
      history.push({ role: "user", content: message });
      turns = [...turns, { role: "user", content: message }];
      draft = "";
    }
    try {
      const [turn, set] = await Promise.all([
        client.challenge(item, ui.lang, stance, history),
        args ? Promise.resolve({ arguments: args }) : client.arguments(item),
      ]);
      args = set.arguments;
      const by = [...new Set(turn.argument_ids.map((id) => args?.find((a) => a.id === id)?.by).filter((b): b is string => !!b))];
      turns = [...turns, { role: "assistant", content: turn.reply, by }];
    } catch {
      failed = true;
    } finally {
      busy = false;
    }
  }
</script>

<section class="card challenge" aria-labelledby="ch-h">
  <h3 id="ch-h" class="serif sub">{t("stand_title")}</h3>
  <div class="stances" role="group">
    {#each [["for", "stand_for"], ["against", "stand_against"], ["unsure", "stand_unsure"]] as const as [value, key] (value)}
      <button class="btn" aria-pressed={stance === value} onclick={() => choose(value)}>{t(key)}</button>
    {/each}
  </div>
  <p class="muted small">{t("stand_private")}</p>

  <div class="test">
    <h4 class="label">{t("challenge_title")}</h4>
    <p class="small">{t("challenge_intro")}</p>
    {#if !stance}
      <p class="muted small">{t("challenge_need_stand")}</p>
    {:else if turns.length === 0}
      <button class="btn primary" onclick={() => ask()} disabled={busy}>
        {stance === "unsure" ? t("challenge_go_unsure") : t("challenge_go")}
      </button>
    {/if}

    {#if turns.length}
      <ol class="chat" aria-live="polite">
        {#each turns as turn, i (i)}
          <li class={turn.role}>
            <span class="label">{turn.role === "user" ? t("you") : t("companion")}</span>
            <p>{turn.content}</p>
            {#if turn.by?.length}<p class="muted small">{t("grounded_from", { who: turn.by.join(", ") })}</p>{/if}
          </li>
        {/each}
      </ol>
    {/if}
    {#if busy}<p class="muted pulse small">{t("challenge_busy")}</p>{/if}
    {#if failed}<p class="error small">{t("error")}</p>{/if}
    {#if args && args.length === 0 && turns.length}<p class="muted small">{t("no_arguments")}</p>{/if}

    {#if turns.length && stance}
      <form
        class="reply"
        onsubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) ask(draft.trim().slice(0, 1000));
        }}
      >
        <input bind:value={draft} placeholder={t("reply_placeholder")} maxlength="1000" aria-label={t("reply_placeholder")} />
        <button class="btn primary" disabled={busy || !draft.trim()}>{t("send")}</button>
      </form>
    {/if}
  </div>
</section>

<style>
  .challenge { display: grid; gap: 12px; }
  .sub { font-size: 1.5rem; }
  .stances { display: flex; flex-wrap: wrap; gap: 8px; }
  .small { font-size: 0.88rem; margin: 0; }
  .test { display: grid; gap: 10px; border-top: 1px solid var(--line); padding-top: 14px; justify-items: start; }
  .test > * { max-width: 68ch; }
  .chat { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; width: 100%; }
  .chat li { display: grid; gap: 4px; padding: 10px 12px; border-radius: 10px; }
  .chat li p { margin: 0; }
  .chat li.assistant { background: var(--surface-2); }
  .chat li.user { border: 1px solid var(--line); margin-left: 12%; }
  .reply { display: flex; gap: 8px; width: 100%; }
  .reply input {
    flex: 1;
    min-width: 0;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.5rem 1rem;
  }
  .error { color: var(--red); }
</style>
