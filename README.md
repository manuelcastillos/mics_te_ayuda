# MICS Te Ayuda

App PWA de seguimiento anónimo en tiempo real de la micro 601 y 302 hacia FACIMAR (Facultad de Ciencias del Mar, UV).

## Cómo configurar

### 1. Firebase (Realtime Database)

1. Ve a https://console.firebase.google.com
2. Crea un nuevo proyecto (ej: `mics-te-ayuda`)
3. Ve a **Build → Realtime Database** → Crear base de datos (modo prueba)
4. Ve a **Build → Authentication** → Habilitar proveedor: **Anonymous**
5. En Configuración del proyecto → Tus apps → Agregar app web
6. Copia la configuración y pégala en `js/config.js`

**Reglas de seguridad recomendadas (Realtime DB):**
```json
{
  "rules": {
    "travelers": {
      "$uid": {
        ".read": true,
        ".write": "auth != null && auth.uid === $uid"
      }
    }
  }
}
```

### 2. Google Maps API

1. Ve a https://console.cloud.google.com
2. Crea un proyecto y habilita:
   - **Maps JavaScript API**
   - **Maps Visualization API** (para heatmap futuro)
3. Copia la API Key en `js/config.js`

### 3. Verificar coordenadas de FACIMAR

En `js/config.js` están las coordenadas, verifica que sean correctas:
```js
const FACIMAR_LAT = -33.0390;
const FACIMAR_LNG = -71.5915;
```

## Probar localmente

```bash
# Desde la carpeta web_costar con servidor activo en puerto 8080
# Abrir: http://localhost:8080/mics_te_ayuda/
```

## Publicar en Google Play (TWA)

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://TU_DOMINIO/mics_te_ayuda/manifest.json
bubblewrap build
# Sube el APK generado a Play Console
```

## Estructura

```
mics_te_ayuda/
├── index.html         # App principal (splash + tracking + mapa)
├── manifest.json      # PWA manifest
├── sw.js              # Service Worker
├── css/style.css      # Estilos dark mobile-first
├── js/
│   ├── config.js      # ← EDITAR: Firebase + Google Maps keys
│   └── app.js         # Lógica: GPS, Firebase, Maps
└── README.md
```
