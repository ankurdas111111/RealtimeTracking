package auth

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type contextKey string

const (
	SessionKey   contextKey = "session"
	SessionIDKey contextKey = "sessionId"
)

const sessionMaxAgeSec = 7 * 24 * 60 * 60 // 7 days in seconds

// SessionMiddleware loads session from connect.sid cookie and stores it in context.
// secure controls whether the session cookie is set with the Secure flag.
func SessionMiddleware(store *SessionStore, secret string, secure bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cookie, _ := r.Cookie("connect.sid")
			var sid string
			if cookie != nil && cookie.Value != "" {
				sid = ParseSessionID(cookie.Value)
			}
			var sess *SessionData
			if sid != "" {
				var err error
				sess, err = store.Get(sid)
				if err != nil {
					slog.Warn("Session load failed", "error", err)
				}
			}
			if sess == nil {
				sess = &SessionData{}
			}
			if sess.CsrfToken == "" {
				sess.CsrfToken = GenerateCsrfToken()
				if sid == "" {
					sid = GenerateSessionID()
				}
				signed := SignCookie(sid, secret)
				sessData := &SessionData{User: sess.User, CsrfToken: sess.CsrfToken}
				if err := store.Create(sid, sessData, 7*24*time.Hour); err != nil {
					slog.Warn("Session create failed", "error", err)
				} else {
					http.SetCookie(w, &http.Cookie{
						Name:     "connect.sid",
						Value:    url.QueryEscape(signed),
						Path:     "/",
						MaxAge:   sessionMaxAgeSec,
						HttpOnly: true,
						SameSite: http.SameSiteLaxMode,
						Secure:   secure,
					})
				}
			}
			ctx := r.Context()
			ctx = withSession(ctx, sess)
			ctx = withSessionID(ctx, sid)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func withSession(ctx context.Context, s *SessionData) context.Context {
	return context.WithValue(ctx, SessionKey, s)
}

func withSessionID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, SessionIDKey, id)
}

// CsrfMiddleware verifies CSRF token for state-changing methods.
func CsrfMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		m := r.Method
		if m != http.MethodPost && m != http.MethodPut && m != http.MethodDelete && m != http.MethodPatch {
			next.ServeHTTP(w, r)
			return
		}
		sess := GetSession(r)
		if sess == nil || sess.CsrfToken == "" {
			writeJSON(w, http.StatusForbidden, map[string]any{"ok": false, "error": "Invalid session"})
			return
		}
		want := sess.CsrfToken
		got := r.Header.Get("x-csrf-token")
		if got == "" {
			// Try _csrf in body (JSON or form)
			ct := r.Header.Get("Content-Type")
			if strings.Contains(ct, "application/json") {
				body, err := io.ReadAll(r.Body)
				r.Body.Close()
				if err == nil {
					var m map[string]interface{}
					if json.Unmarshal(body, &m) == nil {
						if v, ok := m["_csrf"].(string); ok {
							got = v
						}
					}
					r.Body = io.NopCloser(bytes.NewReader(body))
				}
			} else if strings.Contains(ct, "application/x-www-form-urlencoded") {
				_ = r.ParseForm()
				got = r.FormValue("_csrf")
			}
		}
		if subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
			writeJSON(w, http.StatusForbidden, map[string]any{"ok": false, "error": "Invalid CSRF token"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireAuth returns 401 if session has no user.id.
func RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sess := GetSession(r)
		if sess == nil || sess.User == nil || sess.User.ID == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "Not authenticated"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireAdmin returns 403 if session user role is not admin.
func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sess := GetSession(r)
		if sess == nil || sess.User == nil || sess.User.Role != "admin" {
			writeJSON(w, http.StatusForbidden, map[string]any{"ok": false, "error": "Admin required"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// GetSession extracts SessionData from request context.
func GetSession(r *http.Request) *SessionData {
	v := r.Context().Value(SessionKey)
	if v == nil {
		return nil
	}
	s, _ := v.(*SessionData)
	return s
}

// GetSessionID extracts session ID from request context.
func GetSessionID(r *http.Request) string {
	v := r.Context().Value(SessionIDKey)
	if v == nil {
		return ""
	}
	s, _ := v.(string)
	return s
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
