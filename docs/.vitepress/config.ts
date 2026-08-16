import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Volt',
  description:
    'A TypeScript UI framework: class components, ":"-prefixed templates, TC39 signals, no virtual DOM.',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,

  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }]],

  // Absolute URLs in the sitemap, and canonical links on every page.
  sitemap: { hostname: 'https://voltjs.dev' },

  // Maintainer notes that live next to the docs but are not part of them.
  srcExclude: ['DEPLOY.md'],

  themeConfig: {
    logo: { light: '/logo.svg', dark: '/logo-dark.svg' },
    nav: [
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'Reference', link: '/reference/template-syntax' },
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Introduction', link: '/guide/introduction' },
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Components', link: '/guide/components' },
          { text: 'Reactivity', link: '/guide/reactivity' },
          { text: 'Templates', link: '/guide/templates' },
          { text: 'Lists and conditionals', link: '/guide/lists-and-conditionals' },
          { text: 'Props, callbacks, slots', link: '/guide/composition' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Template syntax', link: '/reference/template-syntax' },
          { text: 'Reactivity API', link: '/reference/reactivity' },
          { text: 'Component API', link: '/reference/component' },
          { text: 'Vite plugin', link: '/reference/vite-plugin' },
        ],
      },
      {
        text: 'Internals',
        items: [
          { text: 'How the compiler works', link: '/guide/compiler' },
          { text: 'Design decisions', link: '/guide/design-decisions' },
        ],
      },
    ],

    search: { provider: 'local' },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Hardik Viradiya',
    },
  },

  markdown: {
    theme: { light: 'github-light', dark: 'github-dark' },
  },
});
