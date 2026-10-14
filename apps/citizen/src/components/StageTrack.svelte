<script lang="ts">
  import { STAGES, type Stage } from "../lib/data.ts";
  import { t } from "../lib/ui.svelte.ts";

  let { stage, compact = false }: { stage: Stage; compact?: boolean } = $props();
  const reached = $derived(STAGES.indexOf(stage));
</script>

<span class="wrap" class:compact>
  <ol class="track" aria-label={t(`stage_${stage}`)}>
    {#each STAGES as s, i (s)}
      <li class:done={i <= reached} class:now={i === reached}>
        <span class="pip" aria-hidden="true"></span>
        <span class="name" class:sr-only={compact}>{t(`stage_${s}`)}</span>
      </li>
    {/each}
  </ol>
  <!-- In a list the bars are small, so the step is also said in words. -->
  {#if compact}<span class="step" aria-hidden="true">{t("stage_step", { i: reached + 1, n: STAGES.length, stage: t(`stage_${stage}`) })}</span>{/if}
</span>

<style>
  .wrap { display: block; }
  .track {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 4px;
  }
  li { display: grid; gap: 6px; font-size: 0.78rem; color: var(--muted); }
  .pip { display: block; height: 6px; border: 2px solid var(--line); background: var(--surface); }
  li.done .pip { background: var(--fg); }
  li.now .pip { background: var(--accent); }
  li.now .name { color: var(--fg); font-weight: 600; }
  li { position: relative; }
  /* Where the file stands: a tack pinned on the current step (full track only). */
  .wrap:not(.compact) li.now::before {
    content: ""; position: absolute; top: -7px; left: 50%; width: 12px; height: 12px; z-index: 1;
    border-radius: 50%; background: var(--red); border: 2px solid var(--ink); transform: translateX(-50%);
  }
  /* The steps reached fill in from the left, one after the other. */
  :global([data-motion="on"]) li.done .pip { animation: grow 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.2) backwards; transform-origin: left; }
  :global([data-motion="on"]) li:nth-child(2).done .pip { animation-delay: 0.12s; }
  :global([data-motion="on"]) li:nth-child(3).done .pip { animation-delay: 0.24s; }
  :global([data-motion="on"]) li:nth-child(4).done .pip { animation-delay: 0.36s; }
  :global([data-motion="on"]) .wrap:not(.compact) li.now::before { animation: tack-land 0.35s 0.5s cubic-bezier(0.2, 1.4, 0.4, 1) backwards; }
  .compact { display: flex; align-items: center; gap: 10px; }
  .compact .track { flex: none; width: 88px; }
  .compact li { gap: 0; }
  .compact .pip { height: 5px; }
  .step { font-size: 0.8rem; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
