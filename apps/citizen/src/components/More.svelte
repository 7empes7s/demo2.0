<script lang="ts" module>
  import type { Key } from "../lib/i18n.ts";
  import type { IconName } from "./Icon.svelte";

  export interface Section {
    route: string;
    icon: IconName;
    title: Key;
    /** One plain line on what the page is for, so nobody has to open it to find out. */
    line: Key;
  }
</script>

<script lang="ts">
  import { t } from "../lib/ui.svelte.ts";
  import Icon from "./Icon.svelte";

  let { sections, onopen }: { sections: Section[]; onopen: (route: string) => void } = $props();
</script>

<ul class="sections" data-testid="more">
  {#each sections as s (s.route)}
    <li>
      <a
        class="section"
        href={`#${s.route}`}
        onclick={(e) => {
          e.preventDefault();
          onopen(s.route);
        }}
      >
        <span class="badge"><Icon name={s.icon} size={24} /></span>
        <span class="text">
          <span class="title">{t(s.title)}</span>
          <span class="line">{t(s.line)}</span>
        </span>
        <Icon name="chevron" size={18} />
      </a>
    </li>
  {/each}
</ul>

<style>
  .sections { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  .section {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 72px;
    padding: 12px 14px;
    border: var(--rule) solid var(--line);
    background: var(--surface);
    color: var(--fg);
    text-decoration: none;
    transition: box-shadow 120ms;
  }
  .section:hover, .section:focus-visible { box-shadow: 5px 5px 0 0 var(--accent), 5px 5px 0 var(--rule) var(--backing); }
  .badge {
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 2px solid var(--accent-line);
    background: var(--accent);
    color: var(--accent-ink);
  }
  .text { flex: 1 1 auto; min-width: 0; display: grid; gap: 2px; }
  .title { font-weight: 700; font-size: 1.05rem; }
  .line { color: var(--muted); font-size: 0.9rem; line-height: 1.35; }
  @media (min-width: 720px) {
    .sections { grid-template-columns: 1fr 1fr; }
  }
  @media (prefers-reduced-motion: no-preference) {
    .section { animation: paste 0.6s cubic-bezier(0.2, 0.9, 0.3, 1.2) both; }
    li:nth-child(2) .section { animation-delay: 0.06s; }
    li:nth-child(3) .section { animation-delay: 0.12s; }
    li:nth-child(4) .section { animation-delay: 0.18s; }
    li:nth-child(n + 5) .section { animation-delay: 0.24s; }
  }
</style>
