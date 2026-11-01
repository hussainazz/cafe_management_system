<script lang="ts">
  import { navigating } from "$app/state";

  let { children } = $props();
</script>

<svelte:head>
  <meta name="theme-color" content="#f5f2eb" />
</svelte:head>

{#if navigating.to}
  <p class="loading" role="status" aria-live="polite">Loading page…</p>
{/if}

{@render children()}

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    background: #f5f2eb;
    color: #292722;
    font-family: system-ui, sans-serif;
  }

  :global(a) {
    color: #155c48;
  }

  :global(:focus-visible) {
    outline: 3px solid #155c48;
    outline-offset: 3px;
  }

  .loading {
    position: fixed;
    inset-block-start: 0.5rem;
    inset-inline-end: 0.75rem;
    z-index: 1;
    margin: 0;
    padding: 0.5rem 0.75rem;
    border: 1px solid #d9d3c7;
    border-radius: 999px;
    background: #fffdf8;
    font-size: 0.875rem;
  }
</style>
