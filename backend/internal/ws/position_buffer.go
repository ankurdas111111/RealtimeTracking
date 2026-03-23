package ws

import (
	"context"
	"log/slog"
	"time"

	"kinnect-v3/internal/db"
)

const (
	maxPositionBuffer = 10000
	flushInterval      = 10 * time.Second
	purgeInterval      = 24 * time.Hour
	positionRetentionDays = 7
)

// PositionRecord holds a single position history entry.
type PositionRecord struct {
	UserID   string
	Lat      float64
	Lng      float64
	Speed    *float64
	Accuracy *float64
}

// RecordPosition adds a position to the buffer and trims if over max.
func (h *Hub) RecordPosition(userID string, lat, lng float64, speed, accuracy *float64) {
	h.positionBufMu.Lock()
	defer h.positionBufMu.Unlock()
	h.positionBuffer = append(h.positionBuffer, PositionRecord{
		UserID:   userID,
		Lat:      lat,
		Lng:      lng,
		Speed:    speed,
		Accuracy: accuracy,
	})
	if len(h.positionBuffer) > maxPositionBuffer {
		h.positionBuffer = h.positionBuffer[len(h.positionBuffer)-maxPositionBuffer:]
	}
}

// FlushPositionHistory inserts batch via db.InsertPositionHistory, then clears buffer.
func (h *Hub) FlushPositionHistory() {
	h.positionBufMu.Lock()
	batch := h.positionBuffer
	h.positionBuffer = nil
	h.positionBufMu.Unlock()

	if len(batch) == 0 {
		return
	}

	rows := make([]db.PositionHistoryRow, 0, len(batch))
	for _, r := range batch {
		rows = append(rows, db.PositionHistoryRow{
			UserID:   r.UserID,
			Latitude: r.Lat,
			Longitude: r.Lng,
			Speed:    r.Speed,
			Accuracy: r.Accuracy,
		})
	}

	ctx := context.Background()
	if err := db.InsertPositionHistory(ctx, h.pool.DB, rows); err != nil {
		slog.Error("Failed to insert position history", "error", err, "count", len(rows))
	}
}

// StartPositionFlusher runs a goroutine that flushes every 10s.
func (h *Hub) StartPositionFlusher(ctx context.Context) {
	ticker := time.NewTicker(flushInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.FlushPositionHistory()
		}
	}
}

// StartPositionPurger runs a goroutine that purges old records every 24h (7 day retention).
func (h *Hub) StartPositionPurger(ctx context.Context) {
	ticker := time.NewTicker(purgeInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			ctx := context.Background()
			if err := db.PurgePositionHistory(ctx, h.pool.DB, positionRetentionDays); err != nil {
				slog.Error("Failed to purge position history", "error", err)
			}
		}
	}
}
