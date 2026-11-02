import React from 'react';

import horizontal from '../assets/brand/cotea-horizontal.svg';
import horizontalNegativo from '../assets/brand/cotea-horizontal-negativo.svg';
import horizontal1Tinta from '../assets/brand/cotea-horizontal-1tinta.svg';
import horizontal1TintaBlanco from '../assets/brand/cotea-horizontal-1tinta-blanco.svg';
import vertical from '../assets/brand/cotea-vertical.svg';
import icono from '../assets/brand/cotea-icono.svg';
import iconoSolido from '../assets/brand/cotea-icono-solido.svg';
import iconoBlanco from '../assets/brand/cotea-icono-1tinta-blanco.svg';

/**
 * Logo de cotea.
 *
 * Reglas del Manual de marca v1.0 que este componente hace cumplir solo:
 *  · Por debajo de 32 px de cuerpo la versión partida se cierra y la palabra
 *    va sólida en grafito. No hay que acordarse: lo decide el componente.
 *  · El ícono va sin radio. La máscara la aplica cada sistema operativo.
 *  · El espacio libre es un cuarto de la altura de la palabra por los cuatro
 *    lados. Se aplica como padding y no se puede desactivar por prop.
 *
 * props
 *  variante: 'horizontal' | 'vertical' | 'icono'
 *  tono:     'color' | 'negativo' | 'monocromo' | 'monocromo-blanco'
 *  tamano:   altura del cuerpo en px (no la altura total de la caja)
 */
export default function Logo({
  variante = 'horizontal',
  tono = 'color',
  tamano = 44,
  className,
  style,
}) {
  const chico = tamano < 32;

  const src = (() => {
    if (variante === 'icono') {
      if (tono === 'monocromo-blanco') return iconoBlanco;
      if (chico || tono === 'monocromo') return iconoSolido;
      return icono;
    }
    if (variante === 'vertical') {
      // El descriptor se omite por debajo de 60 px de cuerpo.
      if (tamano < 60) return chico ? horizontal1Tinta : horizontal;
      return vertical;
    }
    if (tono === 'monocromo-blanco') return horizontal1TintaBlanco;
    if (chico || tono === 'monocromo') return horizontal1Tinta;
    if (tono === 'negativo') return horizontalNegativo;
    return horizontal;
  })();

  const aire = Math.round(tamano * 0.25); // espacio libre obligatorio

  return (
    <img
      src={src}
      alt="cotea"
      className={className}
      style={{
        height: variante === 'icono' ? tamano : tamano * 1.35,
        width: 'auto',
        padding: aire,
        boxSizing: 'content-box',
        display: 'block',
        ...style,
      }}
    />
  );
}

/**
 * Logo del cliente, cuando la organización tiene uno configurado.
 * Va junto al saludo, nunca sustituyendo a cotea. Si no hay logo de
 * cliente, no se renderiza nada.
 */
export function LogoCliente({ url, nombre, alto = 28, style }) {
  if (!url) return null;
  return (
    <img
      src={url}
      alt={nombre || ''}
      style={{ height: alto, width: 'auto', display: 'block', ...style }}
    />
  );
}
