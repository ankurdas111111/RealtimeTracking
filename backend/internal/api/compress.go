package api

import (
	"compress/gzip"
	"io"
	"net/http"
	"strings"
	"sync"
)

var gzPool = sync.Pool{
	New: func() any {
		gz, _ := gzip.NewWriterLevel(nil, gzip.BestSpeed)
		return gz
	},
}

type gzipResponseWriter struct {
	http.ResponseWriter
	gz          *gzip.Writer
	wroteHeader bool
}

func (g *gzipResponseWriter) Write(b []byte) (int, error) {
	if !g.wroteHeader {
		if g.Header().Get("Content-Type") == "" {
			g.Header().Set("Content-Type", http.DetectContentType(b))
		}
		g.wroteHeader = true
	}
	return g.gz.Write(b)
}

func (g *gzipResponseWriter) WriteHeader(code int) {
	g.Header().Del("Content-Length")
	g.wroteHeader = true
	g.ResponseWriter.WriteHeader(code)
}

func (g *gzipResponseWriter) Flush() {
	g.gz.Flush()
	if f, ok := g.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (g *gzipResponseWriter) Unwrap() http.ResponseWriter {
	return g.ResponseWriter
}

var skipGzipExt = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true,
	".woff2": true, ".woff": true, ".br": true, ".gz": true, ".zst": true,
	// Static assets served by http.ServeFile — gzip here corrupts the stream
	// because gz.Close() runs after ServeFile finalizes the response.
	// These files are cached immutable so compression isn't needed.
	".js": true, ".css": true, ".map": true, ".svg": true, ".ico": true,
}

// GzipMiddleware transparently gzip-compresses responses for clients that accept it.
// WebSocket upgrades and pre-compressed formats (images, fonts) are skipped.
func GzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
			next.ServeHTTP(w, r)
			return
		}
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		path := r.URL.Path
		for ext := range skipGzipExt {
			if strings.HasSuffix(path, ext) {
				next.ServeHTTP(w, r)
				return
			}
		}

		gz := gzPool.Get().(*gzip.Writer)
		defer gzPool.Put(gz)
		gz.Reset(w)

		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("Vary", "Accept-Encoding")

		grw := &gzipResponseWriter{ResponseWriter: w, gz: gz}
		next.ServeHTTP(grw, r)
		gz.Close()
	})
}

// NopWriteCloser wraps an io.Writer into a WriteCloser (Close is a no-op).
type NopWriteCloser struct{ io.Writer }

func (NopWriteCloser) Close() error { return nil }
