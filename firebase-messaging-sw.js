/*
 * Bildirimlerin arka plan dosyası: site kapalıyken gelen bildirimi gösterir.
 * Bildirime basınca maçın sayfası açılır (bağlantıyı sunucu gönderir).
 */
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
