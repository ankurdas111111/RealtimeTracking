<script>
  import { onMount, onDestroy } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { otherUsers, myLocation, mySocketId, mySafetyStatus, focusUser } from '../lib/stores/map.js';
  import { createMapIcon, escapeAttr, calculateDistance, formatDistance, circleGeoJSON } from '../lib/tracking.js';
  import { animateMarkerTo, cancelAnimation, cancelAllAnimations } from '../lib/markerInterpolator.js';
  import { getUserColor } from '../lib/getUserColor.js';
  import { MAP_STYLE, RASTER_STYLE } from '../lib/mapStyle.js';

  export let followMode = false;

  let mapContainer;
  let map;
  let markers = new Map();       // sid → maplibregl.Marker
  let markerPopups = new Map();   // sid → maplibregl.Popup
  let markerState = new Map();
  let geofenceIds = new Set();
  let myMarker = null;
  let myPopup = null;
  let hasSetView = false;
  let isMobile = false;
  let renderUsersRaf = null;
  let pendingUsers = new Map();
  const popupCache = new Map();
  const _lastRenderedUsers = new Map();

  // Dirty-only rendering: only update markers that changed
  let dirtyMarkers = new Set();
  let dirtyRafPending = false;

  function markDirty(sid) {
    dirtyMarkers.add(sid);
    if (!dirtyRafPending) {
      dirtyRafPending = true;
      requestAnimationFrame(flushDirty);
    }
  }

  function flushDirty() {
    dirtyRafPending = false;
    if (!map) return;
    for (const sid of dirtyMarkers) {
      const user = pendingUsers.get(sid);
      if (user) updateSingleMarker(sid, user);
    }
    dirtyMarkers.clear();
  }

  function checkMobile() {
    isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  }

  function ensureCircleSource(id) {
    if (!map.getSource(id)) {
      map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
  }

  function ensureCircleLayer(id, sourceId, color, opacity, outline, outlineWidth, dasharray) {
    if (!map.getLayer(id)) {
      map.addLayer({
        id, type: 'fill', source: sourceId,
        paint: { 'fill-color': color, 'fill-opacity': opacity }
      });
    }
    const outlineId = id + '-outline';
    if (outline && !map.getLayer(outlineId)) {
      const paint = { 'line-color': outline, 'line-width': outlineWidth || 1, 'line-opacity': 0.7 };
      if (dasharray) paint['line-dasharray'] = dasharray;
      map.addLayer({ id: outlineId, type: 'line', source: sourceId, paint });
    }
  }

  function updateCircleSource(sourceId, center, radiusM) {
    const src = map.getSource(sourceId);
    if (!src) return;
    if (radiusM > 0) {
      src.setData(circleGeoJSON(center, radiusM));
    } else {
      src.setData({ type: 'FeatureCollection', features: [] });
    }
  }

  onMount(() => {
    checkMobile();
    window.addEventListener('resize', checkMobile);

    // Configure MapLibre GL worker (required for proper rendering)
    maplibregl.workerUrl = '/maplibre-gl-csp-worker.js';
    maplibregl.workerCount = 2;

    function addCircleSources() {
      ensureCircleSource('my-geofence');
      ensureCircleLayer('my-geofence-fill', 'my-geofence', '#8b5cf6', 0.10, '#8b5cf6', 2.5, [8, 5]);

      // Cluster source for dense groups (only used when zoom < 12)
      map.addSource('users-cluster', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 12,
        clusterRadius: 48,
      });

      // Cluster circle
      map.addLayer({
        id: 'cluster-circles',
        type: 'circle',
        source: 'users-cluster',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step', ['get', 'point_count'],
            'rgba(59,130,246,0.85)',  3,
            'rgba(139,92,246,0.85)', 7,
            'rgba(239,68,68,0.85)'
          ],
          'circle-radius': [
            'step', ['get', 'point_count'],
            22, 5, 28, 10, 34
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': 'rgba(255,255,255,0.5)',
        }
      });

      // Cluster count label
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'users-cluster',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['Noto Sans Bold'],
          'text-size': 13,
        },
        paint: {
          'text-color': '#ffffff',
        }
      });

      // Click cluster → zoom in
      map.on('click', 'cluster-circles', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['cluster-circles'] });
        if (!features.length) return;
        const clusterId = features[0].properties.cluster_id;
        map.getSource('users-cluster').getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err) return;
          map.easeTo({ center: features[0].geometry.coordinates, zoom, duration: 500 });
        });
      });

      map.on('mouseenter', 'cluster-circles', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'cluster-circles', () => { map.getCanvas().style.cursor = ''; });
    }

    map = new maplibregl.Map({
      container: mapContainer,
      style: MAP_STYLE,
      center: [78.9629, 20.5937], // Center of India
      zoom: 4,
      attributionControl: true
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }),
      isMobile ? 'bottom-right' : 'top-right');

    map.on('dragstart', () => { followMode = false; });
    map.on('load', addCircleSources);
  });

  onDestroy(() => {
    cancelAllAnimations();
    if (renderUsersRaf) cancelAnimationFrame(renderUsersRaf);
    for (const m of markers.values()) m.remove();
    markers.clear();
    for (const p of markerPopups.values()) p.remove();
    markerPopups.clear();
    if (myMarker) myMarker.remove();
    if (myPopup) myPopup.remove();
    if (map) map.remove();
    if (typeof window !== 'undefined') window.removeEventListener('resize', checkMobile);
  });

  $: if (map && $myLocation) {
    const { latitude, longitude, speed, formattedTime, accuracy } = $myLocation;
    const lngLat = [longitude, latitude];
    const selfBadges = [];
    if ($mySafetyStatus?.geofence?.enabled) selfBadges.push('<span class="pu-feat pu-feat-geo">⬡ Geofence</span>');
    if ($mySafetyStatus?.autoSos?.enabled) selfBadges.push('<span class="pu-feat pu-feat-autoSos">⏱ Auto-SOS</span>');
    if ($mySafetyStatus?.checkIn?.enabled) selfBadges.push('<span class="pu-feat pu-feat-checkin">✓ Check-in</span>');
    const accCls0 = accuracy == null ? '' : accuracy <= 15 ? 'pu-good' : accuracy <= 50 ? 'pu-warn' : 'pu-danger';
    let selfPopupHtml = '<div class="pu-wrap">';
    selfPopupHtml += '<div class="pu-hdr"><strong class="pu-name">You</strong>';
    selfPopupHtml += '<span class="pu-status pu-online"><span class="pu-dot"></span>Connected</span></div>';
    selfPopupHtml += '<div class="pu-grid">';
    selfPopupHtml += `<span class="pu-lbl">Speed</span><span class="pu-val">${speed >= 1 ? speed : 0} km/h</span>`;
    if (accuracy != null) selfPopupHtml += `<span class="pu-lbl">Accuracy</span><span class="pu-val ${accCls0}">~${Math.round(accuracy)}m</span>`;
    if (formattedTime) selfPopupHtml += `<span class="pu-lbl">Updated</span><span class="pu-val">${escapeAttr(String(formattedTime))}</span>`;
    selfPopupHtml += `<span class="pu-lbl">Position</span><span class="pu-val pu-mono">${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}</span>`;
    selfPopupHtml += '</div>';
    if (selfBadges.length) selfPopupHtml += '<div class="pu-feats">' + selfBadges.join('') + '</div>';
    selfPopupHtml += '</div>';

    if (!myMarker) {
      const el = createMapIcon('var(--primary-500)', '', { markerType: 'self' });
      myPopup = new maplibregl.Popup({ offset: [0, -44], maxWidth: '280px', closeButton: false })
        .setHTML(selfPopupHtml);
      myMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat(lngLat)
        .setPopup(myPopup)
        .addTo(map);
    } else {
      animateMarkerTo('__self__', myMarker, lngLat);
      myPopup.setHTML(selfPopupHtml);
    }

    if (followMode) {
      map.easeTo({ center: lngLat, zoom: Math.max(map.getZoom(), 15), duration: 600 });
    } else if (!hasSetView) {
      map.jumpTo({ center: lngLat, zoom: 15 });
    }
    hasSetView = true;
  }

  $: if (map && map.loaded()) {
    const gf = $mySafetyStatus?.geofence;
    if (gf?.enabled && gf.centerLat != null && gf.centerLng != null && gf.radiusM > 0) {
      updateCircleSource('my-geofence', [gf.centerLng, gf.centerLat], gf.radiusM);
    } else {
      updateCircleSource('my-geofence', [0, 0], 0);
    }
  }

  function buildPopup(user) {
    const name = escapeAttr(user.displayName || 'User');
    const s = (v) => escapeAttr(String(v ?? ''));
    const isOnline = user.online !== false;

    let html = `<div class="pu-wrap">`;
    html += `<div class="pu-hdr">`;
    html += `<strong class="pu-name">${name}</strong>`;
    html += `<span class="pu-status ${isOnline ? 'pu-online' : 'pu-offline'}"><span class="pu-dot"></span>${isOnline ? 'Online' : 'Offline'}</span>`;
    html += `</div>`;

    html += `<div class="pu-grid">`;
    html += `<span class="pu-lbl">Speed</span><span class="pu-val">${parseFloat(user.speed) >= 1 ? user.speed : 0} km/h</span>`;

    const myLoc = $myLocation;
    if (myLoc && user.latitude != null && user.longitude != null) {
      const dist = calculateDistance(myLoc.latitude, myLoc.longitude, user.latitude, user.longitude);
      const formatted = formatDistance(dist);
      if (formatted) html += `<span class="pu-lbl">Distance</span><span class="pu-val">${formatted}</span>`;
    }
    if (user.accuracy != null) {
      const accCls = user.accuracy <= 15 ? 'pu-good' : user.accuracy <= 50 ? 'pu-warn' : 'pu-danger';
      html += `<span class="pu-lbl">Accuracy</span><span class="pu-val ${accCls}">~${Math.round(user.accuracy)}m</span>`;
    }
    if (user.formattedTime) html += `<span class="pu-lbl">Updated</span><span class="pu-val">${s(user.formattedTime)}</span>`;
    if (user.batteryPct != null) {
      const batCls = user.batteryPct > 50 ? 'pu-good' : user.batteryPct > 20 ? 'pu-warn' : 'pu-danger';
      html += `<span class="pu-lbl">Battery</span><span class="pu-val ${batCls}">${user.batteryPct > 75 ? '🔋' : '🪫'} ${user.batteryPct}%</span>`;
    }
    if (user.deviceType) html += `<span class="pu-lbl">Device</span><span class="pu-val">${s(user.deviceType)}</span>`;
    if (user.connectionQuality && user.connectionQuality !== 'Unknown') {
      const cqCls = user.connectionQuality === 'Good' ? 'pu-good' : user.connectionQuality === 'OK' ? 'pu-warn' : 'pu-danger';
      html += `<span class="pu-lbl">Signal</span><span class="pu-val ${cqCls}">${s(user.connectionQuality)}</span>`;
    }
    if (user.latitude != null && user.longitude != null) {
      html += `<span class="pu-lbl">Position</span><span class="pu-val pu-mono">${Number(user.latitude).toFixed(5)}, ${Number(user.longitude).toFixed(5)}</span>`;
    }
    html += `</div>`;

    const badges = [];
    if (user.sos?.active) {
      const sosReason = user.sos.reason ? ': ' + s(user.sos.reason) : '';
      const sosTime = user.sos.at ? ' at ' + new Date(user.sos.at).toLocaleTimeString() : '';
      badges.push(`<div class="pu-badge pu-badge-sos">⚠ SOS Active${sosReason}${sosTime}</div>`);
    }
    if (user.geofence?.enabled) {
      const r = user.geofence.radiusM ? (user.geofence.radiusM >= 1000 ? (user.geofence.radiusM / 1000).toFixed(1) + 'km' : user.geofence.radiusM + 'm') : '';
      badges.push(`<div class="pu-badge pu-badge-geo">⬡ Geofence${r ? ' · ' + r : ''}</div>`);
    }
    if (user.autoSos?.enabled) badges.push(`<div class="pu-badge pu-badge-autoSos">⏱ Auto-SOS · ${user.autoSos.noMoveMinutes || '?'}min</div>`);
    if (user.checkIn?.enabled) {
      const lastCI = user.checkIn.lastCheckInAt ? new Date(user.checkIn.lastCheckInAt).toLocaleTimeString() : 'never';
      badges.push(`<div class="pu-badge pu-badge-checkin">✓ Check-in · every ${user.checkIn.intervalMinutes || '?'}min · last: ${lastCI}</div>`);
    }
    if (badges.length) html += `<div class="pu-badges">${badges.join('')}</div>`;
    if (user.rooms && user.rooms.length > 0) html += `<div class="pu-rooms"><span class="pu-lbl">Rooms:</span> ${user.rooms.map(r => s(r)).join(', ')}</div>`;
    html += `</div>`;
    return html;
  }

  function buildPopupCached(user) {
    const ml = $myLocation;
    const hash = `${user.displayName}|${user.online}|${user.speed}|${user.accuracy}|${user.formattedTime}|${user.batteryPct}|${user.latitude?.toFixed(4)}|${user.longitude?.toFixed(4)}|${user.sos?.active}|${user.geofence?.enabled}|${user.checkIn?.lastCheckInAt}|${ml?.latitude?.toFixed(3)}|${ml?.longitude?.toFixed(3)}`;
    const cached = popupCache.get(user.socketId);
    if (cached && cached.hash === hash) return cached.html;
    const html = buildPopup(user);
    popupCache.set(user.socketId, { hash, html });
    return html;
  }

  // renderUserMarkers is replaced by updateSingleMarker + dirty tracking above.

  function updateSingleMarker(sid, user) {
    if (!map || user.latitude == null || user.longitude == null) return;
    const lngLat = [user.longitude, user.latitude];
    let markerType = 'contact';
    let color = getUserColor(user.userId);
    if (user.sos?.active) { markerType = 'sos'; color = 'var(--danger-500)'; }
    else if (user.online === false) { markerType = 'offline'; color = 'var(--gray-400)'; }
    const iconKey = `${markerType}|${color}`;
    const popupContent = buildPopupCached(user);

    if (markers.has(sid)) {
      const m = markers.get(sid);
      animateMarkerTo(sid, m, lngLat);
      if (markerState.get(sid) !== iconKey) {
        const el = createMapIcon(color, '', { pulse: !!user.sos?.active, markerType });
        const newMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat(m.getLngLat())
          .addTo(map);
        const popup = markerPopups.get(sid);
        if (popup) { popup.setHTML(popupContent); newMarker.setPopup(popup); }
        m.remove();
        markers.set(sid, newMarker);
        markerState.set(sid, iconKey);
      } else {
        const popup = markerPopups.get(sid);
        if (popup) popup.setHTML(popupContent);
      }
    } else {
      const el = createMapIcon(color, '', { pulse: !!user.sos?.active, markerType });
      // Apply entrance animation via class (defined in Map.svelte :global CSS)
      el.classList.add('map-pin-enter');
      setTimeout(() => el.classList.remove('map-pin-enter'), 500);
      const popup = new maplibregl.Popup({ offset: [0, -39], maxWidth: '280px', closeButton: true })
        .setHTML(popupContent);
      const m = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat(lngLat)
        .setPopup(popup)
        .addTo(map);
      markers.set(sid, m);
      markerPopups.set(sid, popup);
      markerState.set(sid, iconKey);
    }
  }

  $: if (map) {
    const current = $otherUsers;
    pendingUsers = current;

    // Remove markers for users no longer present
    for (const [sid, m] of markers) {
      if (!current.has(sid)) {
        cancelAnimation(sid);
        m.remove();
        markers.delete(sid);
        markerState.delete(sid);
        popupCache.delete(sid);
        _lastRenderedUsers.delete(sid);
        if (markerPopups.has(sid)) { markerPopups.get(sid).remove(); markerPopups.delete(sid); }
        dirtyMarkers.delete(sid);
      }
    }

    // Clean stale geofence sources
    for (const sid of geofenceIds) {
      if (!current.has(sid)) {
        const srcId = 'gf-' + sid;
        if (map.getLayer(srcId + '-fill')) map.removeLayer(srcId + '-fill');
        if (map.getLayer(srcId + '-outline')) map.removeLayer(srcId + '-outline');
        if (map.getSource(srcId)) map.removeSource(srcId);
        geofenceIds.delete(sid);
      }
    }

    // Mark only changed users as dirty
    for (const [sid, user] of current) {
      if (user.latitude == null || user.longitude == null) continue;
      if (_lastRenderedUsers.get(sid) !== user) {
        _lastRenderedUsers.set(sid, user);
        markDirty(sid);
      }
    }

    // Handle geofences (still rendered via renderUserMarkers for simplicity)
    if (renderUsersRaf) cancelAnimationFrame(renderUsersRaf);
    renderUsersRaf = requestAnimationFrame(() => {
      renderUsersRaf = null;
      // Only handle geofences in the full render pass
      for (const [sid, user] of current) {
        if (!map.loaded()) continue;
        const gf = user.geofence;
        const srcId = 'gf-' + sid;
        if (gf?.enabled && gf.centerLat != null && gf.centerLng != null && gf.radiusM > 0) {
          ensureCircleSource(srcId);
          ensureCircleLayer(srcId + '-fill', srcId, '#8b5cf6', 0.08, '#8b5cf6', 2, [6, 4]);
          updateCircleSource(srcId, [gf.centerLng, gf.centerLat], gf.radiusM);
          geofenceIds.add(sid);
        } else if (geofenceIds.has(sid)) {
          if (map.getLayer(srcId + '-fill')) map.removeLayer(srcId + '-fill');
          if (map.getLayer(srcId + '-outline')) map.removeLayer(srcId + '-outline');
          if (map.getSource(srcId)) map.removeSource(srcId);
          geofenceIds.delete(sid);
        }
      }
    });
  }

  // Update cluster GeoJSON whenever user positions change
  $: if (map && map.getSource('users-cluster')) {
    const features = [];
    for (const user of $otherUsers.values()) {
      if (user.latitude == null || user.longitude == null || user.online === false) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [user.longitude, user.latitude] },
        properties: { name: user.displayName || 'User', sos: !!user.sos?.active },
      });
    }
    map.getSource('users-cluster').setData({ type: 'FeatureCollection', features });
  }

  $: if (map && $focusUser) {
    const sid = $focusUser;
    focusUser.set(null);

    if (sid === '__self__' && myMarker && $myLocation) {
      map.flyTo({ center: [$myLocation.longitude, $myLocation.latitude], zoom: 17, duration: 800 });
      setTimeout(() => myMarker.togglePopup(), 900);
    } else if (markers.has(sid)) {
      const m = markers.get(sid);
      const ll = m.getLngLat();
      map.flyTo({ center: [ll.lng, ll.lat], zoom: 17, duration: 800 });
      setTimeout(() => m.togglePopup(), 900);
    } else {
      for (const [mSid, user] of $otherUsers) {
        if (user.userId === sid && markers.has(mSid)) {
          const m = markers.get(mSid);
          map.flyTo({ center: m.getLngLat(), zoom: 17, duration: 800 });
          setTimeout(() => m.togglePopup(), 900);
          break;
        }
      }
    }
  }

</script>

<div class="map-container" bind:this={mapContainer}></div>

{#if $mySafetyStatus?.geofence?.enabled || $mySafetyStatus?.autoSos?.enabled || $mySafetyStatus?.checkIn?.enabled}
  <div class="safety-overlay" role="status" aria-label="Active safety features">
    {#if $mySafetyStatus.geofence.enabled}
      <div class="safety-chip geofence">
        <span class="safety-icon">⬡</span>
        <span class="safety-label">Geofence</span>
        {#if $mySafetyStatus.geofence.radiusM}
          <span class="safety-detail">{$mySafetyStatus.geofence.radiusM >= 1000 ? ($mySafetyStatus.geofence.radiusM / 1000).toFixed(1) + 'km' : $mySafetyStatus.geofence.radiusM + 'm'}</span>
        {/if}
      </div>
    {/if}
    {#if $mySafetyStatus.autoSos.enabled}
      <div class="safety-chip autosos">
        <span class="safety-icon">⏱</span>
        <span class="safety-label">Auto-SOS</span>
        {#if $mySafetyStatus.autoSos.noMoveMinutes}
          <span class="safety-detail">{$mySafetyStatus.autoSos.noMoveMinutes}min</span>
        {/if}
      </div>
    {/if}
    {#if $mySafetyStatus.checkIn.enabled}
      <div class="safety-chip checkin">
        <span class="safety-icon">✓</span>
        <span class="safety-label">Check-in</span>
        {#if $mySafetyStatus.checkIn.intervalMinutes}
          <span class="safety-detail">every {$mySafetyStatus.checkIn.intervalMinutes}min</span>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .map-container {
    position: absolute;
    inset: 0;
    z-index: 1;
  }

  :global(.map-pin) {
    cursor: pointer;
    filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.28));
    transition: opacity 0.2s ease, filter 0.2s ease;
    pointer-events: auto;
    overflow: visible;
  }
  :global(.map-pin:hover) {
    filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.35));
  }
  :global(.map-pin svg) {
    display: block;
  }

  :global(.map-pin.pin-self::after) {
    content: '';
    position: absolute;
    bottom: 0;
    left: 50%;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--primary-500, #3b82f6);
    opacity: 0;
    transform: translate(-50%, 50%);
    animation: pin-ripple 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    pointer-events: none;
    z-index: -1;
  }

  :global(.map-pin.pin-sos::after) {
    content: '';
    position: absolute;
    bottom: 0;
    left: 50%;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #ef4444;
    opacity: 0;
    transform: translate(-50%, 50%);
    animation: pin-ripple-sos 1.5s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    pointer-events: none;
    z-index: -1;
  }

  :global(.map-pin.pin-offline) {
    opacity: 0.5;
  }
  :global(.map-pin.pin-stored) {
    opacity: 0.3;
  }

  @keyframes pin-ripple {
    0%   { opacity: 0.45; transform: translate(-50%, 50%) scale(1); }
    100% { opacity: 0;    transform: translate(-50%, 50%) scale(5); }
  }
  @keyframes pin-ripple-sos {
    0%   { opacity: 0.55; transform: translate(-50%, 50%) scale(1); }
    100% { opacity: 0;    transform: translate(-50%, 50%) scale(6); }
  }

  :global(.maplibregl-popup-content) {
    border-radius: 14px;
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.18),
      0 0 0 1px rgba(0, 0, 0, 0.06);
    padding: 12px 14px;
    line-height: 1.5;
    font-family: var(--font-sans, 'Inter', sans-serif);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
  :global([data-theme="dark"] .maplibregl-popup-content) {
    background: rgba(20, 25, 40, 0.92);
    color: rgba(255, 255, 255, 0.90);
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.45),
      0 0 0 1px rgba(255, 255, 255, 0.06);
  }
  :global(.maplibregl-popup-tip) {
    border-top-color: white;
  }
  :global([data-theme="dark"] .maplibregl-popup-tip) {
    border-top-color: rgba(20, 25, 40, 0.92);
  }
  :global(.maplibregl-popup-close-button) {
    font-size: 18px;
    color: var(--gray-400);
    padding: 4px 8px;
    border-radius: 6px;
    transition: color 0.15s ease, background 0.15s ease;
  }
  :global(.maplibregl-popup-close-button:hover) {
    color: var(--gray-700);
    background: rgba(0,0,0,0.06);
  }

  /* ── Popup content classes (light + dark mode aware) ─────────────────── */
  :global(.pu-wrap)  { min-width: 180px; font-size: 12px; line-height: 1.5; }
  :global(.pu-hdr)   { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  :global(.pu-name)  { font-size: 14px; font-weight: 700; }
  :global(.pu-status) { display: inline-flex; align-items: center; gap: 3px; font-size: 10px; font-weight: 600; }
  :global(.pu-dot)   { width: 7px; height: 7px; border-radius: 50%; background: currentColor; display: inline-block; }
  :global(.pu-online)  { color: #22c55e; }
  :global(.pu-offline) { color: #9ca3af; }
  :global(.pu-grid)  { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; font-size: 11px; }
  :global(.pu-lbl)   { font-weight: 600; opacity: 0.55; }
  :global(.pu-val)   { }
  :global(.pu-good)  { color: #22c55e; font-weight: 600; }
  :global(.pu-warn)  { color: #eab308; font-weight: 600; }
  :global(.pu-danger){ color: #ef4444; font-weight: 600; }
  :global(.pu-mono)  { font-family: monospace; font-size: 10px; }
  :global(.pu-badges){ margin-top: 6px; display: flex; flex-direction: column; gap: 3px; font-size: 10px; }
  :global(.pu-badge) { border-radius: 6px; padding: 3px 8px; font-weight: 500; border: 1px solid transparent; }
  :global(.pu-badge-sos)    { background: rgba(220, 38, 38, 0.10); color: #dc2626; border-color: rgba(220, 38, 38, 0.25); font-weight: 700; }
  :global(.pu-badge-geo)    { background: rgba(124, 58, 237, 0.10); color: #7c3aed; border-color: rgba(124, 58, 237, 0.25); }
  :global(.pu-badge-autoSos){ background: rgba(217, 119, 6, 0.10); color: #d97706; border-color: rgba(217, 119, 6, 0.25); }
  :global(.pu-badge-checkin){ background: rgba(8, 145, 178, 0.10); color: #0891b2; border-color: rgba(8, 145, 178, 0.25); }
  :global(.pu-feats) { margin-top: 5px; display: flex; flex-wrap: wrap; gap: 4px; font-size: 10px; }
  :global(.pu-feat)  { font-weight: 600; }
  :global(.pu-feat-geo)    { color: #8b5cf6; }
  :global(.pu-feat-autoSos){ color: #f59e0b; }
  :global(.pu-feat-checkin){ color: #06b6d4; }
  :global(.pu-rooms) { margin-top: 5px; font-size: 10px; opacity: 0.7; }

  /* Dark mode: badge colours stay vivid, labels adapt via opacity */
  :global([data-theme="dark"] .pu-badge-sos)    { background: rgba(220, 38, 38, 0.20); border-color: rgba(220, 38, 38, 0.40); color: #fca5a5; }
  :global([data-theme="dark"] .pu-badge-geo)    { background: rgba(167, 139, 250, 0.15); border-color: rgba(167, 139, 250, 0.30); color: #c4b5fd; }
  :global([data-theme="dark"] .pu-badge-autoSos){ background: rgba(252, 211, 77, 0.12); border-color: rgba(252, 211, 77, 0.25); color: #fcd34d; }
  :global([data-theme="dark"] .pu-badge-checkin){ background: rgba(103, 232, 249, 0.12); border-color: rgba(103, 232, 249, 0.25); color: #67e8f9; }

  .safety-overlay {
    position: absolute;
    top: calc(var(--safe-top, 0px) + 92px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: center;
    pointer-events: none;
  }
  .safety-chip {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 12px;
    border-radius: var(--radius-full);
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    backdrop-filter: var(--glass-blur-sm, blur(12px) saturate(1.4));
    -webkit-backdrop-filter: var(--glass-blur-sm, blur(12px) saturate(1.4));
    box-shadow: var(--map-chip-shadow, 0 2px 12px rgba(0,0,0,0.10));
    pointer-events: auto;
    animation: chip-in 0.3s var(--ease-spring);
  }
  .safety-chip.geofence { background: rgba(139, 92, 246, 0.18); border: 1px solid rgba(139, 92, 246, 0.35); color: #7c3aed; }
  .safety-chip.autosos  { background: rgba(245, 158, 11, 0.18); border: 1px solid rgba(245, 158, 11, 0.35); color: #d97706; }
  .safety-chip.checkin  { background: rgba(6, 182, 212, 0.18); border: 1px solid rgba(6, 182, 212, 0.35); color: #0891b2; }

  :global([data-theme="dark"]) .safety-chip.geofence { background: rgba(139, 92, 246, 0.22); color: #a78bfa; }
  :global([data-theme="dark"]) .safety-chip.autosos  { background: rgba(245, 158, 11, 0.22); color: #fbbf24; }
  :global([data-theme="dark"]) .safety-chip.checkin  { background: rgba(6, 182, 212, 0.22); color: #22d3ee; }
  .safety-icon { font-size: 13px; }
  .safety-detail { opacity: 0.7; font-weight: 500; font-size: 10px; }
  @keyframes chip-in {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @media (max-width: 767px) {
    :global(.maplibregl-ctrl-group) {
      margin-bottom: calc(var(--bottom-tab-height, 56px) + var(--space-4)) !important;
      margin-right: var(--space-3) !important;
    }
  }

  /* Marker entrance animation — defined here so it's in the same scope as the global marker elements */
  :global(.map-pin-enter) {
    animation: markerPop 400ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  }

  @keyframes markerPop {
    0%   { transform: scale(0) translateY(12px); opacity: 0; }
    65%  { transform: scale(1.18) translateY(-4px); opacity: 1; }
    100% { transform: scale(1) translateY(0); }
  }

  /* SOS marker: more dramatic entrance */
  :global(.map-pin.pin-sos.map-pin-enter) {
    animation: sosPinEnter 500ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  }

  @keyframes sosPinEnter {
    0%   { transform: scale(0) translateY(16px); opacity: 0; }
    60%  { transform: scale(1.25) translateY(-6px); opacity: 1; }
    80%  { transform: scale(0.95) translateY(2px); }
    100% { transform: scale(1) translateY(0); }
  }
</style>
