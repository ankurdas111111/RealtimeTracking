package db

// UserCacheEntry holds cached user profile data.
type UserCacheEntry struct {
	FirstName   string
	LastName    string
	Role        string
	ShareCode   string
	Email       *string
	Mobile      *string
	CreatedAt   int64
	LastLat     *float64
	LastLng     *float64
	LastSpeed   *string
	LastUpdate  *int64
}

// RoomEntry holds cached room data.
type RoomEntry struct {
	DbID      string
	Name      string
	Members   map[string]bool // userId -> true
	CreatedBy string
	CreatedAt int64
}

// RoomMemberRole holds role and expiry for a room member.
type RoomMemberRole struct {
	Role     string
	ExpiresAt *int64
}

// LiveTokenEntry holds live token data.
type LiveTokenEntry struct {
	UserID    string
	ExpiresAt *int64
	CreatedAt int64
}

// GuardianshipEntry holds guardianship data.
type GuardianshipEntry struct {
	Status      string
	InitiatedBy string
	ExpiresAt   *int64
	CreatedAt   int64
}

// RoomAdminRequestEntry holds room admin request with votes.
type RoomAdminRequestEntry struct {
	Type      string // "roomAdmin"
	From      string
	RoomCode  string
	ExpiresIn *string
	CreatedAt int64
	Approvals map[string]bool // voterId -> true
	Denials   map[string]bool // voterId -> true
}

// LoadAllResult contains all data loaded from DB for cache init.
type LoadAllResult struct {
	UsersCache       map[string]*UserCacheEntry
	ShareCodes       map[string]string
	EmailIndex       map[string]string
	MobileIndex      map[string]string
	Rooms            map[string]*RoomEntry
	RoomMemberRoles  map[string]map[string]*RoomMemberRole // roomCode -> userId -> role
	Contacts         map[string]map[string]bool            // ownerId -> contactId -> true
	LiveTokens       map[string]*LiveTokenEntry
	Guardianships    map[string]map[string]*GuardianshipEntry // guardianId -> wardId -> entry
	RoomAdminRequests map[string][]*RoomAdminRequestEntry    // key (roomCode:roomAdmin) -> requests
}
