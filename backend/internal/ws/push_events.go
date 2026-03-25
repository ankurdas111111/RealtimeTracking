package ws

import (
	"encoding/json"
	"log/slog"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// handleGetVapidKey returns the VAPID public key to the requesting client.
// If VAPID keys are not configured, returns ok:false so the frontend can
// gracefully show "push not configured".
func (h *Hub) handleGetVapidKey(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("getVapidKey", 20) {
		return
	}
	if h.config.VAPIDPublicKey == "" {
		c.Send("vapidKey", map[string]interface{}{"ok": false, "key": ""})
		return
	}
	c.Send("vapidKey", map[string]interface{}{"ok": true, "key": h.config.VAPIDPublicKey})
}

// handlePushSubscribe stores a Web Push subscription for the authenticated user.
func (h *Hub) handlePushSubscribe(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("pushSubscribe", 10) {
		return
	}
	if h.config.VAPIDPublicKey == "" || h.config.VAPIDPrivateKey == "" {
		c.Send("pushSubscribeAck", map[string]interface{}{"ok": false, "error": "Push not configured on server"})
		return
	}
	user := h.Cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	m := toMap(data)
	if m == nil {
		return
	}
	endpoint, _ := m["endpoint"].(string)
	if endpoint == "" {
		c.Send("pushSubscribeAck", map[string]interface{}{"ok": false, "error": "Missing endpoint"})
		return
	}
	keys, _ := m["keys"].(map[string]interface{})
	p256dh, _ := keys["p256dh"].(string)
	auth, _ := keys["auth"].(string)
	if p256dh == "" || auth == "" {
		c.Send("pushSubscribeAck", map[string]interface{}{"ok": false, "error": "Missing subscription keys"})
		return
	}
	h.Cache.AddPushSubscription(user.UserID, endpoint, p256dh, auth)
	slog.Debug("Push subscription stored", "userId", user.UserID)
	c.Send("pushSubscribeAck", map[string]interface{}{"ok": true})
}

// handlePushUnsubscribe removes a Web Push subscription by endpoint.
func (h *Hub) handlePushUnsubscribe(c *Client, data json.RawMessage) {
	if !c.CheckRateLimit("pushUnsubscribe", 10) {
		return
	}
	user := h.Cache.GetActiveUser(c.ID())
	if user == nil {
		return
	}
	m := toMap(data)
	if m == nil {
		return
	}
	endpoint, _ := m["endpoint"].(string)
	if endpoint == "" {
		return
	}
	h.Cache.RemovePushSubscription(user.UserID, endpoint)
	c.Send("pushUnsubscribeAck", map[string]interface{}{"ok": true})
}

// SendPushToUser sends a push notification to all subscriptions for a user.
// Silently removes expired/invalid subscriptions (HTTP 410 Gone).
func (h *Hub) SendPushToUser(userID, title, body string) {
	if h.config.VAPIDPublicKey == "" || h.config.VAPIDPrivateKey == "" {
		return
	}
	subs := h.Cache.GetPushSubscriptions(userID)
	if len(subs) == 0 {
		return
	}
	subject := h.config.VAPIDSubject
	if subject == "" {
		subject = "mailto:admin@kinnect.app"
	}
	payload, _ := json.Marshal(map[string]string{"title": title, "body": body})
	var expired []string
	for _, sub := range subs {
		s := &webpush.Subscription{
			Endpoint: sub.Endpoint,
			Keys: webpush.Keys{
				P256dh: sub.P256dh,
				Auth:   sub.Auth,
			},
		}
		resp, err := webpush.SendNotification(payload, s, &webpush.Options{
			VAPIDPublicKey:  h.config.VAPIDPublicKey,
			VAPIDPrivateKey: h.config.VAPIDPrivateKey,
			Subscriber:      subject,
			TTL:             60,
		})
		if err != nil {
			slog.Warn("Push send error", "userId", userID, "error", err)
			continue
		}
		resp.Body.Close()
		if resp.StatusCode == 410 || resp.StatusCode == 404 {
			expired = append(expired, sub.Endpoint)
		}
	}
	for _, ep := range expired {
		h.Cache.RemovePushSubscription(userID, ep)
	}
}

// SendPushToUsers sends a push notification to multiple users.
func (h *Hub) SendPushToUsers(userIDs []string, title, body string) {
	for _, uid := range userIDs {
		h.SendPushToUser(uid, title, body)
	}
}
