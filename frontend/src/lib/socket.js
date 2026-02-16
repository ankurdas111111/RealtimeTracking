import { io } from 'socket.io-client';
import * as msgpackParser from 'socket.io-msgpack-parser';
import { get } from 'svelte/store';
import { otherUsers, mySocketId, myLocation, mySafetyStatus } from './stores/map.js';
import { myRooms, myShareCode, myContactInfo } from './stores/rooms.js';
import { myContacts } from './stores/contacts.js';
import { myGuardianData, canManage, pendingIncomingRequests } from './stores/guardians.js';
import { banner, alertState, myLiveLinks, mySosActive } from './stores/sos.js';
import { adminOverview } from './stores/admin.js';
import { authUser } from './stores/auth.js';
import { drainBuffer, hasBuffered } from './offlineBuffer.js';

const storedClientId = localStorage.getItem('clientId');
const clientId = storedClientId || (crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2));
if (!storedClientId) localStorage.setItem('clientId', clientId);

export const socket = io({ auth: { clientId }, transports: ["websocket"], parser: msgpackParser, autoConnect: false });

let connected = false;
let handlersRegistered = false;

export function setupSocketHandlers() {
  if (handlersRegistered) {
    if (!socket.connected) socket.connect();
    return;
  }
  handlersRegistered = true;
  socket.on('connect', () => {
    connected = true;
    mySocketId.set(socket.id);
    banner.set({ type: null, text: null, actions: [] });
  });

  socket.on('disconnect', (reason) => {
    connected = false;
    if (reason === 'io server disconnect') {
      banner.set({ type: 'info', text: 'Disconnected by server. Reconnecting...', actions: [] });
    } else {
      banner.set({ type: 'info', text: 'Connection lost. Reconnecting...', actions: [] });
    }
  });

  socket.on('connect_error', (err) => {
    const msg = err && err.message ? err.message : 'Connection error';
    if (msg.includes('Authentication') || msg.includes('session') || msg.includes('401') || msg.includes('403')) {
      banner.set({ type: 'sos', text: 'Session expired. Redirecting to login...', actions: [] });
      setTimeout(() => { window.location.hash = '#/login'; }, 2000);
      return;
    }
    banner.set({ type: 'info', text: 'Connection error: ' + msg + '. Retrying...', actions: [] });
  });

  socket.io.on('reconnect', (attempt) => {
    banner.set({ type: 'info', text: 'Reconnected! (attempt ' + attempt + ')', actions: [] });
    setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2000);
    // Drain offline buffer: send buffered positions as a batch
    if (hasBuffered()) {
      const batch = drainBuffer();
      if (batch.length > 0) {
        socket.emit('positionBatch', batch);
      }
    }
  });

  socket.io.on('reconnect_attempt', (attempt) => {
    banner.set({ type: 'info', text: 'Reconnecting... attempt ' + attempt, actions: [] });
  });

  socket.io.on('reconnect_failed', () => {
    banner.set({ type: 'sos', text: 'Unable to reconnect. Please refresh the page.', actions: [
      { label: 'Refresh', kind: 'btn-primary', onClick: () => window.location.reload() }
    ] });
  });

  // User data events
  function extractSafety(u) {
    if (!u) return;
    mySafetyStatus.set({
      geofence: u.geofence || { enabled: false },
      autoSos: u.autoSos || { enabled: false },
      checkIn: u.checkIn || { enabled: false }
    });
  }

  socket.on('existingUsers', (users) => {
    const map = new Map();
    const sid = get(mySocketId);
    (users || []).forEach(u => {
      if (u.socketId === sid) { extractSafety(u); return; }
      map.set(u.socketId, u);
    });
    otherUsers.set(map);
  });

  socket.on('userConnected', (user) => {
    if (user.socketId === get(mySocketId)) return;
    otherUsers.update(m => { m.set(user.socketId, user); return new Map(m); });
  });

  socket.on('userUpdate', (user) => {
    if (user.socketId === get(mySocketId)) { extractSafety(user); return; }
    otherUsers.update(m => { m.set(user.socketId, user); return new Map(m); });
  });

  socket.on('userDisconnect', (socketId) => {
    otherUsers.update(m => { m.delete(socketId); return new Map(m); });
  });

  socket.on('userOffline', (user) => {
    if (!user || user.socketId === get(mySocketId)) return;
    otherUsers.update(m => { m.set(user.socketId, user); return new Map(m); });
  });

  socket.on('visibilityRefresh', (users) => {
    const map = new Map();
    (users || []).forEach(u => {
      if (u.socketId !== get(mySocketId)) map.set(u.socketId, u);
    });
    otherUsers.set(map);
  });

  // Share code + personal info
  socket.on('myShareCode', (data) => {
    if (data && data.shareCode) myShareCode.set(data.shareCode);
    if (data) myContactInfo.set({ email: data.email || '', mobile: data.mobile || '' });
  });

  // Rooms
  socket.on('myRooms', (data) => myRooms.set(data || []));

  // Contacts
  socket.on('myContacts', (data) => myContacts.set(data || []));

  // Live links
  socket.on('myLiveLinks', (links) => myLiveLinks.set(links || []));

  // Guardians
  socket.on('myGuardians', (data) => {
    if (!data) return;
    myGuardianData.set({
      asGuardian: data.asGuardian ?? [],
      asWard: data.asWard ?? [],
      manageable: data.manageable ?? []
    });
    const cm = new Map();
    (data.manageable || []).forEach(m => cm.set(m.userId, m.displayName));
    canManage.set(cm);
  });

  // Persistent pending requests (sent on connect, survives reconnects)
  socket.on('pendingRequests', (data) => {
    if (!Array.isArray(data)) return;
    pendingIncomingRequests.set(data);
  });

  // Guardian/admin request events (real-time notifications)
  socket.on('roomAdminRequest', (data) => {
    if (!data) return;
    pendingIncomingRequests.update(arr => {
      if (arr.some(r => r.type === 'roomAdmin' && r.from === data.fromUserId && r.roomCode === data.roomCode)) return arr;
      return [...arr, { type: 'roomAdmin', from: data.fromUserId, fromName: data.fromName, roomCode: data.roomCode, expiresIn: data.expiresIn, approvals: data.approvals || 0, denials: data.denials || 0, totalEligible: data.totalEligible || 0, myVote: null }];
    });
    banner.set({ type: 'info', text: data.fromName + ' requested Room Admin in ' + data.roomCode + ' — Vote now!', actions: [] });
    setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 3000);
  });

  socket.on('roomAdminVoteUpdate', (data) => {
    if (!data) return;
    if (data.denied) {
      pendingIncomingRequests.update(arr => arr.filter(r => !(r.type === 'roomAdmin' && r.from === data.userId && r.roomCode === data.roomCode)));
      return;
    }
    pendingIncomingRequests.update(arr => arr.map(r => {
      if (r.type === 'roomAdmin' && r.from === data.userId && r.roomCode === data.roomCode) {
        return { ...r, approvals: data.approvals, denials: data.denials, totalEligible: data.totalEligible, myVote: data.myVote };
      }
      return r;
    }));
  });

  socket.on('guardianRequest', (data) => {
    if (!data) return;
    pendingIncomingRequests.update(arr => {
      if (arr.some(r => r.type === 'guardian' && r.from === data.fromUserId)) return arr;
      return [...arr, { type: 'guardian', from: data.fromUserId, fromName: data.fromName, expiresIn: data.expiresIn }];
    });
    banner.set({ type: 'info', text: data.fromName + ' wants to be your guardian', actions: [] });
    setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 3000);
  });

  socket.on('guardianInvite', (data) => {
    if (!data) return;
    pendingIncomingRequests.update(arr => {
      if (arr.some(r => r.type === 'guardianInvite' && r.from === data.fromUserId)) return arr;
      return [...arr, { type: 'guardianInvite', from: data.fromUserId, fromName: data.fromName, expiresIn: data.expiresIn }];
    });
    banner.set({ type: 'info', text: data.fromName + ' wants you to be their guardian', actions: [] });
    setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 3000);
  });

  socket.on('roomAdminUpdated', (data) => {
    if (!data) return;
    // Remove from pending if promoted or denied
    if (data.role === 'admin' || data.role === 'denied') {
      pendingIncomingRequests.update(arr => arr.filter(r => !(r.type === 'roomAdmin' && r.from === data.userId && r.roomCode === data.roomCode)));
    }
    banner.set({ type: 'info', text: 'Room admin role updated in ' + data.roomCode, actions: [] });
    setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2000);
  });

  socket.on('guardianUpdated', (data) => {
    if (!data) return;
    // Remove from pending if approved/denied/revoked
    if (data.status === 'active' || data.status === 'denied' || data.status === 'revoked') {
      pendingIncomingRequests.update(arr => arr.filter(r => {
        if (r.type === 'guardian' && r.from === data.guardianId) return false;
        if (r.type === 'guardianInvite' && r.from === data.wardId) return false;
        return true;
      }));
    }
    const statusMsg = data.status === 'active' ? 'approved' : data.status === 'denied' ? 'denied' : data.status === 'revoked' ? 'revoked' : data.status;
    banner.set({ type: 'info', text: 'Guardian relationship ' + statusMsg, actions: [] });
    setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2000);
  });

  // Room/contact action results
  socket.on('roomError', (data) => {
    banner.set({ type: 'info', text: data?.message || 'Room error', actions: [] });
    setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2500);
  });
  socket.on('contactError', (data) => {
    banner.set({ type: 'info', text: data?.message || 'Contact error', actions: [] });
    setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2500);
  });
  socket.on('roomCreated', (data) => {
    banner.set({ type: 'info', text: `Room "${data.name}" created! Code: ${data.code}`, actions: [] });
    setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 3000);
  });
  socket.on('roomJoined', (data) => {
    banner.set({ type: 'info', text: `Joined room "${data.name}"`, actions: [] });
    setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2000);
  });
  socket.on('roomLeft', (data) => {
    banner.set({ type: 'info', text: `Left room "${data?.name || ''}"`, actions: [] });
    setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2000);
  });
  socket.on('contactAdded', (data) => {
    banner.set({ type: 'info', text: `Added ${data?.displayName || 'contact'} to contacts`, actions: [] });
    setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2000);
  });
  socket.on('contactRemoved', () => {
    banner.set({ type: 'info', text: 'Contact removed', actions: [] });
    setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2000);
  });
  socket.on('liveLinkCreated', (data) => {
    const url = window.location.origin + '/#/live/' + data.token;
    navigator.clipboard.writeText(url).catch(() => {});
    banner.set({ type: 'info', text: 'Live link created and copied!', actions: [] });
    setTimeout(() => banner.set({ type: null, text: null, actions: [] }), 2500);
  });

  // SOS events
  socket.on('sosUpdate', (s) => {
    if (!s) return;
    const isMe = s.socketId === get(mySocketId);
    if (isMe) mySosActive.set(!!s.active);
    if (s.active) {
      const from = isMe ? 'You' : ((get(otherUsers).get(s.socketId) || {}).displayName || s.socketId);
      const reason = s.reason || 'SOS';
      const ackCount = typeof s.ackCount === 'number' ? s.ackCount : (s.acks ? s.acks.length : 0);
      const ackText = ackCount ? `Acknowledged (${ackCount})` : 'Not acknowledged';

      if (isMe) {
        const ackNames = Array.isArray(s.acks) && s.acks.length > 0
          ? s.acks.map(a => a.by || 'Someone').join(', ')
          : null;
        const myText = ackNames
          ? `Your SOS is active: ${reason} — Acknowledged by: ${ackNames}`
          : `Your SOS is active: ${reason} — Not yet acknowledged`;
        banner.set({ type: 'sos', text: myText, actions: [
          { label: 'Copy watch link', kind: 'btn-secondary', onClick: () => { if (s.token) navigator.clipboard.writeText(window.location.origin + '/#/watch/' + s.token).catch(() => {}); } }
        ] });
      } else {
        const isGeofence = s.type === 'geofence';
        const msg = `${isGeofence ? 'GEOFENCE BREACH' : 'SOS'} from ${from}: ${reason} - ${ackText}`;
        banner.set({ type: 'sos', text: msg, actions: [
          { label: 'Acknowledge', kind: 'btn-primary', onClick: () => { socket.emit('ackSOS', { socketId: s.socketId }); } },
          { label: 'Dismiss', kind: 'btn-secondary', onClick: () => banner.set({ type: null, text: null, actions: [] }) }
        ] });
        if (ackCount === 0) {
          alertState.set({
            visible: true,
            title: isGeofence ? 'GEOFENCE BREACH' : 'SOS ALERT',
            body: msg,
            actions: [
              { label: 'Acknowledge', kind: 'btn-primary', onClick: () => socket.emit('ackSOS', { socketId: s.socketId }) }
            ],
            alarmMs: isGeofence ? 7000 : 10000
          });
        }
      }
    } else if (isMe) {
      banner.set({ type: null, text: null, actions: [] });
    }
  });

  socket.on('checkInRequest', () => {
    alertState.set({
      visible: true,
      title: 'CHECK-IN REQUIRED',
      body: "Tap \"I'm OK\" to confirm you are safe.",
      actions: [
        { label: "I'm OK", kind: 'btn-primary', onClick: () => socket.emit('checkInAck') }
      ],
      alarmMs: 5000
    });
    banner.set({ type: 'info', text: "Check-in requested. Tap \"I'm OK\".", actions: [
      { label: "I'm OK", kind: 'btn-primary', onClick: () => socket.emit('checkInAck') }
    ] });
  });

  socket.on('checkInMissed', (p) => {
    if (!p) return;
    banner.set({ type: 'sos', text: 'Missed check-in: ' + (p.displayName || p.socketId), actions: [
      { label: 'Acknowledge SOS', kind: 'btn-primary', onClick: () => socket.emit('ackSOS', { socketId: p.socketId }) }
    ] });
  });

  socket.on('checkInUpdate', (data) => {
    if (!data) return;
    const sid = data.socketId;
    if (sid === get(mySocketId)) return;
    otherUsers.update(m => {
      const u = m.get(sid);
      if (u && u.checkIn) { u.checkIn.lastCheckInAt = data.lastCheckInAt; }
      return new Map(m);
    });
  });

  // Admin overview
  socket.on('adminOverview', (data) => { if (data) adminOverview.set(data); });

  // All handlers registered -- now connect
  socket.connect();
}

export function isConnected() { return connected; }
