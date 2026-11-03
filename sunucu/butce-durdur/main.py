"""
BÜTÇE AŞILINCA DURDURMA (Cloud Run functions, Pub/Sub tetikli)

Google Cloud bütçesi her bildiriminde "butce-durdur" konusuna (Pub/Sub) bir mesaj gönderir:
{ costAmount: bu dönemin harcaması, budgetAmount: bütçe, ... }
Harcama bütçeyi geçtiyse projenin faturalandırması kapatılır: ücretli her şey durur
(sunucu, ücretsiz kotayı aşan Firestore / Realtime Database). Yeniden açmak elle yapılır.
Google'ın yöntemi: https://cloud.google.com/billing/docs/how-to/disable-billing-with-notifications
"""

import base64
import json
import os

import functions_framework
from googleapiclient import discovery

PROJE = os.environ.get('PROJE', 'canli-b4406')


@functions_framework.cloud_event
def butce_durdur(cloud_event):
    veri = json.loads(base64.b64decode(cloud_event.data['message']['data']).decode('utf-8'))
    harcama = veri.get('costAmount', 0)
    butce = veri.get('budgetAmount', 0)

    if not butce or harcama <= butce:
        print(f'Harcama {harcama} / bütçe {butce}: durdurulmadı')
        return

    faturalandirma = discovery.build('cloudbilling', 'v1', cache_discovery=False)
    projeler = faturalandirma.projects()
    ad = f'projects/{PROJE}'

    if not projeler.getBillingInfo(name=ad).execute().get('billingEnabled'):
        print('Faturalandırma zaten kapalı')
        return

    projeler.updateBillingInfo(name=ad, body={'billingAccountName': ''}).execute()
    print(f'Harcama {harcama} bütçeyi ({butce}) geçti: faturalandırma kapatıldı')
