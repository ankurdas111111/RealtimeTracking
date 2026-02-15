/* eslint-env browser */
/* global L, io, formatCoordinate, calculateDistance, createMapIcon, formatTimestamp */
var DEBUG = false;

function escHtml(str) {
    var d = document.createElement('div');
    d.textContent = (str == null ? '' : String(str));
    return d.innerHTML;
}

// ── Theme ──────────────────────────────────────────────────────────────────
(function initTheme() {
    var saved = localStorage.getItem('theme');
    if (saved) {
        document.documentElement.setAttribute('data-theme', saved);
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
})();

function isDarkMode() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
}

var LIGHT_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
var DARK_TILES = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
var TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

var map = L.map('map').setView([0, 0], 2);
var tileLayer = L.tileLayer(isDarkMode() ? DARK_TILES : LIGHT_TILES, { attribution: TILE_ATTR }).addTo(map);

function setMapTiles(dark) {
    tileLayer.setUrl(dark ? DARK_TILES : LIGHT_TILES);
}

var themeToggleBtn = document.getElementById('themeToggleBtn');
if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', function() {
        var current = document.documentElement.getAttribute('data-theme');
        var next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
        setMapTiles(next === 'dark');
    });
}

var marker = null;
var path = null;
var positions = [];
var timestamps = [];
var totalDistance = 0;
var tracking = false;
var watchId = null;

var myDisplayName = '';
var myUserId = '';
var myLocation = null;
var mySocketId = null;

var otherUsers = new Map();
var otherUserMarkers = new Map();

var selectedUsers = [];
var distanceLine = null;
var distanceLabel = null;

var storedClientId = localStorage.getItem('clientId');
var clientId = storedClientId || (crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2));
if (!storedClientId) localStorage.setItem('clientId', clientId);
var socket = io({ auth: { clientId: clientId } });

var latElement = document.getElementById('latitude');
var lngElement = document.getElementById('longitude');
var speedElement = document.getElementById('speed');
var timestampElement = document.getElementById('timestamp');
var distanceElement = document.getElementById('distance');
var trackButton = document.getElementById('trackButton');
var resetButton = document.getElementById('resetButton');
var otherUsersElement = document.getElementById('otherUsers');
var distanceDisplay = document.getElementById('distanceDisplay');
var user1NameElement = document.getElementById('user1Name');
var user2NameElement = document.getElementById('user2Name');
var userDistanceElement = document.getElementById('userDistance');
var clearSelectionButton = document.getElementById('clearSelection');
var sosBtn = document.getElementById('sosBtn');
var imOkBtn = document.getElementById('imOkBtn');
var keep48Toggle = document.getElementById('keep48Toggle');
var autoSosToggle = document.getElementById('autoSosToggle');
var autoNoMoveMin = document.getElementById('autoNoMoveMin');
var autoHardStopMin = document.getElementById('autoHardStopMin');
var geofenceToggle = document.getElementById('geofenceToggle');
var geofenceRadius = document.getElementById('geofenceRadius');
var adminTargetSelect = document.getElementById('adminTargetSelect');
var adminApplyBtn = document.getElementById('adminApplyBtn');
var checkInToggle = document.getElementById('checkInToggle');
var checkInIntervalMin = document.getElementById('checkInIntervalMin');
var checkInOverdueMin = document.getElementById('checkInOverdueMin');
var keepForeverToggle = document.getElementById('keepForeverToggle');
var statusBanner = document.getElementById('statusBanner');
var statusText = document.getElementById('statusText');
var statusActions = document.getElementById('statusActions');
var alertOverlay = document.getElementById('alertOverlay');
var alertTitle = document.getElementById('alertTitle');
var alertBody = document.getElementById('alertBody');
var alertActions = document.getElementById('alertActions');
var loadingOverlay = document.getElementById('loadingOverlay');

var AUTH_DISPLAY_NAME = document.body.dataset.displayName || '';
var AUTH_USER_ID = document.body.dataset.userId || '';
var IS_ADMIN = (document.body.dataset.role || '') === 'admin';

function setBanner(type, text, actions) {
    statusBanner.classList.remove('sos', 'info', 'active');
    statusActions.innerHTML = '';
    if (!text) return;
    statusBanner.classList.add('active');
    statusBanner.classList.add(type === 'sos' ? 'sos' : 'info');
    statusText.textContent = text;
    (actions || []).forEach(function(a) {
        var b = document.createElement('button');
        b.className = 'btn ' + (a.kind || 'btn-muted');
        b.textContent = a.label;
        b.addEventListener('click', a.onClick);
        statusActions.appendChild(b);
    });
}

var enableAlertsOverlay = document.getElementById('enableAlertsOverlay');
var enableAlertsBtn = document.getElementById('enableAlertsBtn');
var skipAlertsBtn = document.getElementById('skipAlertsBtn');
var alertsSettingsBtn = document.getElementById('alertsSettingsBtn');
var infoPanelBtn = document.getElementById('infoPanelBtn');
var adminPanelBtn = document.getElementById('adminPanelBtn');
var usersPanelBtn = document.getElementById('usersPanelBtn');
var infoPanel = document.getElementById('infoPanel');
var usersPanel = document.getElementById('usersPanel');
var adminPanel = document.getElementById('adminPanel');

var userInteracted = (localStorage.getItem('alertsEnabled') === '1');
var pendingAlarmMs = 0;
function hideEnableAlerts() { if (enableAlertsOverlay) enableAlertsOverlay.classList.remove('active'); }
function showEnableAlerts() { if (enableAlertsOverlay) enableAlertsOverlay.classList.add('active'); }
function unlockAudioOnce() {
    try {
        var AudioCtx = window.AudioContext || window.webkitAudioContext;
        var ctx = new AudioCtx();
        if (ctx.state === 'suspended') ctx.resume();
        var o = ctx.createOscillator();
        var g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = 880; g.gain.value = 0.05;
        o.connect(g); g.connect(ctx.destination);
        o.start(); setTimeout(function() { o.stop(); ctx.close(); }, 180);
    } catch (_) {}
    try { if (navigator.vibrate) navigator.vibrate([120]); } catch (_) {}
}

if (!userInteracted) showEnableAlerts();
if (enableAlertsBtn) {
    enableAlertsBtn.addEventListener('click', function() {
        userInteracted = true;
        localStorage.setItem('alertsEnabled', '1');
        unlockAudioOnce();
        hideEnableAlerts();
        if (pendingAlarmMs > 0) { playAlarmForMs(pendingAlarmMs); pendingAlarmMs = 0; }
    });
}

function isSmallScreen() { return window.matchMedia && window.matchMedia('(max-width: 760px)').matches; }

function closeAllPanelsExcept(keep) {
    var sharingPanelEl = document.getElementById('sharingPanel');
    if (keep !== 'info' && infoPanel) { infoPanel.classList.add('ui-hidden'); localStorage.setItem('infoPanelOpen', '0'); updateNavToggle('infoPanelBtn', false); }
    if (keep !== 'users' && usersPanel) { usersPanel.classList.add('ui-hidden'); localStorage.setItem('usersPanelOpen', '0'); updateNavToggle('usersPanelBtn', false); }
    if (keep !== 'sharing' && sharingPanelEl) { sharingPanelEl.classList.add('ui-hidden'); localStorage.setItem('sharingPanelOpen', '0'); updateNavToggle('sharePanelBtn', false); }
}

function updateNavToggle(btnId, active) {
    var btn = document.getElementById(btnId);
    if (btn) btn.classList.toggle('active', active);
}

function setInfoPanelActive(active) {
    if (!infoPanel) return;
    if (active) closeAllPanelsExcept('info');
    infoPanel.classList.toggle('ui-hidden', !active);
    localStorage.setItem('infoPanelOpen', active ? '1' : '0');
    updateNavToggle('infoPanelBtn', active);
}

function setAdminPanelOpen(open) {
    if (!adminPanel) return;
    adminPanel.classList.toggle('collapsed', !open);
    localStorage.setItem('adminPanelOpen', open ? '1' : '0');
}

function setUsersPanelOpen(open) {
    if (!usersPanel) return;
    if (open) closeAllPanelsExcept('users');
    usersPanel.classList.toggle('ui-hidden', !open);
    localStorage.setItem('usersPanelOpen', open ? '1' : '0');
    updateNavToggle('usersPanelBtn', open);
}

// On load: restore panel state but ensure only one is visible
(function initPanels() {
    var infoOpen = localStorage.getItem('infoPanelOpen');
    var usersOpen = localStorage.getItem('usersPanelOpen');
    var sharingOpen = localStorage.getItem('sharingPanelOpen');
    // Default: info panel open on first visit
    if (infoOpen === null && usersOpen === null && sharingOpen === null) {
        infoOpen = '1';
    }
    // Set panels directly without triggering closeAllPanelsExcept
    if (infoPanel) { infoPanel.classList.toggle('ui-hidden', infoOpen !== '1'); updateNavToggle('infoPanelBtn', infoOpen === '1'); }
    if (usersPanel) { usersPanel.classList.toggle('ui-hidden', usersOpen !== '1'); updateNavToggle('usersPanelBtn', usersOpen === '1'); }
})();

if (IS_ADMIN && adminPanel) {
    var admOpen = localStorage.getItem('adminPanelOpen');
    setAdminPanelOpen(admOpen !== '0');
}

if (usersPanelBtn) {
    usersPanelBtn.addEventListener('click', function() {
        var open = !(usersPanel && !usersPanel.classList.contains('ui-hidden'));
        setUsersPanelOpen(open);
    });
}
if (infoPanelBtn) {
    infoPanelBtn.addEventListener('click', function() {
        var isHidden = infoPanel && infoPanel.classList.contains('ui-hidden');
        setInfoPanelActive(isHidden);
    });
}
if (adminPanelBtn) {
    adminPanelBtn.addEventListener('click', function() {
        var isCollapsed = adminPanel && adminPanel.classList.contains('collapsed');
        setAdminPanelOpen(!!isCollapsed);
        if (isCollapsed) setInfoPanelActive(true);
    });
}

// Close buttons inside panels
document.querySelectorAll('.panel-close').forEach(function(btn) {
    btn.addEventListener('click', function() {
        var which = btn.dataset.close;
        if (which === 'info') setInfoPanelActive(false);
        else if (which === 'users') setUsersPanelOpen(false);
        else if (which === 'sharing') {
            var sp = document.getElementById('sharingPanel');
            if (sp) { sp.classList.add('ui-hidden'); localStorage.setItem('sharingPanelOpen', '0'); updateNavToggle('sharePanelBtn', false); }
        }
    });
});

window.addEventListener('resize', function() {
    var usersPref = localStorage.getItem('usersPanelOpen');
    if (usersPref === null) setUsersPanelOpen(!isSmallScreen());
});

if (skipAlertsBtn) {
    skipAlertsBtn.addEventListener('click', function() {
        userInteracted = false;
        localStorage.setItem('alertsEnabled', '0');
        hideEnableAlerts();
    });
}
if (alertsSettingsBtn) {
    alertsSettingsBtn.addEventListener('click', function() { showEnableAlerts(); });
}

var alarmTimer = null;
var alarmStopAt = 0;
var silencedSos = new Set();
var lastOwnSosActive = false;

function stopAlarmLoop() { if (alarmTimer) { clearInterval(alarmTimer); alarmTimer = null; } alarmStopAt = 0; }

function playAlarmOnce() {
    if (!userInteracted) return;
    try {
        var AudioCtx = window.AudioContext || window.webkitAudioContext;
        var ctx = new AudioCtx();
        var o = ctx.createOscillator(); var g = ctx.createGain();
        o.type = 'square'; o.frequency.value = 880; g.gain.value = 0.05;
        o.connect(g); g.connect(ctx.destination);
        o.start(); setTimeout(function() { o.stop(); ctx.close(); }, 800);
    } catch (_) {}
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]); } catch (_) {}
}

function playAlarmForMs(totalMs) {
    stopAlarmLoop();
    if (!userInteracted) { pendingAlarmMs = totalMs || 0; showEnableAlerts(); return; }
    alarmStopAt = Date.now() + (totalMs || 0);
    playAlarmOnce();
    alarmTimer = setInterval(function() {
        if (Date.now() >= alarmStopAt) { stopAlarmLoop(); return; }
        playAlarmOnce();
    }, 1200);
}

function showAlert(title, body, actions, alarmMs) {
    if (!alertOverlay) return;
    alertTitle.textContent = title;
    alertBody.textContent = body || '';
    alertActions.innerHTML = '';
    (actions || []).forEach(function(a) {
        var b = document.createElement('button');
        b.className = 'btn ' + (a.kind || 'btn-muted');
        b.textContent = a.label;
        b.addEventListener('click', a.onClick);
        alertActions.appendChild(b);
    });
    alertOverlay.classList.add('active');
    if (alarmMs) playAlarmForMs(alarmMs);
}

function hideAlert() { if (!alertOverlay) return; alertOverlay.classList.remove('active'); stopAlarmLoop(); }

function deviceType() { var ua = navigator.userAgent || ''; return /Mobi|Android/i.test(ua) ? 'Mobile' : 'Desktop'; }

// ── Profile push (debounced: at most once per 10s) ──────────────────────────
var lastProfilePush = 0;
function pushProfile() {
    var now = Date.now();
    if (now - lastProfilePush < 10000) return;
    lastProfilePush = now;
    pushProfileNow();
}
function pushProfileNow() {
    var batteryPct = null;
    try {
        if (navigator.getBattery) {
            navigator.getBattery().then(function(b) {
                batteryPct = Math.round((b.level || 0) * 100);
                doEmit(batteryPct);
            }).catch(function() { doEmit(null); });
            return;
        }
    } catch (_) {}
    doEmit(null);
    function doEmit(bp) {
        var connectionQuality = 'Unknown';
        try {
            var ping = socket && socket.io && socket.io.engine ? socket.io.engine.ping : null;
            if (typeof ping === 'number') {
                if (ping <= 80) connectionQuality = 'Good';
                else if (ping <= 200) connectionQuality = 'OK';
                else connectionQuality = 'Poor';
            }
        } catch (_) {}
        socket.emit('profileUpdate', { batteryPct: bp, deviceType: deviceType(), connectionQuality: connectionQuality });
    }
}

function getTargetUserById(id) {
    if (id === 'me') return { socketId: mySocketId, userId: myUserId, displayName: myDisplayName, latitude: myLocation && myLocation.latitude, longitude: myLocation && myLocation.longitude };
    return otherUsers.get(id) || null;
}

function currentAutoRuleMinutes() {
    var noMove = autoNoMoveMin ? Number(autoNoMoveMin.value || 0) : 5;
    var hardStop = autoHardStopMin ? Number(autoHardStopMin.value || 0) : 2;
    return {
        noMoveMinutes: Number.isFinite(noMove) && noMove > 0 ? noMove : 5,
        hardStopMinutes: Number.isFinite(hardStop) && hardStop > 0 ? hardStop : 2
    };
}

function populateAdminControlsFromTarget() {
    if (!IS_ADMIN) return;
    var targetId = getSelectedTargetId();
    var target = targetId ? getTargetUserById(targetId) : null;
    if (!target) return;
    if (autoSosToggle && target.autoSos) autoSosToggle.checked = !!target.autoSos.enabled;
    if (autoNoMoveMin && target.autoSos && typeof target.autoSos.noMoveMinutes === 'number') autoNoMoveMin.value = String(target.autoSos.noMoveMinutes);
    if (autoHardStopMin && target.autoSos && typeof target.autoSos.hardStopMinutes === 'number') autoHardStopMin.value = String(target.autoSos.hardStopMinutes);
    if (geofenceToggle && target.geofence) geofenceToggle.checked = !!target.geofence.enabled;
    if (geofenceRadius && target.geofence && typeof target.geofence.radiusM === 'number' && target.geofence.radiusM) geofenceRadius.value = String(target.geofence.radiusM);
    if (checkInToggle && target.checkIn) checkInToggle.checked = !!target.checkIn.enabled;
    if (checkInIntervalMin && target.checkIn && typeof target.checkIn.intervalMinutes === 'number') checkInIntervalMin.value = String(target.checkIn.intervalMinutes);
    if (checkInOverdueMin && target.checkIn && typeof target.checkIn.overdueMinutes === 'number') checkInOverdueMin.value = String(target.checkIn.overdueMinutes);
    if (keepForeverToggle && target.retention) keepForeverToggle.checked = (target.retention.mode === 'forever');
}

function applyAdminSettings() {
    if (!IS_ADMIN) return;
    var targetId = getSelectedTargetId();
    var target = targetId ? getTargetUserById(targetId) : null;
    var socketId = target && target.socketId ? target.socketId : undefined;
    if (autoSosToggle) {
        var mins = currentAutoRuleMinutes();
        socket.emit('setAutoSos', { socketId: socketId, enabled: !!autoSosToggle.checked, noMoveMinutes: mins.noMoveMinutes, hardStopMinutes: mins.hardStopMinutes, geofence: !!(geofenceToggle && geofenceToggle.checked) });
    }
    if (geofenceToggle) {
        var r = geofenceRadius ? Number(geofenceRadius.value || 0) : 0;
        if (!geofenceToggle.checked) {
            socket.emit('setGeofence', { socketId: socketId, enabled: false });
        } else {
            if (!r) { setBanner('info', 'Set a geofence radius (meters) first, then click Apply.', []); geofenceToggle.checked = false; return; }
            var hasTargetLoc = target && typeof target.latitude === 'number' && typeof target.longitude === 'number';
            var hasMyLoc = myLocation && typeof myLocation.latitude === 'number' && typeof myLocation.longitude === 'number';
            if (!hasTargetLoc && !hasMyLoc) { setBanner('info', 'Start Tracking (or select a user with a location) to set geofence center.', []); geofenceToggle.checked = false; socket.emit('setGeofence', { socketId: socketId, enabled: false }); return; }
            var centerLat = hasTargetLoc ? target.latitude : myLocation.latitude;
            var centerLng = hasTargetLoc ? target.longitude : myLocation.longitude;
            socket.emit('setGeofence', { socketId: socketId, enabled: true, centerLat: centerLat, centerLng: centerLng, radiusM: r });
        }
    }
    if (checkInToggle) {
        var intervalMinutes = checkInIntervalMin ? Number(checkInIntervalMin.value || 0) : 5;
        var overdueMinutes = checkInOverdueMin ? Number(checkInOverdueMin.value || 0) : 7;
        socket.emit('setCheckInRules', { socketId: socketId, enabled: !!checkInToggle.checked, intervalMinutes: (Number.isFinite(intervalMinutes) && intervalMinutes > 0) ? intervalMinutes : 5, overdueMinutes: (Number.isFinite(overdueMinutes) && overdueMinutes > 0) ? overdueMinutes : 7 });
    }
    if (keepForeverToggle && socketId) { socket.emit('setRetentionForever', { socketId: socketId, forever: !!keepForeverToggle.checked }); }
    setBanner('info', 'Admin settings applied.', []);
    setTimeout(function() { setBanner(null, null, null); }, 1500);
}

var adminTargetId = 'me';
var adminTargetRefreshScheduled = false;
var lastAdminOptionsKey = '';

function getSelectedTargetId() { if (!IS_ADMIN || !adminTargetSelect) return null; return adminTargetId || 'me'; }

function adminOptionsKey() { var ids = ['me']; otherUsers.forEach(function(u) { ids.push(u.socketId); }); ids.sort(); return ids.join('|'); }

function refreshAdminTargetOptionsNow() {
    if (!IS_ADMIN || !adminTargetSelect) return;
    if (document.activeElement === adminTargetSelect) return;
    var key = adminOptionsKey();
    if (key === lastAdminOptionsKey) return;
    lastAdminOptionsKey = key;
    adminTargetSelect.innerHTML = '';
    var optMe = document.createElement('option');
    optMe.value = 'me'; optMe.textContent = (myDisplayName || 'Me') + ' (me)';
    adminTargetSelect.appendChild(optMe);
    otherUsers.forEach(function(u) {
        var o = document.createElement('option');
        o.value = u.socketId; o.textContent = u.displayName || u.socketId;
        adminTargetSelect.appendChild(o);
    });
    var exists = Array.from(adminTargetSelect.options).some(function(o) { return o.value === adminTargetId; });
    adminTargetSelect.value = exists ? adminTargetId : 'me';
    adminTargetId = adminTargetSelect.value;
}

function refreshAdminTargetOptions() {
    if (!IS_ADMIN || !adminTargetSelect) return;
    if (adminTargetRefreshScheduled) return;
    adminTargetRefreshScheduled = true;
    requestAnimationFrame(function() { adminTargetRefreshScheduled = false; refreshAdminTargetOptionsNow(); });
}

if (adminTargetSelect) {
    adminTargetSelect.addEventListener('change', function() { adminTargetId = adminTargetSelect.value || 'me'; populateAdminControlsFromTarget(); });
    adminTargetSelect.addEventListener('blur', function() { refreshAdminTargetOptionsNow(); });
}

setInterval(function() { if (socket && socket.connected) pushProfile(); }, 10000);

sosBtn.addEventListener('click', function() {
    var active = sosBtn.dataset.active === '1';
    if (!active) socket.emit('triggerSOS', { reason: 'SOS' });
    else socket.emit('cancelSOS');
});

imOkBtn.addEventListener('click', function() {
    socket.emit('checkInAck');
    setBanner('info', 'Check-in sent.', []);
    setTimeout(function() { setBanner(null, null, null); }, 2000);
});

if (keep48Toggle) {
    keep48Toggle.addEventListener('change', function() {
        socket.emit('setRetention', { mode: keep48Toggle.checked ? '48h' : 'default' });
        setBanner('info', keep48Toggle.checked ? 'Will keep your last location for 48h after disconnect.' : 'Your location will be removed on disconnect.', []);
        setTimeout(function() { setBanner(null, null, null); }, 2000);
    });
}

if (adminApplyBtn) adminApplyBtn.addEventListener('click', applyAdminSettings);

var geofenceCircles = new Map();
function upsertGeofenceCircle(user) {
    if (!IS_ADMIN || !user || !user.socketId) return;
    var enabled = user.geofence && user.geofence.enabled;
    var cLat = enabled ? user.geofence.centerLat : null;
    var cLng = enabled ? user.geofence.centerLng : null;
    var r = enabled ? Number(user.geofence.radiusM || 0) : 0;
    var key = user.socketId;
    var existing = geofenceCircles.get(key);
    if (!enabled || typeof cLat !== 'number' || typeof cLng !== 'number' || !(r > 0)) {
        if (existing) { map.removeLayer(existing); geofenceCircles.delete(key); }
        return;
    }
    if (!existing) {
        var circle = L.circle([cLat, cLng], { radius: r, color: '#9C27B0', weight: 2, fillColor: '#9C27B0', fillOpacity: 0.08 });
        circle.addTo(map); geofenceCircles.set(key, circle);
    } else {
        existing.setLatLng([cLat, cLng]); existing.setRadius(r);
    }
}

clearSelectionButton.addEventListener('click', function(e) { e.stopPropagation(); clearSelectedUsers(); });

trackButton.addEventListener('click', function() {
    if (!tracking) { startTracking(); trackButton.classList.add('tracking'); trackButton.title = 'Stop Tracking'; tracking = true; }
    else { stopTracking(); trackButton.classList.remove('tracking'); trackButton.title = 'Start Tracking'; tracking = false; }
});

resetButton.addEventListener('click', function() { resetTracking(); });

map.on('click', function(e) {
    var clickedLat = e.latlng.lat;
    var clickedLng = e.latlng.lng;
    var posName = 'Position (' + formatCoordinate(clickedLat) + ', ' + formatCoordinate(clickedLng) + ')';
    var clickId = 'click-' + Date.now();
    handleUserSelection(clickId, posName, { latitude: clickedLat, longitude: clickedLng });
    var isSelected = selectedUsers.some(function(u) { return u.id === clickId; });
    if (isSelected) {
        var clickMarker = L.marker([clickedLat, clickedLng], { icon: createMapIcon('#9C27B0', '') }).addTo(map);
        otherUserMarkers.set(clickId, clickMarker);
        clickMarker.bindPopup('<div class="user-popup"><h4>Clicked Position</h4><p>Lat: ' + formatCoordinate(clickedLat) + '</p><p>Lng: ' + formatCoordinate(clickedLng) + '</p></div>');
        clickMarker.on('mouseover', function() { clickMarker.openPopup(); });
        clickMarker.on('mouseout', function() { clickMarker.closePopup(); });
        clickMarker.openPopup();
    }
});

function startTracking() {
    if (navigator.geolocation) {
        watchId = navigator.geolocation.watchPosition(handlePosition, handleError, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
    } else {
        setBanner('info', 'Geolocation is not supported by this browser.', []);
    }
}

function stopTracking() {
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
}

function resetTracking() {
    positions = []; timestamps = []; totalDistance = 0;
    distanceElement.textContent = '0';
    if (marker) { map.removeLayer(marker); marker = null; }
    if (path) { map.removeLayer(path); path = null; }
    otherUserMarkers.forEach(function(m, id) { if (id.startsWith('click-')) { map.removeLayer(m); otherUserMarkers.delete(id); } });
    map.setView([0, 0], 2);
    if (tracking) { stopTracking(); trackButton.classList.remove('tracking'); trackButton.title = 'Start Tracking'; tracking = false; }
    clearSelectedUsers();
}

function handlePosition(position) {
    var latitude = position.coords.latitude;
    var longitude = position.coords.longitude;
    var speed = position.coords.speed ? (position.coords.speed * 3.6).toFixed(1) : '0';
    var timestamp = new Date().toLocaleTimeString();
    var currentTime = Date.now();
    myLocation = { latitude: latitude, longitude: longitude };
    latElement.textContent = formatCoordinate(latitude);
    lngElement.textContent = formatCoordinate(longitude);
    speedElement.textContent = speed;
    timestampElement.textContent = timestamp;
    if (positions.length > 0) {
        var prev = positions[positions.length - 1];
        var distance = calculateDistance(prev[0], prev[1], latitude, longitude);
        totalDistance += distance;
        distanceElement.textContent = Math.round(totalDistance);
    }
    updateMap(latitude, longitude);
    positions.push([latitude, longitude]);
    timestamps.push(currentTime);
    socket.emit('position', { latitude: latitude, longitude: longitude, speed: speed, timestamp: currentTime, formattedTime: timestamp });
    updateDistanceBetweenSelectedUsers(false);
    pushProfile();
}

function handleError(error) {
    if (error.code === error.PERMISSION_DENIED) {
        setBanner('info', 'Location access denied. Please enable location permissions in your browser settings.', []);
    } else if (tracking) {
        var errorMessage = document.createElement('div');
        errorMessage.className = 'location-error';
        errorMessage.textContent = 'Location temporarily unavailable. Retrying...';
        errorMessage.style.color = '#f44336'; errorMessage.style.padding = '5px 0'; errorMessage.style.fontSize = '0.9em';
        var locationInfo = latElement.closest('p');
        if (locationInfo && !document.querySelector('.location-error')) {
            locationInfo.parentNode.insertBefore(errorMessage, locationInfo);
            setTimeout(function() { if (errorMessage.parentNode) errorMessage.parentNode.removeChild(errorMessage); }, 5000);
        }
    }
}

function updateMap(lat, lng) {
    var newLatLng = [lat, lng];
    if (!marker) {
        marker = L.marker(newLatLng).addTo(map).bindPopup('<div class="location-popup"><h4>Your Location</h4><p>Lat: ' + formatCoordinate(lat) + '</p><p>Lng: ' + formatCoordinate(lng) + '</p></div>');
        marker.on('mouseover', function() { marker.openPopup(); });
        marker.on('mouseout', function() { marker.closePopup(); });
    } else {
        marker.setLatLng(newLatLng);
        marker.getPopup().setContent('<div class="location-popup"><h4>Your Location</h4><p>Lat: ' + formatCoordinate(lat) + '</p><p>Lng: ' + formatCoordinate(lng) + '</p></div>');
    }
    if (path) map.removeLayer(path);
    if (positions.length > 1) {
        path = L.polyline(positions, { color: 'blue', weight: 3, opacity: 0.7, className: 'tracking-path' }).addTo(map);
    }
    map.setView(newLatLng, 16);
}

function updateOtherUsersList() {
    if (otherUsers.size === 0 && !myLocation) { otherUsersElement.innerHTML = '<p class="no-users">No other users online</p>'; return; }
    otherUsersElement.innerHTML = '';
    if (myLocation) {
        var myItem = document.createElement('div');
        myItem.className = 'user-item'; myItem.dataset.id = 'me'; myItem.dataset.name = myDisplayName || 'You';
        myItem.dataset.lat = String(myLocation.latitude); myItem.dataset.lng = String(myLocation.longitude);
        if (selectedUsers.some(function(u) { return u.id === 'me'; })) myItem.classList.add('selected');
        myItem.innerHTML = '<div class="meta"><strong>' + escHtml(myDisplayName || 'You') + ' (You)</strong><div class="mini">Last update: ' + escHtml(timestampElement.textContent) + '</div></div><div class="actions"><label class="mini" style="display:flex; align-items:center; gap:6px;"><input class="select-checkbox" type="checkbox" data-action="select" ' + (selectedUsers.some(function(u) { return u.id === 'me'; }) ? 'checked' : '') + '>Select</label></div>';
        otherUsersElement.appendChild(myItem);
    }
    otherUsers.forEach(function(user) {
        if (user.socketId !== mySocketId && user.latitude && user.longitude) {
            var userItem = document.createElement('div');
            userItem.className = 'user-item'; userItem.dataset.id = user.socketId; userItem.dataset.name = user.displayName || user.socketId;
            userItem.dataset.lat = String(user.latitude); userItem.dataset.lng = String(user.longitude);
            if (selectedUsers.some(function(s) { return s.id === user.socketId; })) userItem.classList.add('selected');
            var isOffline = (user.online === false);
            var expiresAt = (typeof user.offlineExpiresAt === 'number') ? user.offlineExpiresAt : null;
            var expiresIn = (function() {
                if (!isOffline) return 'Online';
                if (!expiresAt) return 'Offline &bull; kept forever';
                var ms = expiresAt - Date.now(); if (ms <= 0) return 'Offline &bull; expiring soon';
                var mins = Math.floor(ms / 60000); var h = Math.floor(mins / 60); var m = mins % 60;
                if (h <= 0) return 'Offline &bull; expires in ' + m + 'm';
                return 'Offline &bull; expires in ' + h + 'h ' + m + 'm';
            })();
            userItem.innerHTML = '<div class="meta"><strong>' + escHtml(user.displayName) + '</strong><div class="mini">' + expiresIn + '</div><div class="mini">Last update: ' + escHtml(user.formattedTime || formatTimestamp(user.lastUpdate)) + '</div></div><div class="actions"><label class="mini" style="display:flex; align-items:center; gap:6px;"><input class="select-checkbox" type="checkbox" data-action="select" ' + (selectedUsers.some(function(s) { return s.id === user.socketId; }) ? 'checked' : '') + '>Select</label>' + (IS_ADMIN ? '<button class="btn btn-danger small-btn" type="button" data-action="delete" aria-label="Delete user ' + escHtml(user.displayName) + '">Delete</button>' : '') + '</div>';
            otherUsersElement.appendChild(userItem);
        }
    });
    if (otherUsersElement.children.length === 0) {
        otherUsersElement.innerHTML = '<p class="no-users">No other users online</p>';
    } else if (otherUsersElement.children.length === 1 && myLocation) {
        var waitMessage = document.createElement('p');
        waitMessage.className = 'no-users'; waitMessage.textContent = 'Waiting for other users to connect...';
        otherUsersElement.appendChild(waitMessage);
    }
}

function focusOnLocation(id, location) {
    if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') return;
    var latlng = [location.latitude, location.longitude];
    map.setView(latlng, 16);
    if (id === 'me' && marker) { marker.openPopup(); return; }
    if (id === 'me' && !marker) { updateMap(location.latitude, location.longitude); if (marker) marker.openPopup(); return; }
    var m = otherUserMarkers.get(id);
    if (!m) { var u = otherUsers.get(id); if (u && typeof u.latitude === 'number' && typeof u.longitude === 'number') { createOrUpdateUserMarker(u); m = otherUserMarkers.get(id); } }
    if (m) m.openPopup();
}

function handleAdminDeleteFromEventTarget(target) {
    var btn = target && target.closest ? target.closest('button[data-action="delete"]') : null;
    if (!btn) return false;
    var row = btn.closest('.user-item'); if (!row) return true;
    var id = row.dataset.id; var name = row.dataset.name || id;
    if (!id || id === 'me') return true;
    if (!IS_ADMIN) return true;
    if (!confirm('Delete user "' + name + '"? This will disconnect them and remove them from the map.')) return true;
    socket.emit('adminDeleteUser', { socketId: id });
    setBanner('info', 'Deleted ' + name + '.', []);
    setTimeout(function() { setBanner(null, null, null); }, 1500);
    return true;
}

otherUsersElement.addEventListener('click', function(e) { if (handleAdminDeleteFromEventTarget(e.target)) { e.preventDefault(); e.stopPropagation(); } });

otherUsersElement.addEventListener('pointerup', function(e) {
    if (handleAdminDeleteFromEventTarget(e.target)) return;
    var cb = e.target && e.target.matches && e.target.matches('input[data-action="select"]');
    if (cb) return;
    var row = e.target && e.target.closest ? e.target.closest('.user-item') : null; if (!row) return;
    if (e.target && e.target.closest && e.target.closest('.actions')) return;
    var id = row.dataset.id; var lat = parseFloat(row.dataset.lat); var lng = parseFloat(row.dataset.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    focusOnLocation(id, { latitude: lat, longitude: lng });
});

otherUsersElement.addEventListener('change', function(e) {
    var input = e.target;
    if (!input || !input.matches || !input.matches('input[data-action="select"]')) return;
    var row = input.closest('.user-item'); if (!row) return;
    var id = row.dataset.id; var name = row.dataset.name || id;
    var lat = parseFloat(row.dataset.lat); var lng = parseFloat(row.dataset.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { input.checked = false; return; }
    var loc = { latitude: lat, longitude: lng };
    var isSelected = selectedUsers.some(function(s) { return s.id === id; });
    if (input.checked && !isSelected) handleUserSelection(id, name, loc);
    if (!input.checked && isSelected) handleUserSelection(id, name, loc);
});

var userListInteractingUntil = 0;
function markUserListInteracting(ms) { userListInteractingUntil = Math.max(userListInteractingUntil, Date.now() + (ms || 600)); }
otherUsersElement.addEventListener('pointerdown', function(e) {
    if (e.target && e.target.closest && e.target.closest('.actions')) markUserListInteracting(700);
}, true);

var otherUsersListScheduled = false;
function scheduleOtherUsersListUpdate() {
    var waitMs = userListInteractingUntil - Date.now();
    if (waitMs > 0) {
        if (otherUsersListScheduled) return;
        otherUsersListScheduled = true;
        setTimeout(function() { otherUsersListScheduled = false; scheduleOtherUsersListUpdate(); }, waitMs + 20);
        return;
    }
    if (otherUsersListScheduled) return;
    otherUsersListScheduled = true;
    requestAnimationFrame(function() { otherUsersListScheduled = false; updateOtherUsersList(); });
}

function handleUserSelection(id, name, location) {
    var index = selectedUsers.findIndex(function(u) { return u.id === id; });
    if (index !== -1) {
        selectedUsers.splice(index, 1);
        if (id.startsWith('click-')) { var m = otherUserMarkers.get(id); if (m) { map.removeLayer(m); otherUserMarkers.delete(id); } }
    } else {
        if (selectedUsers.length >= 2) {
            var oldestId = selectedUsers[0].id;
            if (oldestId.startsWith('click-')) { var om = otherUserMarkers.get(oldestId); if (om) { map.removeLayer(om); otherUserMarkers.delete(oldestId); } }
            selectedUsers.shift();
        }
        selectedUsers.push({ id: id, name: name, location: location });
    }
    scheduleOtherUsersListUpdate();
    updateDistanceBetweenSelectedUsers(selectedUsers.length === 2);
}

function clearSelectedUsers() {
    selectedUsers.forEach(function(u) { if (u.id.startsWith('click-')) { var m = otherUserMarkers.get(u.id); if (m) { map.removeLayer(m); otherUserMarkers.delete(u.id); } } });
    selectedUsers = [];
    if (distanceLine) { map.removeLayer(distanceLine); distanceLine = null; }
    if (distanceLabel) { map.removeLayer(distanceLabel); distanceLabel = null; }
    distanceDisplay.classList.remove('active');
    scheduleOtherUsersListUpdate();
}

function updateDistanceBetweenSelectedUsers(shouldFitMap) {
    if (distanceLine) { map.removeLayer(distanceLine); distanceLine = null; }
    if (distanceLabel) { map.removeLayer(distanceLabel); distanceLabel = null; }
    distanceDisplay.classList.remove('active');
    if (selectedUsers.length !== 2) return;
    var user1 = selectedUsers[0]; var user2 = selectedUsers[1];
    user1NameElement.textContent = user1.name; user2NameElement.textContent = user2.name;
    var distance = calculateDistance(user1.location.latitude, user1.location.longitude, user2.location.latitude, user2.location.longitude);
    userDistanceElement.textContent = Math.round(distance) + ' m';
    distanceDisplay.classList.add('active');
    distanceLine = L.polyline([[user1.location.latitude, user1.location.longitude], [user2.location.latitude, user2.location.longitude]], { color: '#FF5722', weight: 3, opacity: 0.7, dashArray: '5, 10' }).addTo(map);
    var midpoint = [(user1.location.latitude + user2.location.latitude) / 2, (user1.location.longitude + user2.location.longitude) / 2];
    var labelIcon = L.divIcon({ className: 'distance-label', html: '<div style="background: white; padding: 3px 8px; border-radius: 3px; font-size: 12px; box-shadow: 0 0 3px rgba(0,0,0,0.3);">' + Math.round(distance) + ' m</div>', iconSize: [80, 20], iconAnchor: [40, 10] });
    distanceLabel = L.marker(midpoint, { icon: labelIcon }).addTo(map);
    if (shouldFitMap) {
        var bounds = L.latLngBounds([user1.location.latitude, user1.location.longitude], [user2.location.latitude, user2.location.longitude]);
        map.fitBounds(bounds, { padding: [50, 50], animate: false });
    }
}

function createOrUpdateUserMarker(user) {
    var userLatLng = [user.latitude, user.longitude];
    var userMarker = otherUserMarkers.get(user.socketId);
    var sosActive = !!(user.sos && user.sos.active);
    var autoEnabled = !!(user.autoSos && user.autoSos.enabled);
    var isOffline = (user.online === false);
    var markerColor = sosActive ? '#F44336' : (isOffline ? '#9E9E9E' : (autoEnabled ? '#2196F3' : '#FF5722'));
    var markerText = sosActive ? '' : (autoEnabled ? 'A' : '');
    if (!userMarker) {
        userMarker = L.marker(userLatLng, { icon: createMapIcon(markerColor, markerText, { pulse: sosActive }) }).addTo(map);
        otherUserMarkers.set(user.socketId, userMarker);
    } else {
        userMarker.setLatLng(userLatLng); userMarker.setIcon(createMapIcon(markerColor, markerText, { pulse: sosActive }));
    }
    userMarker.bindPopup('<div class="user-popup"><h4>' + escHtml(user.displayName) + '</h4><p>Status: ' + (isOffline ? 'Offline' : 'Online') + '</p><p>Lat: ' + formatCoordinate(user.latitude) + '</p><p>Lng: ' + formatCoordinate(user.longitude) + '</p><p>Speed: ' + escHtml(String(user.speed || '0')) + ' km/h</p><p>Updated: ' + escHtml(user.formattedTime || formatTimestamp(user.lastUpdate)) + '</p><p>Battery: ' + (typeof user.batteryPct === 'number' ? user.batteryPct + '%' : '-') + '</p><p>Device: ' + escHtml(user.deviceType || '-') + '</p><p>Connection: ' + escHtml(user.connectionQuality || '-') + '</p><p>Last seen: ' + (user.lastUpdate ? formatTimestamp(user.lastUpdate) : '-') + '</p>' + (user.sos && user.sos.active ? '<p style="color:#F44336; font-weight:700;">SOS: ' + escHtml(user.sos.reason || 'SOS') + '</p>' : '') + '</div>');
    userMarker.on('mouseover', function() { userMarker.openPopup(); });
    userMarker.on('mouseout', function() { userMarker.closePopup(); });
}

// ── Socket events ───────────────────────────────────────────────────────────

socket.on('connect', function() {
    mySocketId = socket.id;
    if (DEBUG) console.log('Connected to server with ID:', mySocketId);
    myDisplayName = AUTH_DISPLAY_NAME || ('User-' + Math.floor(Math.random() * 10000));
    myUserId = AUTH_USER_ID || '';
    scheduleOtherUsersListUpdate();
    pushProfileNow();
    lastProfilePush = Date.now();
    refreshAdminTargetOptions();
    populateAdminControlsFromTarget();
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
});

socket.on('disconnect', function() {
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
});

socket.on('sosUpdate', function(s) {
    if (!s) return;
    var isMe = s.socketId === mySocketId;
    var isGeofence = s.type === 'geofence';
    if (isGeofence && !IS_ADMIN && !isMe) return;
    var ackList = (IS_ADMIN || isMe) && Array.isArray(s.acks) ? s.acks.map(function(a) { return a.by; }).filter(Boolean) : [];
    var ackCount = typeof s.ackCount === 'number' ? s.ackCount : ackList.length;
    var ackText = (IS_ADMIN || isMe)
        ? (ackList.length ? 'Acknowledged by ' + ackList.join(', ') : 'Not acknowledged')
        : (ackCount ? 'Acknowledged (' + ackCount + ')' : 'Not acknowledged');
    if (isMe) {
        sosBtn.dataset.active = s.active ? '1' : '0';
        sosBtn.textContent = s.active ? 'Cancel SOS' : 'SOS';
        if (s.active && s.token) {
            var link = window.location.origin + '/watch/' + s.token;
            setBanner('sos', 'Your SOS is active: ' + (s.reason || 'SOS'), [
                { label: 'Copy watch link', kind: 'btn-muted', onClick: function() { try { navigator.clipboard.writeText(link); } catch(_) {} } }
            ]);
            var justActivated = !lastOwnSosActive && !!s.active;
            lastOwnSosActive = true;
            if (justActivated) playAlarmOnce();
            if (ackCount > 0) stopAlarmLoop();
            showAlert('SOS ACTIVE', (s.reason || 'SOS') + ' \u2022 ' + ackText, [{ label: 'Close', kind: 'btn-muted', onClick: hideAlert }], 0);
        } else if (!s.active) {
            setBanner(null, null, null); hideAlert(); lastOwnSosActive = false;
        }
    } else if (s.active) {
        var from = (otherUsers.get(s.socketId) || {}).displayName || s.socketId;
        var msg = (s.type === 'geofence' ? 'GEOFENCE BREACH' : 'SOS') + ' from ' + from + ': ' + (s.reason || 'SOS') + ' \u2022 ' + ackText;
        setBanner('sos', msg, [
            { label: 'Acknowledge', kind: 'btn-primary', onClick: function() { silencedSos.add(s.socketId); socket.emit('ackSOS', { socketId: s.socketId }); hideAlert(); stopAlarmLoop(); } },
            { label: 'Dismiss', kind: 'btn-muted', onClick: function() { setBanner(null, null, null); } }
        ]);
        var alarmMs = s.type === 'geofence' ? 7000 : (s.type === 'auto' ? 7000 : 10000);
        var shouldAlarm = !silencedSos.has(s.socketId) && ackCount === 0;
        showAlert(s.type === 'geofence' ? 'GEOFENCE BREACH' : 'SOS ALERT', msg, [
            { label: 'Acknowledge', kind: 'btn-primary', onClick: function() { silencedSos.add(s.socketId); socket.emit('ackSOS', { socketId: s.socketId }); hideAlert(); stopAlarmLoop(); } },
            { label: 'Dismiss', kind: 'btn-muted', onClick: hideAlert }
        ], shouldAlarm ? alarmMs : 0);
    }
});

socket.on('checkInRequest', function() {
    showAlert('CHECK-IN REQUIRED', "Tap \"I'm OK\" to confirm you are safe. If you don't, admin will be alerted.", [
        { label: "I'm OK", kind: 'btn-primary', onClick: function() { imOkBtn.click(); hideAlert(); } },
        { label: 'Later', kind: 'btn-muted', onClick: hideAlert }
    ], 5000);
    setBanner('info', "Check-in requested. Tap \"I'm OK\".", [
        { label: "I'm OK", kind: 'btn-primary', onClick: function() { imOkBtn.click(); } }
    ]);
});

socket.on('checkInUpdate', function(data) {
    if (!data) return;
    if (data.socketId === mySocketId) return;
    var u = otherUsers.get(data.socketId);
    if (u && u.checkIn) { u.checkIn.lastCheckInAt = data.lastCheckInAt; scheduleOtherUsersListUpdate(); }
});

socket.on('checkInMissed', function(p) {
    if (!p || p.socketId === mySocketId) return;
    setBanner('sos', 'Missed check-in: ' + (p.displayName || p.socketId), [
        { label: 'Acknowledge SOS', kind: 'btn-primary', onClick: function() { socket.emit('ackSOS', { socketId: p.socketId }); } }
    ]);
});

socket.on('existingUsers', function(users) {
    if (DEBUG) console.log('Received existing users:', users);
    users.forEach(function(user) {
        if (user.socketId === mySocketId) { if (keep48Toggle && user.retention) keep48Toggle.checked = (user.retention.mode === '48h'); return; }
        otherUsers.set(user.socketId, user);
        if (user.latitude && user.longitude) createOrUpdateUserMarker(user);
        upsertGeofenceCircle(user);
    });
    scheduleOtherUsersListUpdate();
    refreshAdminTargetOptions();
    populateAdminControlsFromTarget();
});

socket.on('userConnected', function(user) {
    if (DEBUG) console.log('New user connected:', user);
    if (user.socketId !== mySocketId) { otherUsers.set(user.socketId, user); scheduleOtherUsersListUpdate(); refreshAdminTargetOptions(); }
});

socket.on('userUpdate', function(user) {
    if (DEBUG) console.log('User updated:', user);
    if (user.socketId === mySocketId) { if (keep48Toggle && user.retention) keep48Toggle.checked = (user.retention.mode === '48h'); return; }
    otherUsers.set(user.socketId, user);
    if (user.latitude && user.longitude) createOrUpdateUserMarker(user);
    upsertGeofenceCircle(user);
    scheduleOtherUsersListUpdate();
    refreshAdminTargetOptions();
    var selectedIndex = selectedUsers.findIndex(function(u) { return u.id === user.socketId; });
    if (selectedIndex !== -1) {
        selectedUsers[selectedIndex].location = { latitude: user.latitude, longitude: user.longitude };
        updateDistanceBetweenSelectedUsers(false);
    }
});

socket.on('userDisconnect', function(socketId) {
    if (DEBUG) console.log('User disconnected:', socketId);
    otherUsers.delete(socketId);
    var m = otherUserMarkers.get(socketId); if (m) { map.removeLayer(m); otherUserMarkers.delete(socketId); }
    var c = geofenceCircles.get(socketId); if (c) { map.removeLayer(c); geofenceCircles.delete(socketId); }
    var si = selectedUsers.findIndex(function(u) { return u.id === socketId; });
    if (si !== -1) { selectedUsers.splice(si, 1); updateDistanceBetweenSelectedUsers(false); }
    scheduleOtherUsersListUpdate();
    refreshAdminTargetOptions();
});

socket.on('userOffline', function(user) {
    if (!user || user.socketId === mySocketId) return;
    otherUsers.set(user.socketId, user);
    if (user.latitude && user.longitude) createOrUpdateUserMarker(user);
    upsertGeofenceCircle(user);
    scheduleOtherUsersListUpdate();
    refreshAdminTargetOptions();
});

if (!navigator.geolocation) { setBanner('info', 'Geolocation is not supported by your browser.', []); trackButton.disabled = true; }

navigator.geolocation.getCurrentPosition(
    function(position) { map.setView([position.coords.latitude, position.coords.longitude], 16); },
    function(error) { if (error.code === error.PERMISSION_DENIED) setBanner('info', 'Location access denied. Enable permissions in browser settings.', []); },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
);

// ── Sharing Panel ───────────────────────────────────────────────────────────
(function() {
    var sharePanelBtn = document.getElementById('sharePanelBtn');
    var sharingPanel = document.getElementById('sharingPanel');
    var myShareCodeEl = document.getElementById('myShareCode');
    var copyShareCodeBtn = document.getElementById('copyShareCodeBtn');
    var roomsList = document.getElementById('roomsList');
    var roomNameInput = document.getElementById('roomNameInput');
    var joinRoomInput = document.getElementById('joinRoomInput');
    var createRoomBtn = document.getElementById('createRoomBtn');
    var joinRoomBtn = document.getElementById('joinRoomBtn');
    var contactsList = document.getElementById('contactsList');
    var addContactInput = document.getElementById('addContactInput');
    var addContactBtn = document.getElementById('addContactBtn');
    var addContactByValueInput = document.getElementById('addContactByValueInput');
    var addContactByValueBtn = document.getElementById('addContactByValueBtn');
    var myContactInfoEl = document.getElementById('myContactInfo');
    var liveLinksList = document.getElementById('liveLinksList');
    var sharingOnboarding = document.getElementById('sharingOnboarding');

    function isSmall() { return window.innerWidth < 768; }
    function setSharingOpen(open) {
        if (!sharingPanel) return;
        if (open && typeof closeAllPanelsExcept === 'function') closeAllPanelsExcept('sharing');
        sharingPanel.classList.toggle('ui-hidden', !open);
        localStorage.setItem('sharingPanelOpen', open ? '1' : '0');
        if (typeof updateNavToggle === 'function') updateNavToggle('sharePanelBtn', open);
    }
    if (sharePanelBtn) sharePanelBtn.addEventListener('click', function() { var isHidden = sharingPanel && sharingPanel.classList.contains('ui-hidden'); setSharingOpen(isHidden); });
    var sharingOpen = localStorage.getItem('sharingPanelOpen');
    setSharingOpen(sharingOpen === '1');
    if (copyShareCodeBtn) copyShareCodeBtn.addEventListener('click', function() { navigator.clipboard.writeText(myShareCodeEl.textContent).catch(function(){}); setBanner('info', 'Share code copied!', []); setTimeout(function() { setBanner(null, null, null); }, 1500); });
    if (createRoomBtn) createRoomBtn.addEventListener('click', function() { var name = roomNameInput.value.trim(); socket.emit('createRoom', { name: name }); roomNameInput.value = ''; });
    if (joinRoomBtn) joinRoomBtn.addEventListener('click', function() { var code = joinRoomInput.value.trim().toUpperCase(); if (!code) return; socket.emit('joinRoom', { code: code }); joinRoomInput.value = ''; });
    if (addContactBtn) addContactBtn.addEventListener('click', function() { var code = addContactInput.value.trim().toUpperCase(); if (!code) return; socket.emit('addContact', { shareCode: code }); addContactInput.value = ''; });
    if (addContactByValueBtn) addContactByValueBtn.addEventListener('click', function() { var val = addContactByValueInput.value.trim(); if (!val) return; socket.emit('addContact', { contactValue: val }); addContactByValueInput.value = ''; });
    if (addContactByValueInput) addContactByValueInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); if (addContactByValueBtn) addContactByValueBtn.click(); } });
    // Generate Link button + dropdown
    var generateLinkBtn = document.getElementById('generateLinkBtn');
    var linkDropdown = document.getElementById('linkDropdown');
    if (generateLinkBtn && linkDropdown) {
        generateLinkBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            linkDropdown.classList.toggle('ui-hidden');
        });
        linkDropdown.querySelectorAll('.link-option').forEach(function(opt) {
            opt.addEventListener('click', function() {
                var dur = opt.dataset.duration;
                socket.emit('createLiveLink', { duration: dur === 'forever' ? null : dur });
                linkDropdown.classList.add('ui-hidden');
            });
        });
        document.addEventListener('click', function(e) {
            if (!linkDropdown.classList.contains('ui-hidden') && !generateLinkBtn.contains(e.target) && !linkDropdown.contains(e.target)) {
                linkDropdown.classList.add('ui-hidden');
            }
        });
    }

    var myRoomsData = []; var myContactsData = [];
    socket.on('myShareCode', function(data) {
        if (myShareCodeEl && data && data.shareCode) myShareCodeEl.textContent = data.shareCode;
        if (myContactInfoEl && data) {
            var parts = [];
            if (data.email) parts.push('Email: <strong>' + esc(data.email) + '</strong>');
            if (data.mobile) parts.push('Mobile: <strong>' + esc(data.mobile) + '</strong>');
            myContactInfoEl.innerHTML = parts.join(' &middot; ');
        }
    });
    socket.on('myRooms', function(data) {
        myRoomsData = data || [];
        if (!roomsList) return;
        if (myRoomsData.length === 0) { roomsList.innerHTML = '<p class="mini">No rooms yet</p>'; } else {
            roomsList.innerHTML = myRoomsData.map(function(r) {
                var memberNames = (r.members || []).map(function(m) { return typeof m === 'object' ? m.displayName : m; });
                return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(0,0,0,0.06);"><div><strong>' + esc(r.name) + '</strong> <span class="mini">(' + esc(r.code) + ') &middot; ' + memberNames.length + ' members</span></div><button class="btn btn-danger small-btn leave-room-btn" data-code="' + esc(r.code) + '" style="font-size:11px;padding:4px 8px;" aria-label="Leave room ' + esc(r.name) + '">Leave</button></div>';
            }).join('');
            roomsList.querySelectorAll('.leave-room-btn').forEach(function(btn) { btn.addEventListener('click', function() { socket.emit('leaveRoom', { code: btn.dataset.code }); }); });
        }
        updateOnboarding();
    });
    socket.on('myContacts', function(data) {
        myContactsData = data || [];
        if (!contactsList) return;
        if (myContactsData.length === 0) { contactsList.innerHTML = '<p class="mini">No contacts yet</p>'; } else {
            contactsList.innerHTML = myContactsData.map(function(c) {
                var detail = c.maskedEmail || c.maskedMobile || c.shareCode || '';
                return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(0,0,0,0.06);"><div><strong>' + esc(c.displayName) + '</strong> <span class="mini" style="color:#64748b;">' + esc(detail) + '</span></div><button class="btn btn-danger small-btn remove-contact-btn" data-user-id="' + esc(c.userId) + '" style="font-size:11px;padding:4px 8px;" aria-label="Remove contact ' + esc(c.displayName) + '">Remove</button></div>';
            }).join('');
            contactsList.querySelectorAll('.remove-contact-btn').forEach(function(btn) { btn.addEventListener('click', function() { socket.emit('removeContact', { userId: btn.dataset.userId }); }); });
        }
        updateOnboarding();
    });
    socket.on('myLiveLinks', function(links) {
        if (!liveLinksList) return;
        if (!links || links.length === 0) { liveLinksList.innerHTML = '<p class="mini">No active links</p>'; } else {
            liveLinksList.innerHTML = links.map(function(l) {
                var url = window.location.origin + '/live/' + l.token;
                var exp = l.expiresAt ? new Date(l.expiresAt).toLocaleTimeString() : 'Until revoked';
                return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(0,0,0,0.06);gap:6px;"><div style="min-width:0;flex:1;"><div class="mini" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(url) + '</div><div class="mini">Expires: ' + exp + '</div></div><div style="display:flex;gap:4px;flex-shrink:0;"><button class="btn btn-muted small-btn copy-link-btn" data-url="' + esc(url) + '" style="font-size:10px;padding:4px 6px;" aria-label="Copy live link">Copy</button><button class="btn btn-danger small-btn revoke-link-btn" data-token="' + esc(l.token) + '" style="font-size:10px;padding:4px 6px;" aria-label="Revoke live link">Revoke</button></div></div>';
            }).join('');
            liveLinksList.querySelectorAll('.copy-link-btn').forEach(function(btn) { btn.addEventListener('click', function() { navigator.clipboard.writeText(btn.dataset.url).catch(function(){}); setBanner('info', 'Link copied!', []); setTimeout(function() { setBanner(null, null, null); }, 1500); }); });
            liveLinksList.querySelectorAll('.revoke-link-btn').forEach(function(btn) { btn.addEventListener('click', function() { socket.emit('revokeLiveLink', { token: btn.dataset.token }); }); });
        }
    });
    socket.on('roomError', function(data) { setBanner('info', data.message || 'Room error', []); setTimeout(function() { setBanner(null, null, null); }, 2500); });
    socket.on('contactError', function(data) { setBanner('info', data.message || 'Contact error', []); setTimeout(function() { setBanner(null, null, null); }, 2500); });
    socket.on('roomCreated', function(data) { setBanner('info', 'Room "' + data.name + '" created! Code: ' + data.code, []); setTimeout(function() { setBanner(null, null, null); }, 3000); });
    socket.on('roomJoined', function(data) { setBanner('info', 'Joined room "' + data.name + '"', []); setTimeout(function() { setBanner(null, null, null); }, 2000); });
    socket.on('contactAdded', function(data) { setBanner('info', 'Added ' + (data.displayName || 'contact') + ' to contacts', []); setTimeout(function() { setBanner(null, null, null); }, 2000); });
    socket.on('liveLinkCreated', function(data) { var url = window.location.origin + '/live/' + data.token; navigator.clipboard.writeText(url).catch(function(){}); setBanner('info', 'Live link created and copied!', []); setTimeout(function() { setBanner(null, null, null); }, 2500); });

    socket.on('visibilityRefresh', function(users) {
        otherUsers.clear();
        otherUserMarkers.forEach(function(m, id) { if (id !== 'me') map.removeLayer(m); });
        otherUserMarkers.clear();
        geofenceCircles.forEach(function(c) { map.removeLayer(c); }); geofenceCircles.clear();
        (users || []).forEach(function(user) {
            if (user.socketId === mySocketId) return;
            otherUsers.set(user.socketId, user);
            if (user.latitude && user.longitude) createOrUpdateUserMarker(user);
            upsertGeofenceCircle(user);
        });
        scheduleOtherUsersListUpdate();
        refreshAdminTargetOptions();
    });

    function updateOnboarding() { if (!sharingOnboarding) return; sharingOnboarding.style.display = (myRoomsData.length === 0 && myContactsData.length === 0) ? 'block' : 'none'; }
    function esc(str) { var d = document.createElement('div'); d.textContent = str || ''; return d.innerHTML; }
})();
