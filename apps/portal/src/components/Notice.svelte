<script lang="ts">
  /** One sentence on a sheet: an error (red edge), a confirmation (green edge) or plain information. */
  let { text, kind = "info" }: { text: string | null; kind?: "error" | "ok" | "info" } = $props();
</script>

{#if text}
  <p class="notice {kind}" role={kind === "error" ? "alert" : "status"}>{text}</p>
{/if}
