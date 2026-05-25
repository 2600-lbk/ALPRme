import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router'
import { openDb } from './storage/db'

const app = createApp(App)
app.use(router)
app.mount('#app')

openDb().catch(console.error)
if (navigator.storage?.persist) {
  navigator.storage.persist().catch(() => {})
}
