<script lang="ts" module>
  /** Line icons on a 24-unit grid, drawn with the current text colour. Always beside a word, never alone. */
  const PATHS = {
    week: "M4 6h16v14H4zM4 10h16M8 3v5M16 3v5M8 14h3v3H8z",
    files: "M5 3h10l4 4v14H5zM15 3v4h4M8 11h8M8 15h8M8 19h5",
    ideas: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.8.6 1.6 1.6 1.6 2.7V17h4v-.5c0-1.1.8-2.1 1.6-2.7A6 6 0 0 0 12 3z",
    more: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    check: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.3 15.3 20 20M7.8 10.6l2 2 3.6-3.8",
    procedures: "M5 21V3M5 4h12l-2.5 4L17 12H5",
    votes: "M4 13h16v8H4zM8 13V5l5-2 3 8M9 17h6",
    feedback: "M4 5h16v11H9l-5 4zM8 9h8M8 12h5",
    settings: "M10 3h4l.6 2.6 1.8 1 2.5-.9 2 3.4-2 1.8v2.2l2 1.8-2 3.4-2.5-.9-1.8 1L14 21h-4l-.6-2.6-1.8-1-2.5.9-2-3.4 2-1.8v-2.2l-2-1.8 2-3.4 2.5.9 1.8-1zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
    chevron: "M9 5l7 7-7 7",
  } as const;
  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 22 }: { name: IconName; size?: number } = $props();
</script>

<svg class="icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter">
  <path d={PATHS[name]} />
</svg>

<style>
  .icon { flex: none; display: block; }
</style>
