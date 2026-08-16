# Deploying the docs

The site is VitePress. Build output lands in `docs/.vitepress/dist`.

```bash
pnpm docs:build
```

Not part of the published site — `srcExclude` in the VitePress config keeps
this page out of it, since it is a note to whoever maintains the deployment
rather than documentation of the framework.

## GitHub Pages

What the site runs on. `.github/workflows/docs.yml` builds and deploys on
every push to `main`, and needs Pages enabled with **GitHub Actions** as the
source (Settings → Pages → Build and deployment → Source).

The custom domain is `voltjs.dev`, served from `docs/public/CNAME`. VitePress
copies everything in `docs/public` verbatim into the output, so the CNAME file
is part of each deploy rather than a setting that can drift out of sync with
the repository.

DNS at the registrar:

| Type | Name | Value |
|---|---|---|
| `A` | `@` | `185.199.108.153` |
| `A` | `@` | `185.199.109.153` |
| `A` | `@` | `185.199.110.153` |
| `A` | `@` | `185.199.111.153` |
| `CNAME` | `www` | `hnviradiya.github.io` |

Then tick **Enforce HTTPS** once the certificate is issued, which takes a few
minutes after the DNS resolves. `.dev` is on the HSTS preload list, so the
site is unreachable over plain HTTP regardless — the certificate is not
optional.

## Alternatives

`netlify.toml` and `wrangler.toml` are both present and both work. Neither is
in use; they are kept so a move needs no new configuration, and either can be
deleted once the choice has settled.
