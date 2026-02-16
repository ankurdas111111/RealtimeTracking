<script>
  import { onMount, onDestroy } from 'svelte';
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import { otherUsers, myLocation, mySocketId, mySafetyStatus, focusUser } from '../lib/stores/map.js';
  import { createMapIcon, escapeAttr } from '../lib/tracking.js';
  import { animateMarkerTo, cancelAllAnimations } from '../lib/markerInterpolator.js';

  let mapContainer;
  let map;
  let markers = new Map();
  let markerState = new Map(); // tracks visual state per marker to avoid redundant setIcon
  let geofenceCircles = new Map();
  let myMarker = null;
  let hasSetView = false;
  let isMobile = false;
  let renderUsersRaf = null;
  let pendingUsers = new Map();
  let accuracyCircle = null;
  let myGeofenceCircle = null;
  let tileLayer = null;
  let tileProviderIdx = 0;
  let tileErrorCount = 0;
  const tileProviders = [
    { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', options: { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' } },
    { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', options: { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors &copy; CARTO' } }
  ];

  function checkMobile() {
    isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  }

  function mountTileProvider(index) {
    if (!map) return;
    if (tileLayer) {
      map.removeLayer(tileLayer);
      tileLayer = null;
    }
    tileProviderIdx = index;
    tileErrorCount = 0;
    const provider = tileProviders[index];
    tileLayer = L.tileLayer(provider.url, { ...provider.options, crossOrigin: true });
    tileLayer.on('tileerror', () => {
      tileErrorCount += 1;
      if (tileErrorCount >= 3 && tileProviderIdx < tileProviders.length - 1) {
        mountTileProvider(tileProviderIdx + 1);
      }
    });
    tileLayer.addTo(map);
  }

  onMount(() => {
    checkMobile();
    window.addEventListener('resize', checkMobile);

    map = L.map(mapContainer, {
      center: [20, 0],
      zoom: 3,
      zoomControl: false,
      attributionControl: false
    });

    L.control.zoom({ position: isMobile ? 'bottomright' : 'topright' }).addTo(map);
    L.control.attribution({ position: 'bottomleft' }).addTo(map);

    mountTileProvider(0);

    setTimeout(() => map.invalidateSize(), 200);

    const observer = new ResizeObserver(() => {
      if (map) map.invalidateSize();
    });
    observer.observe(mapContainer);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', checkMobile);
    };
  });

  onDestroy(() => {
    cancelAllAnimations();
    if (renderUsersRaf) cancelAnimationFrame(renderUsersRaf);
    for (const c of geofenceCircles.values()) { if (map) map.removeLayer(c); }
    geofenceCircles.clear();
    if (myGeofenceCircle && map) map.removeLayer(myGeofenceCircle);
    if (map) map.remove();
  });

  $: if (map && $myLocation) {
    const { latitude, longitude, speed, formattedTime, accuracy } = $myLocation;
    const pos = [latitude, longitude];
    const selfBadges = [];
    if ($mySafetyStatus?.geofence?.enabled) selfBadges.push('<span style="color:#8b5cf6">⬡ Geofence</span>');
    if ($mySafetyStatus?.autoSos?.enabled) selfBadges.push('<span style="color:#f59e0b">⏱ Auto-SOS</span>');
    if ($mySafetyStatus?.checkIn?.enabled) selfBadges.push('<span style="color:#06b6d4">✓ Check-in</span>');
    const selfPopup = '<strong>You</strong>' + (selfBadges.length ? '<br/><div style="margin-top:4px;font-size:11px;line-height:1.4">' + selfBadges.join(' &middot; ') + '</div>' : '');

    if (!myMarker) {
      const icon = createMapIcon('var(--primary-500)', 'ME', { pulse: true, markerType: 'self' });
      myMarker = L.marker(pos, { icon, zIndexOffset: 1000 }).addTo(map);
      myMarker.bindPopup(selfPopup);
    } else {
      animateMarkerTo('__self__', myMarker, pos, 150);
      myMarker.setPopupContent(selfPopup);
    }
    // Accuracy circle around own position
    if (accuracy != null && accuracy > 0) {
      if (!accuracyCircle) {
        accuracyCircle = L.circle(pos, {
          radius: accuracy,
          color: 'var(--primary-500)',
          weight: 1,
          opacity: 0.3,
          fillColor: 'var(--primary-500)',
          fillOpacity: 0.08,
          interactive: false
        }).addTo(map);
      } else {
        accuracyCircle.setLatLng(pos);
        accuracyCircle.setRadius(accuracy);
      }
    }
    if (!hasSetView) {
      map.setView(pos, 15);
      hasSetView = true;
    }
  }

  // Geofence circle for self
  $: if (map) {
    const gf = $mySafetyStatus?.geofence;
    if (gf?.enabled && gf.centerLat != null && gf.centerLng != null && gf.radiusM > 0) {
      const gfPos = [gf.centerLat, gf.centerLng];
      if (myGeofenceCircle) {
        myGeofenceCircle.setLatLng(gfPos);
        myGeofenceCircle.setRadius(gf.radiusM);
      } else {
        myGeofenceCircle = L.circle(gfPos, {
          radius: gf.radiusM,
          color: '#8b5cf6',
          weight: 2.5,
          opacity: 0.7,
          fillColor: '#8b5cf6',
          fillOpacity: 0.10,
          dashArray: '8 5',
          interactive: false,
          className: 'geofence-circle'
        }).addTo(map);
      }
    } else if (myGeofenceCircle) {
      map.removeLayer(myGeofenceCircle);
      myGeofenceCircle = null;
    }
  }

  function buildPopup(user) {
    const name = escapeAttr(user.displayName || 'User');
    const s = (v) => escapeAttr(String(v ?? ''));

    const onlineColor = user.online === false ? '#9ca3af' : '#22c55e';
    const onlineLabel = user.online === false ? 'Offline' : 'Online';

    let html = `<div style="min-width:180px;font-size:12px;line-height:1.5">`;

    // Header: name + online badge
    html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">`;
    html += `<strong style="font-size:14px">${name}</strong>`;
    html += `<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;color:${onlineColor};font-weight:600">`;
    html += `<span style="width:7px;height:7px;border-radius:50%;background:${onlineColor};display:inline-block"></span>${onlineLabel}</span>`;
    html += `</div>`;

    // Details grid
    html += `<div style="display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:11px;color:#555">`;

    // Speed
    html += `<span style="font-weight:600;color:#374151">Speed</span><span>${user.speed || '0'} km/h</span>`;

    // Accuracy
    if (user.accuracy != null) {
      const accColor = user.accuracy <= 15 ? '#22c55e' : user.accuracy <= 50 ? '#eab308' : '#ef4444';
      html += `<span style="font-weight:600;color:#374151">Accuracy</span><span style="color:${accColor}">~${Math.round(user.accuracy)}m</span>`;
    }

    // Last update
    if (user.formattedTime) {
      html += `<span style="font-weight:600;color:#374151">Updated</span><span>${s(user.formattedTime)}</span>`;
    }

    // Battery
    if (user.batteryPct != null) {
      const batColor = user.batteryPct > 50 ? '#22c55e' : user.batteryPct > 20 ? '#eab308' : '#ef4444';
      const batIcon = user.batteryPct > 75 ? '🔋' : user.batteryPct > 20 ? '🪫' : '🪫';
      html += `<span style="font-weight:600;color:#374151">Battery</span><span>${batIcon} <span style="color:${batColor};font-weight:600">${user.batteryPct}%</span></span>`;
    }

    // Device
    if (user.deviceType) {
      html += `<span style="font-weight:600;color:#374151">Device</span><span>${s(user.deviceType)}</span>`;
    }

    // Connection quality
    if (user.connectionQuality && user.connectionQuality !== 'Unknown') {
      const cqColor = user.connectionQuality === 'Good' ? '#22c55e' : user.connectionQuality === 'OK' ? '#eab308' : '#ef4444';
      html += `<span style="font-weight:600;color:#374151">Signal</span><span style="color:${cqColor}">${s(user.connectionQuality)}</span>`;
    }

    // Coordinates
    if (user.latitude != null && user.longitude != null) {
      html += `<span style="font-weight:600;color:#374151">Position</span><span style="font-family:monospace;font-size:10px">${Number(user.latitude).toFixed(5)}, ${Number(user.longitude).toFixed(5)}</span>`;
    }

    html += `</div>`;

    // Safety badges
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
    if (user.autoSos?.enabled) {
      badges.push(`<div style="background:#fffbeb;color:#d97706;border:1px solid #fde68a;border-radius:6px;padding:3px 8px">⏱ Auto-SOS · ${user.autoSos.noMoveMinutes || '?'}min</div>`);
    }
    if (user.checkIn?.enabled) {
      const lastCI = user.checkIn.lastCheckInAt ? new Date(user.checkIn.lastCheckInAt).toLocaleTimeString() : 'never';
      badges.push(`<div style="background:#ecfeff;color:#0891b2;border:1px solid #a5f3fc;border-radius:6px;padding:3px 8px">✓ Check-in · every ${user.checkIn.intervalMinutes || '?'}min · last: ${lastCI}</div>`);
    }
    if (badges.length) {
      html += `<div style="margin-top:6px;display:flex;flex-direction:column;gap:3px;font-size:10px">${badges.join('')}</div>`;
    }

    // Rooms
    if (user.rooms && user.rooms.length > 0) {
      html += `<div style="margin-top:5px;font-size:10px;color:#6b7280"><span style="font-weight:600">Rooms:</span> ${user.rooms.map(r => s(r)).join(', ')}</div>`;
    }

    html += `</div>`;
    return html;
  }

  function renderUserMarkers(current) {
    if (!map) return;
    const currentIds = new Set(current.keys());

    // Remove stale markers and geofence circles
    for (const [sid, marker] of markers) {
      if (!currentIds.has(sid)) {
        map.removeLayer(marker);
        markers.delete(sid);
        markerState.delete(sid);
      }
    }
    for (const [sid, circle] of geofenceCircles) {
      if (!currentIds.has(sid)) {
        map.removeLayer(circle);
        geofenceCircles.delete(sid);
      }
    }

    for (const [sid, user] of current) {
      if (user.latitude == null || user.longitude == null) continue;
      const pos = [user.latitude, user.longitude];
      const name = user.displayName || 'User';
      const firstLetter = name[0]?.toUpperCase() || '?';

      let markerType = 'contact';
      let color = 'var(--success-500)';
      if (user.sos?.active) {
        markerType = 'sos';
        color = 'var(--danger-500)';
      } else if (user.online === false) {
        markerType = 'offline';
        color = 'var(--gray-400)';
      }

      const iconKey = `${markerType}|${firstLetter}|${!!user.sos?.active}`;
      const icon = createMapIcon(color, firstLetter, { pulse: !!user.sos?.active, markerType });
      const popupContent = buildPopup(user);

      const tooltipText = escapeAttr(name) + (user.sos?.active ? ' [SOS]' : '') + (user.online === false ? ' (offline)' : '');

      if (markers.has(sid)) {
        const m = markers.get(sid);
        animateMarkerTo(sid, m, pos, 300);
        // Only replace the icon when the visual actually changes to avoid
        // disrupting open popups/tooltips on every position update
        if (markerState.get(sid) !== iconKey) {
          m.setIcon(icon);
          markerState.set(sid, iconKey);
        }
        m.setPopupContent(popupContent);
        m.setTooltipContent(tooltipText);
      } else {
        const m = L.marker(pos, { icon }).addTo(map);
        m.bindPopup(popupContent, { maxWidth: 280, minWidth: 200, className: 'user-popup' });
        m.bindTooltip(tooltipText, { direction: 'top', offset: [0, -36], className: 'user-tooltip' });
        markers.set(sid, m);
        markerState.set(sid, iconKey);
      }

      // Geofence circle for this user
      const gf = user.geofence;
      if (gf?.enabled && gf.centerLat != null && gf.centerLng != null && gf.radiusM > 0) {
        const gfPos = [gf.centerLat, gf.centerLng];
        if (geofenceCircles.has(sid)) {
          const c = geofenceCircles.get(sid);
          c.setLatLng(gfPos);
          c.setRadius(gf.radiusM);
        } else {
          const c = L.circle(gfPos, {
            radius: gf.radiusM,
            color: '#8b5cf6',
            weight: 2,
            opacity: 0.6,
            fillColor: '#8b5cf6',
            fillOpacity: 0.08,
            dashArray: '6 4',
            interactive: false,
            className: 'geofence-circle'
          }).addTo(map);
          geofenceCircles.set(sid, c);
        }
      } else if (geofenceCircles.has(sid)) {
        map.removeLayer(geofenceCircles.get(sid));
        geofenceCircles.delete(sid);
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

  // Fly to a focused user and open their popup
  $: if (map && $focusUser) {
    const sid = $focusUser;
    focusUser.set(null); // consume the event

    if (sid === '__self__' && myMarker && $myLocation) {
      map.flyTo([$myLocation.latitude, $myLocation.longitude], 17, { duration: 0.8 });
      setTimeout(() => myMarker.openPopup(), 900);
    } else if (markers.has(sid)) {
      const m = markers.get(sid);
      const ll = m.getLatLng();
      map.flyTo(ll, 17, { duration: 0.8 });
      setTimeout(() => m.openPopup(), 900);
    } else {
      // Try finding the user in otherUsers by userId (sid could be a userId)
      for (const [mSid, user] of $otherUsers) {
        if (user.userId === sid) {
          if (markers.has(mSid)) {
            const m = markers.get(mSid);
            map.flyTo(m.getLatLng(), 17, { duration: 0.8 });
            setTimeout(() => m.openPopup(), 900);
          }
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

  /* ── Custom marker base ──────────────────────────────────────────────── */
  :global(.custom-map-icon) {
    background: none !important;
    border: none !important;
  }

  /* ── Popup styling ─────────────────────────────────────────────────────── */
  :global(.user-popup .leaflet-popup-content-wrapper) {
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    padding: 0;
  }
  :global(.user-popup .leaflet-popup-content) {
    margin: 10px 12px;
    line-height: 1.5;
  }
  :global(.user-popup .leaflet-popup-tip) {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  /* ── Tooltip styling ─────────────────────────────────────────────────── */
  :global(.user-tooltip) {
    background: rgba(17, 24, 39, 0.88);
    color: white;
    border: none;
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 12px;
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    white-space: nowrap;
  }
  :global(.user-tooltip::before) {
    border-top-color: rgba(17, 24, 39, 0.88) !important;
  }

  /* ── Badge marker ─────────────────────────────────────────────────────── */
  :global(.badge-marker) {
    position: relative;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    transition: transform 0.15s ease, opacity 0.15s ease;
    cursor: pointer;
  }

  :global(.badge-marker svg) {
    pointer-events: none;
  }

  :global(.badge-marker .badge-text) {
    position: absolute;
    top: 16%;
    left: 50%;
    transform: translateX(-50%);
    font-size: 12px;
    font-weight: 800;
    color: #374151;
    line-height: 1;
    pointer-events: none;
    text-shadow: 0 0.5px 0 rgba(255,255,255,0.6);
    z-index: 1;
  }

  :global(.badge-marker.marker-self .badge-text) {
    font-size: 11px;
    color: #1d4ed8;
  }
  :global(.badge-marker.marker-sos .badge-text) {
    color: #dc2626;
  }
  :global(.badge-marker.marker-offline) {
    opacity: 0.5;
  }
  :global(.badge-marker.marker-stored) {
    opacity: 0.3;
  }

  /* ── Pulse animation ─────────────────────────────────────────────────── */
  :global(.badge-marker.pulse) {
    animation: badge-pulse 1.5s ease infinite;
  }

  @keyframes badge-pulse {
    0% { filter: drop-shadow(0 0 0 rgba(239, 68, 68, 0.5)); transform: scale(1); }
    50% { filter: drop-shadow(0 0 8px rgba(239, 68, 68, 0.6)); transform: scale(1.08); }
    100% { filter: drop-shadow(0 0 0 rgba(239, 68, 68, 0.5)); transform: scale(1); }
  }

  /* ── Geofence circle ─────────────────────────────────────────────────── */
  :global(.geofence-circle) {
    animation: geofence-rotate 20s linear infinite;
  }

  @keyframes geofence-rotate {
    from { stroke-dashoffset: 0; }
    to { stroke-dashoffset: 100; }
  }

  /* ── Safety overlay ─────────────────────────────────────────────────── */
  .safety-overlay {
    position: absolute;
    top: var(--space-3);
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
  .safety-chip.geofence {
    background: rgba(139, 92, 246, 0.15);
    border: 1px solid rgba(139, 92, 246, 0.35);
    color: #7c3aed;
  }
  .safety-chip.autosos {
    background: rgba(245, 158, 11, 0.15);
    border: 1px solid rgba(245, 158, 11, 0.35);
    color: #d97706;
  }
  .safety-chip.checkin {
    background: rgba(6, 182, 212, 0.15);
    border: 1px solid rgba(6, 182, 212, 0.35);
    color: #0891b2;
  }
  .safety-icon {
    font-size: 13px;
  }
  .safety-detail {
    opacity: 0.7;
    font-weight: 500;
    font-size: 10px;
  }
  @keyframes chip-in {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* ── Responsive map controls ─────────────────────────────────────────── */
  @media (max-width: 767px) {
    :global(.leaflet-control-zoom) {
      margin-bottom: calc(var(--bottom-tab-height, 56px) + var(--space-4)) !important;
      margin-right: var(--space-3) !important;
    }
  }
</style>
