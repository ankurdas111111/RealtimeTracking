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
    }

    let styleFallbackDone = false;

    function initMap(style) {
      map = new maplibregl.Map({
        container: mapContainer,
        style,
        center: [78.9629, 20.5937], // Center of India
        zoom: 4,
        attributionControl: true
      });

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }),
        isMobile ? 'bottom-right' : 'top-right');

      map.on('dragstart', () => { followMode = false; });
      map.on('load', addCircleSources);

      // If vector tiles fail to load, fall back to raster
      map.on('error', (e) => {
        if (!styleFallbackDone && style !== RASTER_STYLE) {
          styleFallbackDone = true;
          map.once('style.load', addCircleSources);
          map.setStyle(RASTER_STYLE);
        }
      });
    }

    initMap(MAP_STYLE);
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
    if ($mySafetyStatus?.geofence?.enabled) selfBadges.push('<span style="color:#8b5cf6">⬡ Geofence</span>');
    if ($mySafetyStatus?.autoSos?.enabled) selfBadges.push('<span style="color:#f59e0b">⏱ Auto-SOS</span>');
    if ($mySafetyStatus?.checkIn?.enabled) selfBadges.push('<span style="color:#06b6d4">✓ Check-in</span>');
    let selfPopupHtml = '<div style="min-width:180px;font-size:12px;line-height:1.5"><strong style="font-size:14px">You</strong>';
    selfPopupHtml += '<div style="display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:11px;color:#555;margin-top:6px">';
    selfPopupHtml += `<span style="font-weight:600;color:#374151">Online</span><span style="color:#22c55e;font-weight:600">● Connected</span>`;
    selfPopupHtml += `<span style="font-weight:600;color:#374151">Speed</span><span>${speed || '0'} km/h</span>`;
    if (accuracy != null) {
      const accColor = accuracy <= 15 ? '#22c55e' : accuracy <= 50 ? '#eab308' : '#ef4444';
      selfPopupHtml += `<span style="font-weight:600;color:#374151">Accuracy</span><span style="color:${accColor}">~${Math.round(accuracy)}m</span>`;
    }
    if (formattedTime) selfPopupHtml += `<span style="font-weight:600;color:#374151">Updated</span><span>${escapeAttr(String(formattedTime))}</span>`;
    selfPopupHtml += `<span style="font-weight:600;color:#374151">Position</span><span style="font-family:monospace;font-size:10px">${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}</span>`;
    selfPopupHtml += '</div>';
    if (selfBadges.length) selfPopupHtml += '<div style="margin-top:6px;display:flex;flex-direction:column;gap:3px;font-size:10px">' + selfBadges.join('<br/>') + '</div>';
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
    const onlineColor = user.online === false ? '#9ca3af' : '#22c55e';
    const onlineLabel = user.online === false ? 'Offline' : 'Online';

    let html = `<div style="min-width:180px;font-size:12px;line-height:1.5">`;
    html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">`;
    html += `<strong style="font-size:14px">${name}</strong>`;
    html += `<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;color:${onlineColor};font-weight:600">`;
    html += `<span style="width:7px;height:7px;border-radius:50%;background:${onlineColor};display:inline-block"></span>${onlineLabel}</span></div>`;

    html += `<div style="display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:11px;color:#555">`;
    html += `<span style="font-weight:600;color:#374151">Speed</span><span>${user.speed || '0'} km/h</span>`;

    const myLoc = $myLocation;
    if (myLoc && user.latitude != null && user.longitude != null) {
      const dist = calculateDistance(myLoc.latitude, myLoc.longitude, user.latitude, user.longitude);
      const formatted = formatDistance(dist);
      if (formatted) html += `<span style="font-weight:600;color:#374151">Distance</span><span>${formatted}</span>`;
    }
    if (user.accuracy != null) {
      const accColor = user.accuracy <= 15 ? '#22c55e' : user.accuracy <= 50 ? '#eab308' : '#ef4444';
      html += `<span style="font-weight:600;color:#374151">Accuracy</span><span style="color:${accColor}">~${Math.round(user.accuracy)}m</span>`;
    }
    if (user.formattedTime) html += `<span style="font-weight:600;color:#374151">Updated</span><span>${s(user.formattedTime)}</span>`;
    if (user.batteryPct != null) {
      const batColor = user.batteryPct > 50 ? '#22c55e' : user.batteryPct > 20 ? '#eab308' : '#ef4444';
      html += `<span style="font-weight:600;color:#374151">Battery</span><span>${user.batteryPct > 75 ? '🔋' : '🪫'} <span style="color:${batColor};font-weight:600">${user.batteryPct}%</span></span>`;
    }
    if (user.deviceType) html += `<span style="font-weight:600;color:#374151">Device</span><span>${s(user.deviceType)}</span>`;
    if (user.connectionQuality && user.connectionQuality !== 'Unknown') {
      const cqColor = user.connectionQuality === 'Good' ? '#22c55e' : user.connectionQuality === 'OK' ? '#eab308' : '#ef4444';
      html += `<span style="font-weight:600;color:#374151">Signal</span><span style="color:${cqColor}">${s(user.connectionQuality)}</span>`;
    }
    if (user.latitude != null && user.longitude != null) {
      html += `<span style="font-weight:600;color:#374151">Position</span><span style="font-family:monospace;font-size:10px">${Number(user.latitude).toFixed(5)}, ${Number(user.longitude).toFixed(5)}</span>`;
    }
    html += `</div>`;

    const badges = [];
    if (user.sos?.active) {
      const sosReason = user.sos.reason ? ': ' + s(user.sos.reason) : '';
      const sosTime = user.sos.at ? ' at ' + new Date(user.sos.at).toLocaleTimeString() : '';
      badges.push(`<div style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;border-radius:6px;padding:3px 8px;font-weight:600">⚠ SOS Active${sosReason}${sosTime}</div>`);
    }
    if (user.geofence?.enabled) {
      const r = user.geofence.radiusM ? (user.geofence.radiusM >= 1000 ? (user.geofence.radiusM / 1000).toFixed(1) + 'km' : user.geofence.radiusM + 'm') : '';
      badges.push(`<div style="background:#f5f3ff;color:#7c3aed;border:1px solid #ddd6fe;border-radius:6px;padding:3px 8px">⬡ Geofence${r ? ' · ' + r : ''}</div>`);
    }
    if (user.autoSos?.enabled) badges.push(`<div style="background:#fffbeb;color:#d97706;border:1px solid #fde68a;border-radius:6px;padding:3px 8px">⏱ Auto-SOS · ${user.autoSos.noMoveMinutes || '?'}min</div>`);
    if (user.checkIn?.enabled) {
      const lastCI = user.checkIn.lastCheckInAt ? new Date(user.checkIn.lastCheckInAt).toLocaleTimeString() : 'never';
      badges.push(`<div style="background:#ecfeff;color:#0891b2;border:1px solid #a5f3fc;border-radius:6px;padding:3px 8px">✓ Check-in · every ${user.checkIn.intervalMinutes || '?'}min · last: ${lastCI}</div>`);
    }
    if (badges.length) html += `<div style="margin-top:6px;display:flex;flex-direction:column;gap:3px;font-size:10px">${badges.join('')}</div>`;
    if (user.rooms && user.rooms.length > 0) html += `<div style="margin-top:5px;font-size:10px;color:#6b7280"><span style="font-weight:600">Rooms:</span> ${user.rooms.map(r => s(r)).join(', ')}</div>`;
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

  function renderUserMarkers(current) {
    if (!map) return;
    const currentIds = new Set(current.keys());

    for (const [sid, m] of markers) {
      if (!currentIds.has(sid)) {
        cancelAnimation(sid);
        m.remove();
        markers.delete(sid);
        markerState.delete(sid);
        popupCache.delete(sid);
        _lastRenderedUsers.delete(sid);
        if (markerPopups.has(sid)) { markerPopups.get(sid).remove(); markerPopups.delete(sid); }
      }
    }

    // Clean stale geofence sources
    for (const sid of geofenceIds) {
      if (!currentIds.has(sid)) {
        const srcId = 'gf-' + sid;
        if (map.getLayer(srcId + '-fill')) map.removeLayer(srcId + '-fill');
        if (map.getLayer(srcId + '-outline')) map.removeLayer(srcId + '-outline');
        if (map.getSource(srcId)) map.removeSource(srcId);
        geofenceIds.delete(sid);
      }
    }

    for (const [sid, user] of current) {
      if (user.latitude == null || user.longitude == null) continue;
      if (_lastRenderedUsers.get(sid) === user && markers.has(sid)) continue;
      _lastRenderedUsers.set(sid, user);

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

      // Geofence circle per user
      if (map.loaded()) {
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
    }
  }

  $: if (map) {
    pendingUsers = $otherUsers;
    if (renderUsersRaf) cancelAnimationFrame(renderUsersRaf);
    renderUsersRaf = requestAnimationFrame(() => {
      renderUsersRaf = null;
      renderUserMarkers(pendingUsers);
    });
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
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    padding: 10px 12px;
    line-height: 1.5;
  }
  :global(.maplibregl-popup-tip) {
    border-top-color: white;
  }

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
    padding: 4px 10px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 1px 4px rgba(0,0,0,0.15);
    pointer-events: auto;
    animation: chip-in 0.3s ease;
  }
  .safety-chip.geofence { background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.35); color: #7c3aed; }
  .safety-chip.autosos { background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.35); color: #d97706; }
  .safety-chip.checkin { background: rgba(6, 182, 212, 0.15); border: 1px solid rgba(6, 182, 212, 0.35); color: #0891b2; }
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
</style>
