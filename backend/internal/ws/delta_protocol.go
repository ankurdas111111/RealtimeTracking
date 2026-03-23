package ws

import (
	"encoding/json"
	"log/slog"
)

// DeltaMessage represents a position update with only changed fields
type DeltaMessage struct {
	Event string                 `json:"event"`
	Data  map[string]interface{} `json:"data"`
}

// PositionSnapshot stores last sent state for a user
type PositionSnapshot struct {
	Latitude      *float64
	Longitude     *float64
	Speed         float64
	Accuracy      *float64
	BatteryPct    *int
	FormattedTime string
	Online        bool
}

// PositionDelta calculates what changed between snapshots
type PositionDelta struct {
	ID    string                 `json:"id"`
	Delta map[string]interface{} `json:"delta"`
}

// PositionDeltaCache stores last sent position for each user
type PositionDeltaCache struct {
	snapshots map[string]*PositionSnapshot
}

// NewPositionDeltaCache creates a new delta cache
func NewPositionDeltaCache() *PositionDeltaCache {
	return &PositionDeltaCache{
		snapshots: make(map[string]*PositionSnapshot),
	}
}

// GetDelta calculates the delta (changed fields) between current and last sent state
// Returns the delta and updates the cached snapshot
func (pdc *PositionDeltaCache) GetDelta(userID string, current *PositionSnapshot) PositionDelta {
	delta := make(map[string]interface{})

	// Get last snapshot (or create empty if not exists)
	last, exists := pdc.snapshots[userID]
	if !exists {
		last = &PositionSnapshot{}
	}

	// Check each field for changes
	if current.Latitude != nil && (last.Latitude == nil || *current.Latitude != *last.Latitude) {
		delta["lat"] = current.Latitude
	}

	if current.Longitude != nil && (last.Longitude == nil || *current.Longitude != *last.Longitude) {
		delta["lng"] = current.Longitude
	}

	if current.Speed != last.Speed {
		delta["spd"] = current.Speed
	}

	if current.Accuracy != nil && (last.Accuracy == nil || *current.Accuracy != *last.Accuracy) {
		delta["acc"] = current.Accuracy
	}

	if current.BatteryPct != nil && (last.BatteryPct == nil || *current.BatteryPct != *last.BatteryPct) {
		delta["batt"] = current.BatteryPct
	}

	if current.FormattedTime != last.FormattedTime && current.FormattedTime != "" {
		delta["ts"] = current.FormattedTime
	}

	if current.Online != last.Online {
		delta["online"] = current.Online
	}

	// Always include user ID
	delta["id"] = userID

	// Update snapshot
	pdc.snapshots[userID] = current

	return PositionDelta{
		ID:    userID,
		Delta: delta,
	}
}

// GetFullSnapshot returns the full state (for initial connection or explicit request)
func (pdc *PositionDeltaCache) GetFullSnapshot(userID string, full map[string]interface{}) map[string]interface{} {
	snapshot := &PositionSnapshot{
		Online: true,
	}

	// Extract and cache fields
	if lat, ok := full["lat"].(float64); ok {
		snapshot.Latitude = &lat
		full["lat"] = &lat
	}
	if lng, ok := full["lng"].(float64); ok {
		snapshot.Longitude = &lng
		full["lng"] = &lng
	}
	if spd, ok := full["spd"].(float64); ok {
		snapshot.Speed = spd
	}
	if acc, ok := full["acc"].(float64); ok {
		snapshot.Accuracy = &acc
	}
	if batt, ok := full["batt"].(float64); ok {
		batt := int(batt)
		snapshot.BatteryPct = &batt
	}
	if ts, ok := full["ts"].(string); ok {
		snapshot.FormattedTime = ts
	}

	pdc.snapshots[userID] = snapshot
	return full
}

// InvalidateUser removes cached snapshot (user disconnected or changed significantly)
func (pdc *PositionDeltaCache) InvalidateUser(userID string) {
	delete(pdc.snapshots, userID)
}

// ClearUser explicitly clears a user's snapshot
func (pdc *PositionDeltaCache) ClearUser(userID string) {
	delete(pdc.snapshots, userID)
}

// EncodeMessage encodes a message to JSON with size optimization
func EncodeMessageOptimized(event string, data interface{}) ([]byte, error) {
	msg := map[string]interface{}{
		"event": event,
		"data":  data,
	}
	return json.Marshal(msg)
}

// DecodeMessage decodes a message from JSON
func DecodeMessageOptimized(raw []byte) (string, map[string]interface{}, error) {
	var msg map[string]interface{}
	if err := json.Unmarshal(raw, &msg); err != nil {
		return "", nil, err
	}

	event := ""
	if e, ok := msg["event"].(string); ok {
		event = e
	}

	data := make(map[string]interface{})
	if d, ok := msg["data"].(map[string]interface{}); ok {
		data = d
	}

	return event, data, nil
}

// CompressPayload compresses common position data (simple field name mapping)
// This reduces JSON size by using shorter field names
func CompressPayload(payload map[string]interface{}) map[string]interface{} {
	compressed := make(map[string]interface{})

	// Map long names to short names
	fieldMap := map[string]string{
		"id":               "id",   // keep as is
		"latitude":         "lat",
		"lat":              "lat",
		"longitude":        "lng",
		"lng":              "lng",
		"speed":            "spd",
		"spd":              "spd",
		"accuracy":         "acc",
		"acc":              "acc",
		"batteryPct":       "batt",
		"battery":          "batt",
		"batt":             "batt",
		"formattedTime":    "ts",
		"timestamp":        "ts",
		"ts":               "ts",
		"displayName":      "name",
		"name":             "name",
		"roomRole":         "role",
		"role":             "role",
		"online":           "online",
	}

	for key, value := range payload {
		if shortKey, exists := fieldMap[key]; exists {
			compressed[shortKey] = value
		} else {
			compressed[key] = value
		}
	}

	return compressed
}

// DecompressPayload reverses the compression mapping
func DecompressPayload(compressed map[string]interface{}) map[string]interface{} {
	decompressed := make(map[string]interface{})

	// Map short names back to long names (for internal use)
	fieldMap := map[string]string{
		"id":     "id",
		"lat":    "latitude",
		"lng":    "longitude",
		"spd":    "speed",
		"acc":    "accuracy",
		"batt":   "batteryPct",
		"ts":     "formattedTime",
		"name":   "displayName",
		"role":   "roomRole",
		"online": "online",
	}

	for key, value := range compressed {
		if longKey, exists := fieldMap[key]; exists {
			decompressed[longKey] = value
		} else {
			decompressed[key] = value
		}
	}

	return decompressed
}

// OptimizePositionPayload reduces position update size
// Removes unnecessary fields and compresses field names
func OptimizePositionPayload(payload map[string]interface{}) map[string]interface{} {
	optimized := make(map[string]interface{})

	// Keep only essential position fields
	essentialFields := map[string]bool{
		"id":        true,
		"lat":       true,
		"lng":       true,
		"spd":       true,
		"acc":       true,
		"batt":      true,
		"ts":        true,
		"online":    true,
		"name":      true,
	}

	for key, value := range payload {
		if essentialFields[key] && value != nil {
			optimized[key] = value
		}
	}

	return optimized
}

// LogPayloadSize logs the size of a payload for monitoring
func LogPayloadSize(event string, payload interface{}) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	slog.Debug("Payload size", "event", event, "bytes", len(data))
}
