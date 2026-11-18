<div align="center">

# ⚔️ SwordTV

**Centro multimedia multiplataforma de IPTV en vivo y streaming VOD de alta velocidad**

[![Version](https://img.shields.io/badge/version-2.0.0-0ea5e9?style=for-the-badge)](./CHANGELOG.md)
[![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon%20%2F%20Intel-000000?style=for-the-badge&logo=apple&logoColor=white)](#-macos-v2)
[![Windows](https://img.shields.io/badge/Windows-10%20%2F%2011%20(x64)-0078D6?style=for-the-badge&logo=windows&logoColor=white)](#-windows)
[![Android](https://img.shields.io/badge/Android-7.0%2B%20%2F%20TV-3DDC84?style=for-the-badge&logo=android&logoColor=white)](#-android)
[![iOS](https://img.shields.io/badge/iOS%20%2F%20iPadOS-15.0%2B-147EFB?style=for-the-badge&logo=ios&logoColor=white)](#-ios--ipados)
[![License: Personal Use Only](https://img.shields.io/badge/License-Uso%20Personal-f59e0b?style=for-the-badge)](./LICENSE)

<br/>

[![Apóyame en Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/TU_CUENTA_KOFI)

</div>

---

## 📖 ¿Qué es SwordTV?

**SwordTV** es un reproductor multimedia unificado diseñado para ofrecer una experiencia fluida, rápida y sin fricciones en **TV en Vivo**, **Películas**, **Series**, **Anime**, **Infantil**, **Deportes**, **Documentales** y **Contenido 4K UHD**.

A diferencia de los reproductores IPTV convencionales que se detienen ante enlaces caídos, redirecciones HTTP o códecs incompatibles (como H.265/HEVC en contenedores MPEG-TS), SwordTV incorpora un **motor local inteligente de puente y respaldo** que resuelve las señales en tiempo real, gestiona múltiples pistas de audio y subtítulos, y garantiza una reproducción continua en escritorio y dispositivos móviles.

---

## ✨ Características Principales

* **📺 TV en Vivo con +3,500 Canales y Failover Automático**:
  * Organización por categorías (Perú, España, Deportes, Noticias, Cine, Infantil, Música y más).
  * Si una señal directa falla (`403`, `404` o caída del servidor), el reproductor cambia automáticamente a una señal alternativa activa del catálogo.
  * Soporte completo para listas **M3U / M3U8** personalizadas (importación por URL o exportación).
* **🎬 Catálogo VOD de Alta Velocidad (Películas, Series y Anime)**:
  * Resolución instantánea desde servidores de alta velocidad con respaldo automático hacia fuentes comunitarias.
  * Soporte inteligente para series y anime multitemporada (`Temporada 1`, `Temporada 2`, etc.), fichas detalladas y seguimiento automático de episodios vistos.
* **💬 Subtítulos Duales e Inteligentes**:
  * Priorización automática de subtítulos en **Español** (incluyendo variantes **Español Latino** `spl` / `es-419` / `lat`) e Inglés.
  * Conversión automática **SRT → WebVTT** al vuelo y renderizado dual compatible con pantalla completa y Picture-in-Picture (PiP).
* **🌐 Selector Dinámico de Audio**:
  * Detección automática de pistas: prioridad **Japonés (Original)** y **Español** en anime, y **Español / Latino** en cine y series.
* **⚡ Aceleración por Hardware y Motor de Remux**:
  * Conversión en tiempo real de streams `HEVC / TS` a `fMP4 HLS` sin pérdida de sincronía entre audio, video y línea de tiempo.
* **⭐ Favoritos, Historial y Reanudación Exacta**:
  * Guarda tu progreso automáticamente para continuar exactamente en el segundo donde lo dejaste.
  * Control parental configurable, ajustes de relación de aspecto (`Auto`, `16:9`, `4:3`, `Zoom`) y atajos de teclado.

---

## ⚙️ ¿Cómo funciona en cada Sistema Operativo?

SwordTV adapta su motor de reproducción a las capacidades nativas de cada plataforma para ofrecer el máximo rendimiento sin configuraciones complejas:

### 🍎 macOS (`V2/`)
* **Arquitectura**: Aplicación nativa construida con **Tauri 2 (Rust + WebKit)** y motor local en **Node.js + FFmpeg** en `127.0.0.1:11472`.
* **Funcionamiento**:
  * Utiliza **AVPlayer** acelerado por hardware en macOS para reproducción nativa de H.264/HEVC.
  * Cuando una fuente entrega HEVC dentro de MPEG-TS o requiere cambio de pista de audio, `ffmpeg-relay` realiza transcodificación/remuxing por hardware con **VideoToolbox (`h264_videotoolbox`)** hacia `fMP4 HLS` de baja latencia (`2s` por segmento).
  * El proxy local sigue redirecciones `301/302`, evade bloqueos CORS y convierte subtítulos SRT a WebVTT.
* **Compilación**:
  ```bash
  cd V2/src-tauri
  cargo build --release
  ```

### 🪟 Windows (`Windows/`)
* **Arquitectura**: Aplicación de escritorio **Tauri 2 (WebView2 / Chromium)** con binario nativo [`Windows/dist/swordtv.exe`](Windows/dist/swordtv.exe) y motor `stremio_engine`.
* **Funcionamiento**:
  * Al iniciar, `swordtv.exe` lanza el motor multimedia de forma silenciosa en segundo plano (`CREATE_NO_WINDOW`, sin abrir ventanas negras de consola) y almacena caché y datos de usuario en `%LOCALAPPDATA%\SwordTV`.
  * WebView2 utiliza `hls.js` integrado junto con `ffmpeg.exe` (`libx264 -preset veryfast` + `AAC`) para garantizar compatibilidad total con cualquier flujo HLS, MP4 o TS.
* **Requisitos en Windows**:
  * [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (incluido por defecto en Windows 10/11).
  * [Node.js](https://nodejs.org/) y [FFmpeg](https://ffmpeg.org/) en el `PATH` del sistema o en `C:\ffmpeg\bin\`.
* **Ejecución / Compilación**:
  * Binario listo en `Windows/dist/swordtv.exe` (junto con `Windows/dist/stremio_engine/`).
  * Para recompilar desde macOS/Linux con MinGW:
    ```bash
    cd Windows/src-tauri
    cargo build --release --target x86_64-pc-windows-gnu
    ```

### 🤖 Android (`Android/`)
* **Arquitectura**: Aplicación nativa **Kotlin** (`Android/`), optimizada para teléfonos, tablets y **Android TV**, sin depender de Node.js ni de binarios externos.
* **Funcionamiento**:
  * Incorpora un servidor HTTP local nativo en Kotlin (`LocalEngineServer.kt`) en `127.0.0.1:11472` junto con `PortalClient.kt` (cifrado 3DES-ECB, autenticación del portal y firma `signO3`).
  * `WebViewAssetLoader` sirve la interfaz web en un contexto seguro con módulos ES, puente `SwordTVNative` para almacenamiento persistente en `SharedPreferences` y modo pantalla completa inmersivo.
  * Los códecs H.264, H.265/HEVC y HLS se decodifican directamente por hardware mediante el motor multimedia nativo de Android (`MediaCodec`).
* **APK listo y compilación**:
  * APK compilado en [`Android/dist/SwordTV-debug.apk`](Android/dist/SwordTV-debug.apk).
  * Instalación directa por ADB:
    ```bash
    adb install -r Android/dist/SwordTV-debug.apk
    ```
  * Compilación manual con Gradle:
    ```bash
    cd Android
    gradle assembleDebug
    ```

### 📱 iOS / iPadOS (`IOS/`)
* **Arquitectura**: Aplicación nativa **SwiftUI + WKWebView** (`IOS/SwordTV.xcodeproj`) con servidor local integrado mediante `Network.framework` (`NWListener`).
* **Funcionamiento**:
  * `LocalEngineServer.swift` y `PortalClient.swift` ejecutan el puente HTTP y la criptografía del portal (`CommonCrypto` 3DES-ECB + `signO3`) directamente en Swift en `127.0.0.1:11472`.
  * Un `WKURLSchemeHandler` (`swordtv://`) carga la interfaz web de forma segura, mientras `WKWebView` delega el video a **AVPlayer** con soporte **Picture-in-Picture (PiP)** y reproducción *inline*.
  * Incluye `Info.plist` configurado con `CFBundleName`, `CFBundleExecutable` y `NSAppTransportSecurity` para compatibilidad completa con herramientas de firmado e instalación (*sideloading*).
* **IPA listo y compilación**:
  * Paquete generado en [`IOS/dist/SwordTV.ipa`](IOS/dist/SwordTV.ipa).
  * Para abrir o firmar con tu Apple ID / certificado en Xcode:
    ```bash
    open IOS/SwordTV.xcodeproj
    ```

---

## 📋 Versiones y Mejoras

| Versión | Carpeta | Resumen de Correcciones y Mejoras |
| :--- | :--- | :--- |
| **v2.0.0** | `V2/`, `Windows/`, `Android/`, `IOS/` | Soporte multiplataforma completo (macOS, Windows, Android, iOS); proxy con seguimiento de redirecciones `301/302`; failover automático de canales en vivo; proxy universal `/api/live/proxy`; resolución de series multitemporada (`T1/T2`); segmentos HLS de 2s; estabilidad de probe P2P y diseño móvil responsivo. |
| **v1.1.4** | `V1/` | Subtítulos duales (pista `<track>` WebVTT nativa + capa DOM acelerada por hardware); soporte para Español Latino (`spl`); ocultamiento automático de OSD en pantalla completa; arrastre libre de ventana entre monitores. |
| **v1.1.2** | `BKP/Ver.1.1.2` | Integración directa con el protocolo del portal de alta velocidad, barra de tiempo interactiva con seek preciso y rediseño visual en dos filas. |
| **v1.1.0** | `BKP/Ver.1.1.0` | Puente multimedia local (`ffmpeg-relay` a fMP4 HLS) y selector funcional de pistas de audio y subtítulos. |
| **v0.1.0** | `BKP/Ver.0.1` | Lanzamiento inicial para macOS con reproductor IPTV, listas M3U, favoritos e historial. |

Consulta el detalle completo en [CHANGELOG.md](./CHANGELOG.md).

---

## 📁 Estructura del Repositorio

```text
SwordTV/
├── V1/             # Respaldo congelado de la versión v1.1.4 (incluye SwordTV.app)
├── V2/             # Versión principal optimizada v2.0.0 (macOS / fuente base)
├── Windows/        # Proyecto Tauri para Windows + binario dist/swordtv.exe
├── Android/        # Proyecto Android Studio / Gradle (Kotlin) + dist/SwordTV-debug.apk
├── IOS/            # Proyecto Xcode (SwiftUI) + dist/SwordTV.ipa
├── CHANGELOG.md    # Registro detallado de cambios por versión
├── LICENSE         # Licencia de Uso Particular (All Rights Reserved)
└── README.md       # Documentación principal del proyecto
```

---

## ☕ Apoya el Proyecto

Si **SwordTV** te resulta útil y quieres apoyar su mantenimiento y nuevas funcionalidades, puedes invitarme un café en Ko-fi:

[![Apóyame en Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/TU_CUENTA_KOFI)
