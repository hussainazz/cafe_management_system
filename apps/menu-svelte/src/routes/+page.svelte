<script lang="ts">
  import { resolve } from "$app/paths";
</script>

<svelte:head>
  <title>Run Cafe Menu — SvelteKit staging</title>
  <meta name="description" content="Parallel SvelteKit menu application development entry point." />
</svelte:head>

<main>
  <p class="eyebrow">Parallel application</p>
  <h1>SvelteKit menu foundation</h1>
  <p>This development entry page confirms the new application is running independently.</p>
  <a href={resolve("/menu")}>Open the API-backed menu data check</a>
</main>

<style>
  main {
    width: min(100% - 2rem, 48rem);
    margin: 12vh auto;
    padding: clamp(1.5rem, 5vw, 3rem);
    border: 1px solid #d9d3c7;
    border-radius: 1rem;
    background: #fffdf8;
  }

  .eyebrow {
    color: #155c48;
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
</style>
