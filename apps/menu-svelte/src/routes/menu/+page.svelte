<script lang="ts">
  import { resolve } from "$app/paths";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const errorMessage = {
    not_configured: "The menu API address is not configured for this deployment.",
    timeout: "The menu service took too long to respond. Please try again later.",
    unavailable: "The menu service is temporarily unavailable. Please try again later.",
    invalid_response: "The menu service returned data this application could not read.",
  } as const;
</script>

<svelte:head>
  <title>Menu data check — Run Cafe</title>
  <meta
    name="description"
    content="Minimal verification view for the SvelteKit public-menu API connection."
  />
</svelte:head>

<main>
  <a class="back-link" href={resolve("/")}>← Application home</a>
  <h1>Menu data check</h1>

  {#if data.result.ok}
    <p class="status" role="status">
      Loaded {data.result.categories.length}
      {data.result.categories.length === 1 ? "category" : "categories"}.
    </p>

    {#if data.result.categories.length === 0}
      <p>The API returned no public categories.</p>
    {:else}
      <ul class="categories">
        {#each data.result.categories as category (category.id)}
          <li>
            <h2>{category.name}</h2>
            {#if category.products.length === 0}
              <p>No public products in this category.</p>
            {:else}
              <ul class="products">
                {#each category.products as product (product.id)}
                  <li>
                    <strong>{product.name}</strong>
                    <span>{new Intl.NumberFormat("fa-IR").format(product.priceAmount)} تومان</span>
                    {#if !product.isAvailable}<span class="availability">Currently unavailable</span
                      >{/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    <p class="error" role="alert">{errorMessage[data.result.reason]}</p>
  {/if}
</main>

<style>
  main {
    width: min(100% - 2rem, 56rem);
    margin: 3rem auto;
    padding: clamp(1.25rem, 4vw, 2.5rem);
    border: 1px solid #d9d3c7;
    border-radius: 1rem;
    background: #fffdf8;
  }

  h1 {
    margin-block: 1.5rem 0.5rem;
  }

  .back-link {
    text-decoration-thickness: 1px;
    text-underline-offset: 0.2em;
  }

  .status {
    color: #155c48;
  }

  .error {
    padding: 1rem;
    border: 1px solid #e6cbc5;
    border-radius: 0.5rem;
    background: #fff2ee;
  }

  .categories,
  .products {
    display: grid;
    gap: 0.75rem;
    padding: 0;
    list-style: none;
  }

  .categories > li {
    padding: 1rem;
    border: 1px solid #e5e0d6;
    border-radius: 0.75rem;
  }

  h2 {
    margin-block: 0 0.75rem;
    font-size: 1.15rem;
  }

  .products > li {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.5rem 1rem;
    padding-block: 0.65rem;
    border-block-end: 1px solid #eee9df;
  }

  .availability {
    color: #704c13;
    font-size: 0.875rem;
  }
</style>
