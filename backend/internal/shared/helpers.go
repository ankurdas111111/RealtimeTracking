package shared

import (
	"crypto/rand"
	"fmt"
	"math"
	"regexp"
	"strings"
	"sync"
	"time"
)

// SanitizeString removes < > " ' & and truncates to maxLen.
func SanitizeString(val string, maxLen int) string {
	if maxLen <= 0 {
		maxLen = 200
	}
	re := regexp.MustCompile(`[<>"'&]`)
	s := re.ReplaceAllString(val, "")
	if len(s) > maxLen {
		return s[:maxLen]
	}
	return s
}

// ValidatedPosition holds validated position data.
type ValidatedPosition struct {
	Latitude     float64
	Longitude    float64
	Speed        float64
	FormattedTime string
	Accuracy     *float64
	Timestamp    *int64
}

// ValidatePosition validates and extracts position data from a map.
func ValidatePosition(data map[string]interface{}) *ValidatedPosition {
	if data == nil {
		return nil
	}
	lat, ok := toFloat64(data["latitude"])
	if !ok || lat < -90 || lat > 90 {
		return nil
	}
	lng, ok := toFloat64(data["longitude"])
	if !ok || lng < -180 || lng > 180 {
		return nil
	}
	speed, _ := toFloat64(data["speed"])
	if speed < 0 || speed > 1000 {
		speed = 0
	}
	var accuracy *float64
	if v, ok := toFloat64Opt(data["accuracy"]); ok && v >= 0 && v <= 100000 {
		accuracy = &v
	}
	var timestamp *int64
	if v, ok := toInt64Opt(data["timestamp"]); ok {
		timestamp = &v
	}
	ft := ""
	if s, ok := data["formattedTime"].(string); ok {
		ft = SanitizeString(s, 50)
	}
	return &ValidatedPosition{
		Latitude:      lat,
		Longitude:     lng,
		Speed:         speed,
		FormattedTime: ft,
		Accuracy:      accuracy,
		Timestamp:     timestamp,
	}
}

func toFloat64(v interface{}) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	default:
		return 0, false
	}
}

func toFloat64Opt(v interface{}) (float64, bool) {
	if v == nil {
		return 0, false
	}
	f, ok := toFloat64(v)
	return f, ok && !math.IsNaN(f)
}

func toInt64Opt(v interface{}) (int64, bool) {
	if v == nil {
		return 0, false
	}
	switch x := v.(type) {
	case float64:
		return int64(x), !math.IsNaN(x)
	case int64:
		return x, true
	case int:
		return int64(x), true
	default:
		return 0, false
	}
}

// SpeedString returns a string representation of speed for DB storage.
func SpeedString(speed float64) string {
	return fmt.Sprintf("%.2f", speed)
}

// HaversineM returns distance in meters between two points.
func HaversineM(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371e3
	toRad := func(x float64) float64 { return x * math.Pi / 180 }
	φ1 := toRad(lat1)
	φ2 := toRad(lat2)
	Δφ := toRad(lat2 - lat1)
	Δλ := toRad(lon2 - lon1)
	a := math.Sin(Δφ/2)*math.Sin(Δφ/2) +
		math.Cos(φ1)*math.Cos(φ2)*math.Sin(Δλ/2)*math.Sin(Δλ/2)
	return R * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

const codeChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// GenerateCode returns a 6-char code from the allowed character set.
func GenerateCode() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	var sb strings.Builder
	for i := 0; i < 6; i++ {
		sb.WriteByte(codeChars[int(b[i])%len(codeChars)])
	}
	return sb.String()
}

// RateLimit is a per-client rate limiter.
type RateLimit struct {
	events map[string]*rateLimitEntry
	mu     sync.Mutex
}

type rateLimitEntry struct {
	count   int
	resetAt int64
}

// Check returns true if the event is within limit (maxPerMin per minute).
func (r *RateLimit) Check(event string, maxPerMin int) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.events == nil {
		r.events = make(map[string]*rateLimitEntry)
	}
	now := time.Now().UnixMilli()
	e := r.events[event]
	if e == nil || now > e.resetAt {
		e = &rateLimitEntry{count: 0, resetAt: now + 60000}
		r.events[event] = e
	}
	e.count++
	return e.count <= maxPerMin
}
