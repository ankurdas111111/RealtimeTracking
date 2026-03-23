package monitoring

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Metrics holds all Prometheus metrics for the application.
type Metrics struct {
	// HTTP metrics
	HTTPRequestsTotal   prometheus.Counter
	HTTPRequestLatency  prometheus.Histogram
	HTTPRequestsActive  prometheus.Gauge

	// WebSocket metrics
	WSConnectionsActive prometheus.Gauge
	WSConnectionsTotal  prometheus.Counter
	WSMessagesRecv      prometheus.Counter
	WSMessagesSent      prometheus.Counter
	WSMessageLatency    prometheus.Histogram

	// Position metrics
	PositionUpdatesTotal prometheus.Counter
	PositionQueueSize    prometheus.Gauge

	// Cache metrics
	CacheHits     prometheus.Counter
	CacheMisses   prometheus.Counter
	CacheSize     prometheus.Gauge

	// Database metrics
	DBConnectionsActive prometheus.Gauge
	DBConnectionsIdle   prometheus.Gauge
	DBQueryDuration     prometheus.Histogram
	DBQueryErrors       prometheus.Counter

	// Business logic metrics
	SOSAlertsTotal      prometheus.Counter
	RoomMembershipsTotal prometheus.Counter
	ContactsTotal       prometheus.Counter

	// Application metrics
	StartupDuration prometheus.Histogram
	ProcessUptime   prometheus.Gauge
}

// NewMetrics creates and registers all Prometheus metrics.
func NewMetrics() *Metrics {
	return &Metrics{
		// HTTP metrics
		HTTPRequestsTotal: promauto.NewCounter(prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total number of HTTP requests",
		}),
		HTTPRequestLatency: promauto.NewHistogram(prometheus.HistogramOpts{
			Name:    "http_request_latency_ms",
			Help:    "HTTP request latency in milliseconds",
			Buckets: []float64{1, 5, 10, 25, 50, 100, 250, 500, 1000},
		}),
		HTTPRequestsActive: promauto.NewGauge(prometheus.GaugeOpts{
			Name: "http_requests_active",
			Help: "Number of active HTTP requests",
		}),

		// WebSocket metrics
		WSConnectionsActive: promauto.NewGauge(prometheus.GaugeOpts{
			Name: "ws_connections_active",
			Help: "Number of active WebSocket connections",
		}),
		WSConnectionsTotal: promauto.NewCounter(prometheus.CounterOpts{
			Name: "ws_connections_total",
			Help: "Total number of WebSocket connections",
		}),
		WSMessagesRecv: promauto.NewCounter(prometheus.CounterOpts{
			Name: "ws_messages_received_total",
			Help: "Total number of WebSocket messages received",
		}),
		WSMessagesSent: promauto.NewCounter(prometheus.CounterOpts{
			Name: "ws_messages_sent_total",
			Help: "Total number of WebSocket messages sent",
		}),
		WSMessageLatency: promauto.NewHistogram(prometheus.HistogramOpts{
			Name:    "ws_message_latency_ms",
			Help:    "WebSocket message processing latency in milliseconds",
			Buckets: []float64{1, 5, 10, 25, 50, 100, 250, 500},
		}),

		// Position metrics
		PositionUpdatesTotal: promauto.NewCounter(prometheus.CounterOpts{
			Name: "position_updates_total",
			Help: "Total number of position updates",
		}),
		PositionQueueSize: promauto.NewGauge(prometheus.GaugeOpts{
			Name: "position_queue_size",
			Help: "Current size of the position update queue",
		}),

		// Cache metrics
		CacheHits: promauto.NewCounter(prometheus.CounterOpts{
			Name: "cache_hits_total",
			Help: "Total number of cache hits",
		}),
		CacheMisses: promauto.NewCounter(prometheus.CounterOpts{
			Name: "cache_misses_total",
			Help: "Total number of cache misses",
		}),
		CacheSize: promauto.NewGauge(prometheus.GaugeOpts{
			Name: "cache_size_bytes",
			Help: "Estimated cache size in bytes",
		}),

		// Database metrics
		DBConnectionsActive: promauto.NewGauge(prometheus.GaugeOpts{
			Name: "db_connections_active",
			Help: "Number of active database connections",
		}),
		DBConnectionsIdle: promauto.NewGauge(prometheus.GaugeOpts{
			Name: "db_connections_idle",
			Help: "Number of idle database connections",
		}),
		DBQueryDuration: promauto.NewHistogram(prometheus.HistogramOpts{
			Name:    "db_query_duration_ms",
			Help:    "Database query duration in milliseconds",
			Buckets: []float64{1, 5, 10, 25, 50, 100, 250, 500, 1000},
		}),
		DBQueryErrors: promauto.NewCounter(prometheus.CounterOpts{
			Name: "db_query_errors_total",
			Help: "Total number of database query errors",
		}),

		// Business logic metrics
		SOSAlertsTotal: promauto.NewCounter(prometheus.CounterOpts{
			Name: "sos_alerts_total",
			Help: "Total number of SOS alerts triggered",
		}),
		RoomMembershipsTotal: promauto.NewCounter(prometheus.CounterOpts{
			Name: "room_memberships_total",
			Help: "Total number of room membership changes",
		}),
		ContactsTotal: promauto.NewCounter(prometheus.CounterOpts{
			Name: "contacts_total",
			Help: "Total number of contact additions",
		}),

		// Application metrics
		StartupDuration: promauto.NewHistogram(prometheus.HistogramOpts{
			Name:    "startup_duration_ms",
			Help:    "Application startup duration in milliseconds",
			Buckets: []float64{100, 500, 1000, 2000, 5000, 10000},
		}),
		ProcessUptime: promauto.NewGauge(prometheus.GaugeOpts{
			Name: "process_uptime_seconds",
			Help: "Process uptime in seconds",
		}),
	}
}
