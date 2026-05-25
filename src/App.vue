<script setup lang="ts">
import PWABadge from './components/PWABadge.vue'
</script>

<template>
  <router-view v-slot="{ Component }">
    <keep-alive include="AppShell">
      <component :is="Component" />
    </keep-alive>
  </router-view>
  <PWABadge />
</template>
