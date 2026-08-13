import { defineConfig } from 'vitepress'

// Docs site for ete-sthetic.
// Deployed to GitHub Pages as a *project* site, so it is served from a
// sub-path (https://a-asen.github.io/ete-sthetic/). `base` must match the
// repo name or every asset/link 404s.
export default defineConfig({
  title: 'ete-sthetic',
  description:
    'A small, aesthetic, keyboard-first desktop client for EteSync — tasks, calendar, and contacts in one window.',
  base: '/ete-sthetic/',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,
  // The design notes under docs/ predate this site and contain relative
  // links to source files that don't resolve inside the built site. Don't
  // fail the build over them.
  ignoreDeadLinks: true,

  head: [['meta', { name: 'theme-color', content: '#1a1a1a' }]],

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'Architecture', link: '/architecture/overview' },
      { text: 'Reference', link: '/reference/keybindings' },
      {
        text: 'Contributing',
        link: '/contributing',
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting started',
          items: [
            { text: 'Introduction', link: '/guide/introduction' },
            { text: 'Install & run', link: '/guide/getting-started' },
          ],
        },
        {
          text: 'Modules',
          items: [
            { text: 'Tasks', link: '/guide/tasks' },
            { text: 'Calendar', link: '/guide/calendar' },
            { text: 'Contacts', link: '/guide/contacts' },
          ],
        },
        {
          text: 'Across the app',
          items: [
            { text: 'Sync model', link: '/guide/sync' },
            { text: 'Search', link: '/guide/search' },
            { text: 'Settings', link: '/guide/settings' },
          ],
        },
      ],
      '/architecture/': [
        {
          text: 'Architecture',
          items: [
            { text: 'Overview', link: '/architecture/overview' },
            { text: 'Data model', link: '/architecture/data-model' },
            { text: 'Services layer', link: '/architecture/services' },
            { text: 'Tauri shell', link: '/architecture/tauri-shell' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Keybindings', link: '/reference/keybindings' },
            { text: 'FAQ', link: '/reference/faq' },
          ],
        },
        {
          text: 'Design notes',
          collapsed: true,
          items: [
            {
              text: 'Calendar + contacts plan',
              link: '/calendar-contacts-plan',
            },
            { text: 'Calendar roadmap', link: '/calendar-roadmap' },
            { text: 'Task item options', link: '/task-item-options' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/a-asen/ete-sthetic' },
    ],

    editLink: {
      pattern:
        'https://github.com/a-asen/ete-sthetic/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    search: { provider: 'local' },

    footer: {
      message: 'A hobby EteSync client. Not affiliated with EteSync/Etebase.',
      copyright: 'Built with Tauri, React, and VitePress.',
    },
  },
})
