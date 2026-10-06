<script lang="ts">
  import { STAGES, type Stage } from "../lib/data.ts";
  import { t } from "../lib/ui.svelte.ts";

  let { stage, compact = false }: { stage: Stage; compact?: boolean } = $props();
  const reached = $derived(STAGES.indexOf(stage));
</script>

<ol class="track" class:compact aria-label={t(`stage_${stage}`)}>
  {#each STAGES as s, i (s)}
    <li class:done={i <= reached} class:now={i === reached}>
      <span class="pip" aria-hidden="true"></span>
      <span class="name" class:sr-only={compact}>{t(`stage_${s}`)}</span>
    </li>
  {/each}
</ol>

<style>
  .track {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 4px;
  }
  li { display: grid; gap: 6px; font-size: 0.78rem; color: var(--muted); }
  .pip { height: 6px; border: 2px solid var(--line); background: var(--surface); }
  li.done .pip { background: var(--line); }
  li.now .pip { background: var(--accent); }
  li.now .name { color: var(--fg); font-weight: 600; }
  .compact li { gap: 0; }
  .compact .pip { height: 5px; }
</style>
