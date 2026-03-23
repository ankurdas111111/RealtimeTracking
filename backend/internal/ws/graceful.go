package ws

import (
	"context"
	"log/slog"
	"time"
)

// Shutdown gracefully shuts down the Hub:
// 1. Sends serverShutdown to all clients
// 2. Waits up to ctx deadline for clients to disconnect
// 3. Force closes remaining connections
// 4. Flushes position buffer and pending broadcasts
func (h *Hub) Shutdown(ctx context.Context) {
	h.mu.Lock()
	clientIDs := make([]string, 0, len(h.clients))
	for id := range h.clients {
		clientIDs = append(clientIDs, id)
	}
	h.mu.Unlock()

	if len(clientIDs) == 0 {
		h.flushOnShutdown()
		return
	}

	// Send serverShutdown to all clients
	for _, id := range clientIDs {
		if c := h.GetClient(id); c != nil {
			c.Send("serverShutdown", map[string]interface{}{"message": "Server is shutting down"})
		}
	}

	// Wait for clients to disconnect, with periodic checks
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		if h.ClientCount() == 0 {
			break
		}
		select {
		case <-ctx.Done():
			slog.Warn("Shutdown deadline reached, force closing remaining clients", "count", h.ClientCount())
			h.forceCloseAll()
			h.flushOnShutdown()
			return
		case <-ticker.C:
			// continue looping
		}
	}

	h.flushOnShutdown()
	slog.Info("Hub shutdown complete")
}

func (h *Hub) forceCloseAll() {
	h.mu.Lock()
	clientIDs := make([]string, 0, len(h.clients))
	for id := range h.clients {
		clientIDs = append(clientIDs, id)
	}
	h.mu.Unlock()
	for _, id := range clientIDs {
		if c := h.GetClient(id); c != nil {
			c.Close()
		}
	}
	// Give Close time to propagate
	time.Sleep(50 * time.Millisecond)
}

func (h *Hub) flushOnShutdown() {
	// Flush pending position broadcasts (send queued userUpdate events)
	h.positionTimerMu.Lock()
	if h.positionTimer != nil {
		h.positionTimer.Stop()
		h.positionTimer = nil
	}
	batch := make(map[string]positionBroadcast)
	for k, v := range h.pendingPositions {
		batch[k] = v
	}
	h.pendingPositions = make(map[string]positionBroadcast)
	h.positionTimerMu.Unlock()

	if len(batch) > 0 {
		serverTs := time.Now().UnixMilli()
		for _, pb := range batch {
			pb.data["serverTs"] = serverTs
			h.emitToVisible(pb.user, "userUpdate", pb.data)
		}
	}

	// Flush position history buffer to DB
	h.FlushPositionHistory()
}
