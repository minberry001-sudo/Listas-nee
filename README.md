# Mis listas

App personal para organizar carpetas, listas y registros. Funciona en el navegador, guarda todo en el dispositivo y se puede instalar como PWA.

**Web:** https://minberry001-sudo.github.io/Listas-nee/

## Qué incluye

- Carpetas con tarjetas de lista rediseñadas: visualización moderna con badges de estado y barra de progreso integrada.
- Vista de lista tipo tabla compacta optimizada para series: más espacio horizontal para el nombre, reducción dinámica de letra y salto de línea para títulos largos.
- Filas completadas estilizadas: texto y números en cursiva (*italic*) y una línea de tachado continua que cruza toda la fila, sin guiones en las celdas vacías.
- Columnas de texto o número: encabezados y números centrados, textos y nombres a la izquierda adaptables a la celda.
- Modo «Editar» para insertar, duplicar, mover o eliminar filas sin ocupar columnas extra ni botones innecesarios.
- Al crear una lista nueva, se incluye su primera fila enfocada lista para escribir.
- Orden manual, por nombre, por última edición o por fecha de creación. El orden elegido se recuerda por vista.
- Búsqueda y filtros de pendientes y completadas.
- Exportación completa a JSON, exportación de una lista a CSV e importación de copias.
- Diálogos propios en lugar de `prompt`, `confirm` y `alert`: los formularios de carpeta y lista son pop-ups centrados; los menús siguen siendo hojas inferiores.
- Diseño móvil primero, con celdas editables y tabla responsiva integrada.
- PWA instalable con manifest, service worker e iconos. La app abre sin conexión después de la primera visita.
- Copia automática de los datos antiguos y opción de restaurarlos desde Ajustes.

## Uso

1. Abre la web en el móvil.
2. Crea una carpeta y después una lista.
3. Escribe directamente en las celdas de la fila. Usa Intro para pasar al siguiente campo o crear una fila nueva al final.
4. Activa el botón «Editar» en la barra de herramientas y pulsa cualquier fila para insertar, duplicar, mover o eliminar.
5. En Ajustes puedes instalar la app, exportar una copia y restaurarla.

En iPhone, la instalación se hace desde Safari: **Compartir → Añadir a pantalla de inicio**.

## Datos

Todo se guarda en `localStorage`, en este dispositivo y navegador. No se envía nada a ningún servidor.

- Datos actuales: `misListasData`
- Preferencias de orden: `misListasSettings`
- Datos de la versión anterior: `miGestorListasV1`
- Copia automática de la versión anterior: `miGestorListasV1.backup`
- Copia previa a una importación: `misListasData.importBackup`

Las listas de la versión anterior se migran automáticamente a la versión 3 del formato. Si quieres pasar los datos a otro dispositivo, exporta una copia JSON en Ajustes y vuelve a importarla allí.

## Desarrollo local

No hay dependencias ni proceso de compilación. Sirve la carpeta con cualquier servidor estático:

```bash
npx serve .
```

O con el servidor que prefieras. También funciona abriendo `index.html` directamente, aunque el service worker y la instalación PWA necesitan `http://localhost` o HTTPS.

## Publicación

GitHub Pages publica desde la rama `main` en la raíz del repositorio. El manifest y el service worker usan rutas relativas para funcionar bajo `/Listas-nee/`.

Al publicar cambios en `styles.css`, `data.js` o `app.js`, actualiza `CACHE_NAME` en `sw.js` para que los dispositivos reciban la versión nueva.

## Estructura

```text
index.html              Estructura, iconos SVG y carga de scripts
styles.css              Diseño móvil primero y estilos de escritorio
data.js                 Esquema v3, migración, fechas, números y orden
app.js                  Interfaz, rutas, diálogos, importación y PWA
manifest.webmanifest    Configuración de instalación
sw.js                   Caché y funcionamiento sin conexión
icons/                  Iconos de la app
```
