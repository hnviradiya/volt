# Deploying the docs

The site is VitePress. Build output lands in `docs/.vitepress/dist`.

```bash
pnpm docs:build
```

## Cloudflare Pages (recommended while the repo is private)

Free, works with private GitHub repos, unlimited bandwidth, and no
non-commercial restriction.

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**
2. Pick the repository
3. Build settings:

   | Setting | Value |
   |---|---|
   | Build command | `pnpm install && pnpm docs:build` |
   | Build output directory | `docs/.vitepress/dist` |
   | Root directory | *(leave empty)* |

4. Environment variables:

   | Variable | Value |
   |---|---|
   | `NODE_VERSION` | `22` |

`wrangler.toml` in the repo root records the same settings.

## Netlify

`netlify.toml` in the repo root is ready to use. Free tier: 100 GB/month
bandwidth, 300 build-minutes/month. Works with private repos.

## GitHub Pages

Only once the repository is **public** — GitHub Pages does not serve private
repositories on the Free plan. `.github/workflows/docs.yml` is included and
will start working the moment the repo goes public and Pages is enabled with
"GitHub Actions" as the source.
