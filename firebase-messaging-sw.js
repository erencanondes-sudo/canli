/*
 * Bildirimlerin arka plan dosyası: site kapalıyken gelen bildirimi gösterir.
 * Bildirime basılınca (uygulamanın açıkken gösterdiği bildirim dahil):
 * uygulama açıksa öne gelir ve maç açık sayfada açılır; kapalıysa maçın bağlantısı açılır.
 * Firebase'in kendi tıklama davranışından önce çalışır (o, açık uygulamada maçı açmıyor).
 */

self.addEventListener('notificationclick', event => {
    const data = event.notification.data || {};
    const fcm = data.FCM_MSG || {};
    const link = data.link || (fcm.fcmOptions && fcm.fcmOptions.link) || '';
    const mac = link.split('#mac=')[1];
    if (!mac)
        return;
    event.stopImmediatePropagation();
    event.notification.close();
    event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        const page = list.find(client => client.url.startsWith(self.registration.scope));
        if (!page)
            return clients.openWindow(link);
        page.postMessage({ mac: mac });
        return page.focus();
    }));
});

firebase.initializeApp({
    apiKey: 'AIzaSyC0i1eqUGgQrzh26toayMgdOX9I-jDtL8Q',
    authDomain: 'canli-b4406.firebaseapp.com',
    projectId: 'canli-b4406',
    storageBucket: 'canli-b4406.firebasestorage.app',
    messagingSenderId: '940094284577',
    appId: '1:940094284577:web:fbb51f2875b55090485460'
});

firebase.messaging();
