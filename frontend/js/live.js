(function() {
    var pageData = JSON.parse(document.getElementById('pageData').textContent);
    var tokenData = pageData.token;
    var expiredData = pageData.expired;
    var sharedByData = pageData.sharedBy;

    if (expiredData) return;

    // ─ Elements ─
    var nameOverlay = document.getElementById("nameOverlay");
    var viewerNameInput = document.getElementById("viewerNameInput");
    var startViewingBtn = document.getElementById("startViewingBtn");
    var statusBar = document.getElementById("statusBar");
    var onlineDot = document.getElementById("onlineDot");
    var trackingLabel = document.getElementById("trackingLabel");
    var checkinStatus = document.getElementById("checkinStatus");
    var sosBanner = document.getElementById("sosBanner");
    var sosInfo = document.getElementById("sosInfo");
    var sosAcks = document.getElementById("sosAcks");
    var ackSosBtn = document.getElementById("ackSosBtn");
    var checkinBanner = document.getElementById("checkinBanner");
    var sharedByNameEl = document.getElementById("sharedByName");

    if (sharedByNameEl) sharedByNameEl.textContent = sharedByData || "User";

    // ─ Map ─
    var map = L.map("map").setView([20.5937, 78.9629], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    var marker = null;
    var hasZoomed = false;

    // ─ Audio context ─
    var audioCtx = null;
    function ensureAudio() {
        if (!audioCtx) {
            try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
        }
    }
    function playTone(freq, duration) {
        ensureAudio();
        if (!audioCtx) return;
        try {
            var osc = audioCtx.createOscillator();
            var gain = audioCtx.createGain();
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.frequency.value = freq; gain.gain.value = 0.4;
            osc.start(); osc.stop(audioCtx.currentTime + duration / 1000);
        } catch(e) {}
    }
    function playSosSound() { playTone(880, 300); setTimeout(function() { playTone(660, 300); }, 350); setTimeout(function() { playTone(880, 300); }, 700); }

    // ─ State ─
    var socket = null;
    var viewerName = "";
    var sosActive = false;
    var sosAcked = false;
    var sosAudioInterval = null;
    var lastCheckInData = null;
    var checkinTimerId = null;

    function escHtml(str) {
        var d = document.createElement("div");
        d.textContent = str || "";
        return d.innerHTML;
    }

    function formatTimeAgo(ts) {
        if (!ts) return "N/A";
        var s = Math.round((Date.now() - ts) / 1000);
        if (s < 60) return s + "s ago";
        if (s < 3600) return Math.round(s / 60) + "m ago";
        return Math.round(s / 3600) + "h ago";
    }

    // ─ Start viewing ─
    function startViewing() {
        viewerName = (viewerNameInput.value || "").trim();
        if (!viewerName) { viewerNameInput.style.borderColor = "#ef4444"; return; }
        nameOverlay.classList.add("hidden");
        statusBar.style.display = "flex";
        connect();
    }

    startViewingBtn.addEventListener("click", startViewing);
    viewerNameInput.addEventListener("keydown", function(e) { if (e.key === "Enter") startViewing(); });

    // ─ Socket connection ─
    function connect() {
        socket = io();
        socket.emit("liveJoin", { token: tokenData, viewerName: viewerName });

        socket.on("liveInit", function(data) {
            trackingLabel.textContent = "Tracking " + escHtml(sharedByData);
            if (data.user) {
                updateMarker(data.user);
                onlineDot.classList.remove("offline");
                onlineDot.classList.add("online");
            } else {
                onlineDot.classList.remove("online");
                onlineDot.classList.add("offline");
                trackingLabel.textContent = escHtml(sharedByData) + " (offline)";
            }
            if (data.sos && data.sos.active) {
                showSos(data.sos);
            }
            if (data.checkIn) {
                lastCheckInData = data.checkIn;
                updateCheckInDisplay();
            }
        });

        socket.on("liveUpdate", function(data) {
            if (data.user) {
                updateMarker(data.user);
                onlineDot.classList.remove("offline");
                onlineDot.classList.add("online");
                trackingLabel.textContent = "Tracking " + escHtml(sharedByData);
            }
        });

        socket.on("liveSosUpdate", function(data) {
            if (data.active) {
                showSos(data);
            } else {
                hideSos();
            }
        });

        socket.on("liveCheckInUpdate", function(data) {
            lastCheckInData = data;
            updateCheckInDisplay();
            if (data.lastCheckInAt && Date.now() - data.lastCheckInAt < 5000) {
                showCheckinToast("Checked in - OK", false);
            }
        });

        socket.on("liveExpired", function() {
            statusBar.style.display = "none";
            sosBanner.classList.remove("active");
            nameOverlay.classList.remove("hidden");
            nameOverlay.innerHTML = '<div class="name-card card"><div class="expired-card-icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><h2 style="color:var(--danger-500);">Link Expired</h2><p class="subtitle">This live share link is no longer active.</p></div>';
        });

        socket.on("disconnect", function() {
            onlineDot.classList.remove("online");
            onlineDot.classList.add("offline");
            trackingLabel.textContent = escHtml(sharedByData) + " (reconnecting...)";
        });

        socket.on("connect", function() {
            if (viewerName) socket.emit("liveJoin", { token: tokenData, viewerName: viewerName });
        });
    }

    // ─ Marker ─
    function updateMarker(user) {
        if (typeof user.latitude !== "number" || typeof user.longitude !== "number") return;
        var ll = [user.latitude, user.longitude];
        var popupHtml = '<div class="live-popup">' +
            '<strong>' + escHtml(user.displayName || 'User') + '</strong><br>' +
            'Speed: ' + (user.speed || 0).toFixed(1) + ' km/h<br>' +
            'Updated: ' + escHtml(user.formattedTime || "N/A") +
            (user.batteryPct != null ? '<br>Battery: ' + user.batteryPct + '%' : '') +
            '</div>';
        if (!marker) {
            var icon = (typeof createMapIcon === "function") ? createMapIcon("#6366f1", escHtml(user.displayName || 'User')) : L.divIcon({ html: '<div style="background:#6366f1;color:#fff;padding:4px 8px;border-radius:8px;font-size:12px;">' + escHtml(user.displayName || 'User') + '</div>', className: "" });
            marker = L.marker(ll, { icon: icon }).addTo(map).bindPopup(popupHtml);
        } else {
            marker.setLatLng(ll).setPopupContent(popupHtml);
        }
        if (!hasZoomed) { map.setView(ll, 15); hasZoomed = true; }
    }

    // ─ SOS ─
    function showSos(sosData) {
        sosActive = true;
        sosBanner.classList.add("active");
        sosInfo.textContent = (sosData.reason || "SOS") + (sosData.at ? " - " + formatTimeAgo(sosData.at) : "");
        updateSosAcks(sosData);

        ensureAudio();
        try { navigator.vibrate([300, 100, 300, 100, 300]); } catch(e) {}
        playSosSound();

        if (sosAudioInterval) clearInterval(sosAudioInterval);
        sosAudioInterval = setInterval(function() {
            if (!sosActive || sosAcked) { clearInterval(sosAudioInterval); sosAudioInterval = null; return; }
            playSosSound();
            try { navigator.vibrate([300, 100, 300]); } catch(e) {}
        }, 3000);
    }

    function hideSos() {
        sosActive = false;
        sosAcked = false;
        sosBanner.classList.remove("active");
        if (sosAudioInterval) { clearInterval(sosAudioInterval); sosAudioInterval = null; }
    }

    function updateSosAcks(sosData) {
        var count = sosData.ackCount || (sosData.acks ? sosData.acks.length : 0);
        if (count > 0) {
            var names = (sosData.acks || []).map(function(a) { return a.by || "Unknown"; }).join(", ");
            sosAcks.textContent = count + " acknowledged: " + names;
        } else {
            sosAcks.textContent = "No acknowledgements yet";
        }
        if (sosAcked) {
            ackSosBtn.disabled = true;
            ackSosBtn.textContent = "Acknowledged";
        }
    }

    ackSosBtn.addEventListener("click", function() {
        if (!socket || sosAcked) return;
        sosAcked = true;
        ackSosBtn.disabled = true;
        ackSosBtn.textContent = "Acknowledged";
        socket.emit("liveAckSOS", {});
        if (sosAudioInterval) { clearInterval(sosAudioInterval); sosAudioInterval = null; }
    });

    // ─ Check-in display ─
    function updateCheckInDisplay() {
        if (!lastCheckInData || !lastCheckInData.enabled) {
            checkinStatus.textContent = "";
            return;
        }
        var lastAt = lastCheckInData.lastCheckInAt;
        var overdueMs = (lastCheckInData.overdueMinutes || 7) * 60 * 1000;
        var sinceMs = lastAt ? Date.now() - lastAt : Infinity;

        if (sinceMs > overdueMs) {
            checkinStatus.textContent = "Check-in OVERDUE (" + formatTimeAgo(lastAt) + ")";
            checkinStatus.classList.add("overdue");
            showCheckinToast("Check-in overdue!", true);
        } else {
            checkinStatus.textContent = "Last check-in: " + formatTimeAgo(lastAt);
            checkinStatus.classList.remove("overdue");
        }
    }

    // Update check-in display periodically
    checkinTimerId = setInterval(function() {
        if (lastCheckInData) updateCheckInDisplay();
    }, 30000);

    function showCheckinToast(msg, isOverdue) {
        checkinBanner.textContent = msg;
        checkinBanner.classList.toggle("overdue-banner", !!isOverdue);
        checkinBanner.classList.add("active");
        setTimeout(function() { checkinBanner.classList.remove("active"); }, 5000);
    }
})();
