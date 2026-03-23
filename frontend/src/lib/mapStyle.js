/**
 * Shared map style configuration for MapLibre GL.
 *
 * Strategy: start with raster tiles for instant rendering, then upgrade
 * to OpenFreeMap vector tiles in the background. Users see the map
 * immediately while vector tiles (sharper, GPU-rendered) load behind
 * the scenes.
 */

export const RASTER_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }
  },
  layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm' }]
};

const VECTOR_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/**
 * Upgrade a map from raster to vector tiles in the background.
 * Calls `onStyleReady` after the new style has finished loading
 * so the caller can re-add custom GeoJSON sources/layers.
 *
 * If the fetch or style load fails, the map keeps its raster tiles.
 */
export function upgradeToVectorStyle(map, onStyleReady) {
  fetch(VECTOR_STYLE_URL)
    .then(r => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    })
    .then(style => {
      if (onStyleReady) {
        map.once('style.load', onStyleReady);
      }
      map.setStyle(style);
    })
    .catch(() => {
      // Vector tiles unavailable — raster stays, no degradation.
    });
}
