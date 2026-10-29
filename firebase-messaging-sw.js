/*
 * Bildirimlerin arka plan dosyası: site kapalıyken gelen bildirimi gösterir.
 * Bildirime basınca maçın sayfası açılır (bağlantıyı sunucu gönderir).
 * Uygulama açıkken gelen bildirimi site gösterir; ona basılınca açık sayfada maç açılır.
 */

self.addEventListener('notificationclick', event => {
    const data = event.notification.data || {};
    if (!data.link || data.FCM_MSG)
        return;
    event.notification.close();
    event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        const page = list.find(client => client.url.startsWith(self.registration.scope));
        if (!page)
            return clients.openWindow(data.link);
        page.postMessage({ mac: data.mac });
        return page.focus();
    }));
});
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: 'AIzaSyC0i1eqUGgQrzh26toayMgdOX9I-jDtL8Q',
    authDomain: 'canli-b4406.firebaseapp.com',
    projectId: 'canli-b4406',
    storageBucket: 'canli-b4406.firebasestorage.app',
    messagingSenderId: '940094284577',
    appId: '1:940094284577:web:fbb51f2875b55090485460'
});

firebase.messaging();
