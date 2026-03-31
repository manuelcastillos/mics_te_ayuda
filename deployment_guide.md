# Cómo poner MICS Te Ayuda en línea 🚀

Sigue estos pasos para que tu aplicación sea accesible desde cualquier lugar:

## Opción 1: GitHub Pages (Gratis y Rápido)

1. Sube esta carpeta (`mics_te_ayuda`) a un nuevo repositorio en tu GitHub.
2. Ve a **Settings** → **Pages**.
3. En **Build and deployment**, selecciona la rama `main` (o `master`) y la carpeta `/(root)`.
4. Haz clic en **Save**.
5. ¡Listo! Tu app estará en `https://tu-usuario.github.io/mics_te_ayuda/`.

> [!NOTE]
> Recuerda que el `manifest.json` tiene el `start_url` como `/mics_te_ayuda/`. Si cambias el nombre del repositorio, actualiza ese valor.

## Opción 2: Vercel (Recomendado para PWA)

1. Instala la CLI de Vercel: `npm i -g vercel`.
2. Ejecuta `vercel` dentro de esta carpeta.
3. Sigue las instrucciones (se desplegará en segundos).
4. Vercel gestiona automáticamente el HTTPS, que es **obligatorio** para que el Service Worker (PWA) funcione.

## Configuración de Producción (Firebase)

Cuando quieras pasar del **Modo Demo** al seguimiento real:

1. Crea un proyecto en [Firebase Console](https://console.firebase.google.com/).
2. Habilita **Firestore Database** y **Anonymous Authentication**.
3. Copia tu configuración web y pégala en `js/config.js`.
4. Cambia `const DEMO_MODE = true;` a `false;`.
5. Vuelve a desplegar.

---
*Hecho por Antigravity para MICS Te Ayuda.*
