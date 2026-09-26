<script setup lang="ts">
const baseURL = 'https://dev-api.nukcafe.co/nukcafe/api/v2'

// useFetch('', { baseURL })

function login() {
  $fetch('/staff/auth/login', { baseURL, method: 'POST', body: {
    username: '+85510456086',
    password: 'Abcde@12345',
  } })
}
</script>

<template>
  <UApp>
    <NuxtLayout>
      <button @click="login">
        Click
      </button>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
