import { createRouter, createMemoryHistory } from 'vue-router'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    {
      path: '/',
      redirect: '/setup',
    },
    {
      path: '/setup',
      name: 'setup',
      component: () => import('./views/SetupView.vue'),
    },
    {
      path: '/capture',
      name: 'capture',
      component: () => import('./views/AppShell.vue'),
    },
    {
      path: '/sessions/:id',
      name: 'session',
      component: () => import('./views/SessionView.vue'),
    },
    {
      path: '/profiles/:id',
      name: 'profile-editor',
      component: () => import('./views/ProfileEditorView.vue'),
    },
  ],
})

export default router
