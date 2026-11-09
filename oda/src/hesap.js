/*
 * HESAP İŞLEMLERİ (site çağırır; Google ile giriş yapmış kişi, başlıkta Authorization: Bearer {Firebase kimliği}):
 *   GET  /hesap               { r, k, b, engel: [uid], sessiz: ["maç_yorum"] }
 *   POST /hesap/rumuz         { r, kabul }  rumuz seç / değiştir (ilk seferde kurallar kabul edilmeli; haftada bir değişir)
 *   POST /hesap/bildirim      { kapali }    yanıt bildirimleri
 *   POST /hesap/engel         { ekle: [uid] }
 *   POST /hesap/sessiz        { mac, mesaj, sessiz }  kendi yorumunun yanıtlarından bildirim alma
 *   POST /hesap/sil           yorumlar, rumuz ve hesap bilgileri silinir (sayaç, rumuz zamanı ve şikayetler kalır)
 * Cevap: { ok: true, ... } ya da { hata: "kod" } (kodlar: giris, bicim, uygunsuz, kabul, alinmis, hafta).
 */

import { dogrula } from './kimlik.js';
import { d1, RUMUZ, rumuzAnahtari } from './d1.js';
import { uygunsuz } from './filtre.js';

const HAFTA = 7 * 86400000;

export async function hesap(istek, env, islem, macOdasi) {
    const kim = await dogrula((istek.headers.get('Authorization') || '').replace(/^Bearer /, ''), env);
    if (!kim || !kim.google)
        return Response.json({ hata: 'giris' }, { status: 403 });

    const db = await d1(env);
    const uid = kim.uid;
    const govde = istek.method === 'POST' ? await istek.json().catch(() => ({})) : {};
    const hata = kod => Response.json({ hata: kod }, { status: 400 });

    if (istek.method === 'GET' && !islem) {
        const [kisi, engel, sessiz] = await db.batch([
            db.prepare('SELECT r, k, b FROM kisi WHERE uid = ?').bind(uid),
            db.prepare('SELECT kim FROM engel WHERE uid = ?').bind(uid),
            db.prepare('SELECT mac, mesaj FROM sessiz WHERE uid = ?').bind(uid)
        ]);
        const k = kisi.results[0] || {};
        return Response.json({
            ok: true, r: k.r || null, k: k.k || null, b: k.b === 1,
            engel: engel.results.map(x => x.kim),
            sessiz: sessiz.results.map(x => x.mac + '_' + x.mesaj)
        });
    }

    if (istek.method !== 'POST')
        return new Response(null, { status: 404 });

    if (islem === 'rumuz') {
        const ad = String(govde.r || '').trim();
        if (!RUMUZ.test(ad))
            return hata('bicim');
        if (uygunsuz(ad))
            return hata('uygunsuz');

        const [kisiS, sahipS, zamanS] = await db.batch([
            db.prepare('SELECT r, k FROM kisi WHERE uid = ?').bind(uid),
            db.prepare('SELECT uid FROM rumuz WHERE ad = ?').bind(rumuzAnahtari(ad)),
            db.prepare('SELECT z FROM rumuz_zaman WHERE uid = ?').bind(uid)
        ]);
        const kisi = kisiS.results[0] || {};
        const sahip = sahipS.results[0];
        const zaman = zamanS.results[0];
        if (kisi.r === ad)
            return Response.json({ ok: true, r: ad, k: kisi.k });
        if (!kisi.k && !govde.kabul)
            return hata('kabul');
        if (sahip && sahip.uid !== uid)
            return hata('alinmis');
        if (kisi.r && zaman && Date.now() - zaman.z < HAFTA)
            return Response.json({ hata: 'hafta', sonraki: zaman.z + HAFTA }, { status: 400 });

        const k = kisi.k || Date.now();
        const isler = [
            db.prepare('INSERT INTO kisi (uid, r, k) VALUES (?, ?, ?) ON CONFLICT (uid) DO UPDATE SET r = excluded.r, k = excluded.k').bind(uid, ad, k),
            db.prepare('INSERT OR REPLACE INTO rumuz_zaman (uid, z) VALUES (?, ?)').bind(uid, Date.now()),
            db.prepare('INSERT OR REPLACE INTO rumuz (ad, uid) VALUES (?, ?)').bind(rumuzAnahtari(ad), uid)
        ];
        if (kisi.r && rumuzAnahtari(kisi.r) !== rumuzAnahtari(ad))
            isler.push(db.prepare('DELETE FROM rumuz WHERE ad = ? AND uid = ?').bind(rumuzAnahtari(kisi.r), uid));
        try {
            await db.batch(isler);
        } catch (e) {
            return hata('alinmis');
        }
        return Response.json({ ok: true, r: ad, k });
    }

    if (islem === 'bildirim') {
        await db.prepare('INSERT INTO kisi (uid, b) VALUES (?, ?) ON CONFLICT (uid) DO UPDATE SET b = excluded.b')
            .bind(uid, govde.kapali ? 1 : 0).run();
        return Response.json({ ok: true });
    }

    if (islem === 'engel') {
        const liste = (Array.isArray(govde.ekle) ? govde.ekle : []).filter(x => typeof x === 'string' && x && x !== uid).slice(0, 200);
        if (liste.length)
            await db.batch(liste.map(x => db.prepare('INSERT OR IGNORE INTO engel (uid, kim) VALUES (?, ?)').bind(uid, x)));
        return Response.json({ ok: true });
    }

    if (islem === 'sessiz') {
        const mac = String(govde.mac || '');
        const mesaj = String(govde.mesaj || '');
        if (!/^\d{1,10}$/.test(mac) || !/^\d{1,12}$/.test(mesaj))
            return hata('bicim');
        await db.prepare(govde.sessiz ? 'INSERT OR IGNORE INTO sessiz (uid, mac, mesaj) VALUES (?, ?, ?)' : 'DELETE FROM sessiz WHERE uid = ? AND mac = ? AND mesaj = ?')
            .bind(uid, mac, mesaj).run();
        return Response.json({ ok: true });
    }

    if (islem === 'sil') {
        /* Önce yorumlar (maç maç), sonra hesap bilgileri */
        const yorumlar = (await db.prepare('SELECT mac, mesaj FROM mesajlarim WHERE uid = ?').bind(uid).all()).results;
        const maclar = new Map();
        yorumlar.forEach(x => maclar.set(x.mac, (maclar.get(x.mac) || []).concat(Number(x.mesaj))));
        for (const [mac, idler] of maclar)
            await macOdasi(mac).yorumSil(idler, uid);

        const kisi = (await db.prepare('SELECT r FROM kisi WHERE uid = ?').bind(uid).first()) || {};
        const isler = ['kisi', 'engel', 'sessiz', 'mesajlarim'].map(t => db.prepare('DELETE FROM ' + t + ' WHERE uid = ?').bind(uid));
        if (kisi.r)
            isler.push(db.prepare('DELETE FROM rumuz WHERE ad = ? AND uid = ?').bind(rumuzAnahtari(kisi.r), uid));
        await db.batch(isler);
        return Response.json({ ok: true });
    }

    return new Response(null, { status: 404 });
}
