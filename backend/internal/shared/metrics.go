package shared

import (
	"sort"
	"sync"
	"time"
)

const maxSamples = 1000

// MetricsCollector collects performance counters and histograms.
type MetricsCollector struct {
	mu         sync.Mutex
	counters   map[string]int64
	histograms map[string][]float64
}

// PerfMetrics is the default metrics singleton used by health handlers.
var PerfMetrics = NewMetrics()

// NewMetrics creates a new metrics collector.
func NewMetrics() *MetricsCollector {
	return &MetricsCollector{
		counters:   make(map[string]int64),
		histograms: make(map[string][]float64),
	}
}

// Inc increments a counter by n.
func (m *MetricsCollector) Inc(name string, n int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.counters[name] += int64(n)
}

// RecordTime records a duration in ms for a histogram.
func (m *MetricsCollector) RecordTime(name string, ms float64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	arr := m.histograms[name]
	arr = append(arr, ms)
	if len(arr) > maxSamples {
		arr = arr[1:]
	}
	m.histograms[name] = arr
}

// StartTimer returns a function that returns elapsed ms when called.
func (m *MetricsCollector) StartTimer() func() float64 {
	start := time.Now()
	return func() float64 {
		return float64(time.Since(start).Microseconds()) / 1000
	}
}

// GetCounter returns the current counter value.
func (m *MetricsCollector) GetCounter(name string) int64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.counters[name]
}

// Percentiles holds p50, p95, p99 and count.
type Percentiles struct {
	P50   float64
	P95   float64
	P99   float64
	Count int
}

// GetPercentiles returns percentiles for a histogram.
func (m *MetricsCollector) GetPercentiles(name string) *Percentiles {
	m.mu.Lock()
	arr := append([]float64(nil), m.histograms[name]...)
	m.mu.Unlock()
	if len(arr) == 0 {
		return nil
	}
	sort.Float64s(arr)
	n := len(arr)
	return &Percentiles{
		P50:   round3(arr[n*50/100]),
		P95:   round3(arr[n*95/100]),
		P99:   round3(arr[n*99/100]),
		Count: n,
	}
}

func round3(x float64) float64 {
	return float64(int64(x*1000+0.5)) / 1000
}

// Snapshot returns a snapshot of all counters and histogram percentiles.
func (m *MetricsCollector) Snapshot() map[string]interface{} {
	m.mu.Lock()
	defer m.mu.Unlock()
	counters := make(map[string]int64)
	for k, v := range m.counters {
		counters[k] = v
	}
	histograms := make(map[string]*Percentiles)
	for k := range m.histograms {
		arr := append([]float64(nil), m.histograms[k]...)
		m.mu.Unlock()
		sort.Float64s(arr)
		n := len(arr)
		var p *Percentiles
		if n > 0 {
			p = &Percentiles{
				P50:   round3(arr[n*50/100]),
				P95:   round3(arr[n*95/100]),
				P99:   round3(arr[n*99/100]),
				Count: n,
			}
		}
		m.mu.Lock()
		histograms[k] = p
	}
	return map[string]interface{}{
		"counters":   counters,
		"histograms": histograms,
	}
}

// Reset clears all metrics.
func (m *MetricsCollector) Reset() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.counters = make(map[string]int64)
	m.histograms = make(map[string][]float64)
}
