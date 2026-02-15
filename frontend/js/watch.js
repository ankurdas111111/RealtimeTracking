(function() {
    var pageData = JSON.parse(document.getElementById('pageData').textContent);
    var token = pageData.token;

    var map = L.map('map').setView([0, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    var banner = document.getElementById('watchBanner');
    var socket = io();
    var marker = null;

    function setBanner(sos) {
        if (!sos || !sos.active) {
            banner.style.background = 'rgba(33,150,243,0.95)';
            banner.textContent = 'Watch link is inactive.';
            return;
        }
        var count = typeof sos.ackCount === 'number' ? sos.ackCount : (Array.isArray(sos.acks) ? sos.acks.length : 0);
        var who = count ? 'Acknowledged (' + count + ')' : 'Not yet acknowledged';
        banner.textContent = 'SOS: ' + (sos.reason || 'SOS') + ' • ' + who;
    }

    function update(u) {
        if (!u || typeof u.latitude !== 'number' || typeof u.longitude !== 'number') return;
        var ll = [u.latitude, u.longitude];
        if (!marker) {
            marker = L.marker(ll, { icon: createMapIcon('#F44336', '', { pulse: true }) }).addTo(map);
            marker.on('mouseover', function() { marker.openPopup(); });
            marker.on('mouseout', function() { marker.closePopup(); });
        } else {
            marker.setLatLng(ll);
        }
        function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
        marker.bindPopup(
            '<div class="user-popup">' +
            '<h4>' + esc(u.displayName || 'User') + '</h4>' +
            '<p>Lat: ' + formatCoordinate(u.latitude) + '</p>' +
            '<p>Lng: ' + formatCoordinate(u.longitude) + '</p>' +
            '<p>Speed: ' + esc(String(u.speed || '0')) + ' km/h</p>' +
            '<p>Updated: ' + esc(u.formattedTime || formatTimestamp(u.lastUpdate)) + '</p>' +
            '</div>'
        );
        map.setView(ll, 16);
    }

    socket.on('connect', function() { socket.emit('watchJoin', { token: token }); });
    socket.on('watchInit', function(payload) {
        banner.textContent = 'Connected.';
        update(payload && payload.user);
        setBanner(payload && payload.sos);
    });
    socket.on('watchUpdate', function(payload) {
        update(payload && payload.user);
        setBanner(payload && payload.sos);
    });
})();
