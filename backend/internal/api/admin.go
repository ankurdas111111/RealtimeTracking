package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"

	"kinnect-v3/internal/cache"
	"kinnect-v3/internal/db"
)

// AdminHandler handles admin endpoints.
type AdminHandler struct {
	db    *sql.DB
	cache *cache.Cache
}

// PromoteRequest is the JSON body for POST /api/admin/promote.
type PromoteRequest struct {
	UserID string `json:"userId"`
}

// Promote handles POST /api/admin/promote.
func (h *AdminHandler) Promote(w http.ResponseWriter, r *http.Request) {
	var req PromoteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Invalid request body"})
		return
	}
	userID := req.UserID
	if userID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "userId is required"})
		return
	}

	ctx := context.Background()
	if err := db.UpdateUserRole(ctx, h.db, userID, "admin"); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "Failed to update role"})
		return
	}
	h.cache.UpdateUserRole(userID, "admin")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
