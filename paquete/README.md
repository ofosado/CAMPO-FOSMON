# Paquete de marca cotea

Generado a partir del **Manual de marca v1.0** y de Space Grotesk Bold
(instanciada del variable, SIL OFL). Todo está en **trazos**: ningún archivo
depende de que la tipografía cargue.

La curva de corte es la misma del manual, convertida a coordenadas relativas
y suavizada a cúbicas, así que escala a cualquier tamaño sin recalcular nada.
El corte queda entre 127 y 388 unidades sobre la línea base, dentro de la
altura de la x (486), como exige el manual para no romper la lectura.

---

## Contenido

### `src/assets/brand/` — maestros vectoriales

| Archivo | Uso |
|---|---|
| `cotea-horizontal.svg` | Versión primaria, dos tintas |
| `cotea-horizontal-negativo.svg` | Sobre fondo grafito |
| `cotea-horizontal-1tinta.svg` | Por debajo de 32 px, impresión a una tinta |
| `cotea-horizontal-1tinta-blanco.svg` | Una tinta sobre fondo oscuro |
| `cotea-vertical.svg` | Usos cuadrados, con descriptor en dos líneas |
| `cotea-icono.svg` | La c partida — de 32 px para arriba |
| `cotea-icono-solido.svg` | La c sólida — de 24 px para abajo |
| `cotea-icono-1tinta-blanco.svg` | La c sobre fondo oscuro |
| `cotea-icono-fondo.svg` | La c sobre hueso, para íconos de app |
| `cotea-icono-maskable.svg` | Área segura al 30 %, para Android maskable |
| `cotea-icono-apple.svg` | Fondo sólido, sin transparencia |

### `public/brand/` — derivados

Favicon 16 / 32 / 48 y `favicon.svg`; PWA 192, 512 y 512 maskable;
`apple-touch-icon-180.png`; `icono-1024.png` para tiendas;
lockups en PNG a 1x, 2x y 3x, en positivo y negativo.

### `src/brand/Logo.jsx`

Componente único. Recibe `variante`, `tono` y `tamano`, y hace cumplir solo
las tres reglas que en la práctica siempre se rompen: la versión partida se
cierra por debajo de 32 px, el descriptor se omite por debajo de 60 px, y el
espacio libre de un cuarto del cuerpo se aplica como padding y no se puede
desactivar por prop.

---

## Notas de integración

**Autoaloja las tipografías.** Space Grotesk y JetBrains Mono van en
`public/fonts/`, servidas desde el propio dominio. La app corre en obra con
señal mala; depender de Google Fonts es depender de un tercero justo donde
no hay red.

**Los íconos de PWA no se despliegan todavía.** Cambiar `name`, íconos y
`theme_color` de un manifest en una app ya instalada provoca
comportamientos raros de reinstalación en iOS. Entran a la rama, se
despliegan con aviso previo a los usuarios de FOSMON.

**El manifest es del producto, no del cliente.** La app se llama cotea para
todos. El logo del municipio va junto al saludo, vía `LogoCliente`, leído en
tiempo de ejecución de `orgs/{orgId}/config/branding`. No generar un manifest
por cliente.

**Bloque de manifest:**

```json
{
  "name": "cotea · control de avance, maquinaria, personal y obra",
  "short_name": "cotea",
  "theme_color": "#14181C",
  "background_color": "#F5F3EE",
  "icons": [
    { "src": "/brand/pwa-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/brand/pwa-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/brand/pwa-512-maskable.png", "sizes": "512x512",
      "type": "image/png", "purpose": "maskable" }
  ]
}
```

---

## Lo que este paquete NO resuelve

Sirve para producto y para pantalla. **No lo mandes a imprenta ni al IMPI
todavía.** Para eso falta:

- Revisión de un diseñador sobre el espaciado óptico entre letras, que es
  donde se nota la diferencia y donde una interletra pareja no basta.
- Versiones en CMYK y Pantone. Los valores del manual están en HEX; una
  conversión automática a CMYK da un naranja apagado en papel.
- Archivo en curvas con la tipografía convertida y verificada para el
  registro de marca, clases 42 y 9.

Este paquete le sirve de base al diseñador: la idea, la curva y las
proporciones ya están fijadas y verificadas. Lo que queda es oficio.
