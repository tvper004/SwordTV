# Historial de Versiones (Changelog)

Todos los cambios notables de **SwordTV** se documentan en este archivo.

---

## [v2.0.0] — Edición Multiplataforma Optimizada (Carpeta `V2/`, `Windows/`, `Android/`, `IOS/`)

### Novedades y Multiplataforma
* **Soporte oficial multiplataforma**:
  * **macOS (`V2/`)**: Binario nativo Tauri 2 con aceleración por hardware (`VideoToolbox` / `AVPlayer`).
  * **Windows (`Windows/`)**: Binario `swordtv.exe` con WebView2, codificación `libx264` compatible, detección automática de `node.exe`/`ffmpeg.exe` y ejecución silenciosa en segundo plano (`CREATE_NO_WINDOW`).
  * **Android (`Android/`)**: Aplicación nativa Kotlin + `WebViewAssetLoader` con motor HTTP local integrado (`LocalEngineServer.kt` + `PortalClient.kt`), sin dependencias externas ni binarios adicionales, lista en `SwordTV-debug.apk`.
  * **iOS / iPadOS (`IOS/`)**: Aplicación SwiftUI + `WKWebView` con esquema personalizado `swordtv://`, servidor local `NWListener` (`LocalEngineServer.swift` + `PortalClient.swift`), soporte Picture-in-Picture / inline y `Info.plist` completo (`CFBundleName`, `CFBundleExecutable`, ATS) empaquetado en `SwordTV.ipa`.
* **Diseño responsivo móvil y tablet**: Adaptación automática de barras de navegación, cuadrícula VOD, lista de canales y subtítulos para pantallas táctiles y áreas seguras (*notch*).

### Correcciones en Motor de Video y Canales
* **Seguimiento de redirecciones HTTP (`301/302/307/308`) en proxy**: El proxy local ahora resuelve hasta 4 saltos limpiando la IP en caché por dominio para evitar errores 404 en señales con balanceadores externos.
* **Proxy universal y Failover en TV en Vivo**:
  * Nuevo endpoint `/api/live/proxy` para envolver señales M3U/HTTP directas y evitar bloqueos por CORS o contenido mixto.
  * Cambio automático a señales alternativas activas (`findBackupLiveChannel`) cuando un canal presenta caída (`403`/`404`/`ENOTFOUND`).
  * Paginación extendida en `syncPortalLiveChannels` para cargar la totalidad de canales disponibles del portal.
* **Resolución de series multitemporada en VOD**: `findExactTitleMatch` ahora reconoce sufijos de temporada (`T1`, `T2`, `S1`, `S2`, `Temporada`) y prioriza la temporada exacta seleccionada por el usuario (corrigiendo la carga inmediata en series como *The Eminence in Shadow*).
* **Estabilidad de `ffmpeg-relay` y P2P**:
  * Segmentos VOD reducidos a `-hls_time 2` para inicio de reproducción más rápido.
  * Espera inteligente en entrega de segmentos `.m4s` en escritura para evitar cortes 404 transitorios.
  * Eliminación del timeout corto de 3s en `ffprobe` para fuentes locales BitTorrent (`127.0.0.1`), permitiendo recibir las piezas iniciales sin abortos prematuros.
  * Fallback automático a fuentes alternativas de Stremio cuando la fuente principal del portal no responde.

---

## [v1.1.4] — Estabilización de Subtítulos, Ventana y Control de Reproducción (Carpeta `V1/`)

### Correcciones
* **Subtítulos duales (WebVTT nativo + capa DOM)**:
  * Restauración de pistas `<track>` nativas con conversión automática SRT → WebVTT para compatibilidad total en pantalla completa y Picture-in-Picture.
  * Aceleración por hardware (`translate3d` y `z-index: 100`) en `#vod-custom-subtitles` para evitar oclusión por la capa de video de AVPlayer en Apple Silicon.
  * Tamaño de fuente estándar y legible (`clamp`) con contorno de alto contraste.
* **Preferencia de idioma e idioma Latino**:
  * Corrección de `resolveTitleId` para obtener automáticamente el IMDb ID y consultar OpenSubtitles cuando el título carece de subtítulos en español.
  * Detección inclusiva de Español Latino (`spl`, `es-419`, `lat`, `spa`, `es`).
* **Interfaz de reproductor y ventana**:
  * Ocultamiento automático de título, barra de progreso y controles OSD en pantalla completa al permanecer inactivo.
  * Corrección del arrastre de ventana para permitir mover la aplicación libremente entre múltiples monitores.
  * Restauración de inicialización del módulo principal tras corregir declaración duplicada en `closeVodPlayer`.

---

## [v1.1.2] — Integración de Portal de Alta Velocidad y Réplica de Diseño

### Mejoras y Correcciones
* Adopción del protocolo nativo del portal para carga instantánea de películas, series, anime y canales en vivo sin esperas prolongadas.
* Rediseño visual con barra de navegación superior de dos filas, tarjetas de catálogo unificadas y modal de detalles por temporada/episodio.
* Barra de desplazamiento de tiempo interactiva con previsualización y salto preciso (`seek`).

---

## [v1.1.0] — Motor Multimedia Local y Soporte Stremio

### Mejoras y Correcciones
* Incorporación del puente multimedia local (`127.0.0.1:11472`) con `ffmpeg-relay` (remuxing a fMP4 HLS para compatibilidad con codecs HEVC/H.265).
* Selector funcional de pistas de audio (prioridad japonés en anime y español como segunda opción) y menú de subtítulos.

---

## [v0.1.0] — Lanzamiento Inicial

### Base del Proyecto
* Primera versión funcional de escritorio para macOS con reproductor IPTV en vivo, buscador integrado, favoritos, historial de reproducción y soporte para listas M3U.
