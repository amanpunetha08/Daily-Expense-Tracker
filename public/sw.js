self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}
  event.waitUntil(
    self.registration.showNotification(data.title || '💰 Expense Tracker', {
      body: data.body || "Don't forget to log today's expenses!",
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: { url: data.url || '/' }
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(clients.openWindow(event.notification.data.url || '/'))
})
