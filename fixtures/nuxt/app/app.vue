<script setup lang="ts">
const count = ref(0);
</script>

<template>
  <main class="page">
    <header>
      <h1>Arbora fixture</h1>
      <p>Nuxt + Vue 3. Used by Arbora's end-to-end tests.</p>
    </header>
    <CounterCard title="Counter" :description="`Clicked ${count} times`" action-label="Increment" @action="count++" />
  </main>
</template>
