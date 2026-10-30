<script setup lang="ts">
defineProps<{ title: string; description: string; actionLabel: string }>();
defineEmits<{ action: [] }>();
</script>

<template>
  <section class="card counter-card" :data-testid="`card-${title.toLowerCase()}`">
    <h2>{{ title }}</h2>
    <p>{{ description }}</p>
    <AppButton @click="$emit('action')">{{ actionLabel }}</AppButton>
  </section>
</template>
