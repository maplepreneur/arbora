<script setup lang="ts">
defineEmits<{ click: [] }>();
</script>

<template>
  <button type="button" class="fixture-button" @click="$emit('click')">
    <slot />
  </button>
</template>
