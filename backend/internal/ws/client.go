package ws

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"sync"
	"time"

	"nhooyr.io/websocket"
)

const (
	readLimitBytes   = 32 * 1024
	readDeadline     = 90 * time.Second
	pingInterval     = 25 * time.Second
	sendChannelSize  = 256
	rateLimitWindow  = 60 * time.Second
)

type rateEntry struct {
	count   int
	resetAt int64
}

// Client is a single WebSocket connection with one read goroutine and one write goroutine.
type Client struct {
	hub       *Hub
	conn      *websocket.Conn
	id        string
	userID    string
	role      string
	send      chan []byte
	rateLimits map[string]*rateEntry
	rateMu    sync.Mutex
	liveToken string
	liveViewerName string
	done      chan struct{}
}

// NewClient creates a client with a random hex ID and starts the pumps.
func NewClient(hub *Hub, conn *websocket.Conn, userID, role string) *Client {
	id := generateClientID()
	return &Client{
		hub:       hub,
		conn:      conn,
		id:        id,
		userID:    userID,
		role:      role,
		send:      make(chan []byte, sendChannelSize),
		rateLimits: make(map[string]*rateEntry),
		done:      make(chan struct{}),
	}
}

func generateClientID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// ID returns the client's unique ID.
func (c *Client) ID() string {
	return c.id
}

// UserID returns the authenticated user ID.
func (c *Client) UserID() string {
	return c.userID
}

// Role returns the user's role.
func (c *Client) Role() string {
	return c.role
}

// ReadPump reads messages from the WebSocket, decodes them, and dispatches to the hub.
// Handles ping/pong. Uses 10s read deadline, reset on each message.
func (c *Client) ReadPump(ctx context.Context) {
	defer func() {
		select {
		case c.hub.unregister <- c:
		case <-time.After(5 * time.Second):
			slog.Warn("Unregister channel full, client may leak", "client", c.id)
		}
	}()

	c.conn.SetReadLimit(readLimitBytes)

	for {
		select {
		case <-ctx.Done():
			return
		case <-c.done:
			return
		default:
		}

		ctx, cancel := context.WithTimeout(ctx, readDeadline)
		_, raw, err := c.conn.Read(ctx)
		cancel()
		if err != nil {
			if websocket.CloseStatus(err) != websocket.StatusNormalClosure {
				slog.Debug("WebSocket read error", "client", c.id, "error", err)
			}
			return
		}

		msg, err := DecodeMessage(raw)
		if err != nil {
			slog.Debug("Failed to decode message", "client", c.id, "error", err)
			continue
		}

		select {
		case c.hub.dispatch <- &dispatchMsg{client: c, msg: msg}:
		default:
			slog.Debug("Dispatch channel full, dropping message", "client", c.id, "event", msg.Event)
		}
	}
}

// WritePump reads from the send channel and writes to the WebSocket.
// Sends ping every 25s. Closes connection if write fails.
func (c *Client) WritePump(ctx context.Context) {
	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-c.done:
			return

		case msg, ok := <-c.send:
			if !ok {
				_ = c.conn.Close(websocket.StatusNormalClosure, "channel closed")
				return
			}
			ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := c.conn.Write(ctx, websocket.MessageText, msg)
			cancel()
			if err != nil {
				slog.Debug("WebSocket write error", "client", c.id, "error", err)
				return
			}

		case <-ticker.C:
			ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := c.conn.Ping(ctx)
			cancel()
			if err != nil {
				slog.Debug("WebSocket ping error", "client", c.id, "error", err)
				return
			}
		}
	}
}

// Send encodes a message and puts it on the send channel. Non-blocking; drops if full.
func (c *Client) Send(event string, data interface{}) {
	raw, err := EncodeMessage(event, data)
	if err != nil {
		slog.Debug("Failed to encode message", "client", c.id, "event", event, "error", err)
		return
	}
	select {
	case c.send <- raw:
	default:
		slog.Debug("Send channel full, dropping", "client", c.id, "event", event)
	}
}

// Close closes the done channel and connection.
func (c *Client) Close() {
	select {
	case <-c.done:
		return
	default:
		close(c.done)
		_ = c.conn.Close(websocket.StatusNormalClosure, "client close")
	}
}

// CheckRateLimit returns false if the client has exceeded maxPerMin for this event.
func (c *Client) CheckRateLimit(event string, maxPerMin int) bool {
	c.rateMu.Lock()
	defer c.rateMu.Unlock()

	now := time.Now().Unix()
	entry, ok := c.rateLimits[event]
	if !ok || now >= entry.resetAt {
		c.rateLimits[event] = &rateEntry{count: 1, resetAt: now + int64(rateLimitWindow/time.Second)}
		return true
	}
	if entry.count >= maxPerMin {
		return false
	}
	entry.count++
	return true
}
