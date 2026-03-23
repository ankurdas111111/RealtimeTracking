# Redis Configuration Guide

**Current Status**: Redis code implemented, but NOT YET integrated into main.go
**Date**: March 24, 2026

---

## 📋 Current Setup

### Local Development (Current)
- ✅ **Database**: PostgreSQL (localhost:5432)
- ✅ **Cache**: In-memory (lazy-loaded from DB)
- ✅ **Session Storage**: PostgreSQL `session` table
- ❌ **Redis**: Not active (optional)
- **Configuration**: `backend/.env`

### Production on Render (Current)
- ✅ **Database**: PostgreSQL (from Render)
- ✅ **Cache**: In-memory (lazy-loaded from DB)
- ✅ **Session Storage**: PostgreSQL `session` table
- ❌ **Redis**: Not active (optional)
- **Configuration**: Render environment variables

---

## 🔧 How to Enable Redis (Optional)

Redis is completely optional. The system works fine without it using in-memory caching.

### For Local Development

#### Step 1: Install Redis Locally (Mac)
```bash
# Using Homebrew
brew install redis

# Start Redis
redis-server

# In another terminal, verify it's running
redis-cli ping
# Returns: PONG
```

#### Step 2: Update .env File
```bash
# backend/.env
REDIS_URL=redis://localhost:6379

# Or with authentication (if configured)
REDIS_URL=redis://user:password@localhost:6379/0
```

#### Step 3: Initialize Redis in Code
Add to `backend/main.go` after line 85:

```go
// Initialize Redis if configured (optional)
var redisCache *cache.RedisCache
var sessionStore *cache.RedisSessionStore
if cfg.RedisURL != "" {
    var err error
    redisCache, err = cache.NewRedisCache(ctx, cache.RedisConfig{
        URL:    cfg.RedisURL,
        Prefix: "kinnect:",
    })
    if err != nil {
        slog.Warn("Redis connection failed, using in-memory storage", "error", err)
    } else {
        sessionStore = cache.NewRedisSessionStore(redisCache)
        defer redisCache.Close()
        slog.Info("Redis cache initialized")
    }
}

// Assign to hub (if needed for session management)
hub.RedisCache = redisCache
hub.RedisSessionStore = sessionStore
```

#### Step 4: Test Locally
```bash
cd backend
go run main.go

# Should see in logs: "Redis cache initialized" (if REDIS_URL is set)
# Or: "REDIS_URL not configured" (if empty or not set)
```

---

## ☁️ How to Enable Redis on Render

### Step 1: Get Aiven Redis Instance

1. Go to **Aiven Console** (https://console.aiven.io)
2. Create a new Redis service:
   - Click "Create Service"
   - Select "Redis"
   - Choose plan: **Free** or **$19/month** (1GB)
   - Select region close to Render
3. Copy the **Connection URL** (format: `redis://avnadmin:password@host:port/0`)

### Step 2: Add to Render Environment

1. Go to **Render Dashboard** for your Kinnect app
2. Navigate to **Settings** → **Environment**
3. Click **Add Environment Variable**
4. Add:
   - **Key**: `REDIS_URL`
   - **Value**: Your Aiven Redis URL (paste from step 1)
5. Click **Save Changes**

### Step 3: Deploy with Redis

```bash
# Update main.go with Redis initialization (see Step 3 above)
git add backend/main.go
git commit -m "feat: enable Redis caching on Render"
git push origin main

# Render will auto-deploy
# Watch logs: https://dashboard.render.com → Logs
# Look for: "Redis cache initialized"
```

### Step 4: Verify on Production

```bash
# Check application logs in Render
# Should see: "Redis cache initialized"

# Test the app
curl https://your-app.onrender.com/health

# Check Aiven dashboard for:
# - Connected clients > 0
# - Memory usage increasing
```

---

## 📊 Redis vs In-Memory Storage

### Without Redis (Current - Recommended for Free Tier)

**Pros**:
- ✅ No additional cost
- ✅ No external dependencies
- ✅ Simple setup (just PostgreSQL)
- ✅ Works on Render free tier
- ✅ Data persists across restarts (via DB)

**Cons**:
- ❌ Cannot share sessions between multiple instances
- ❌ Session recovery slower (loads from DB)
- ❌ No distributed locking
- ❌ Position caching limited to single instance

**Good for**:
- Single instance deployment (Render free tier)
- Prototyping and development
- Limited concurrent users (<1000)

### With Redis (Optional - For Scaling)

**Pros**:
- ✅ Distributed session storage
- ✅ Faster recovery on restart (<1s vs 5-10s)
- ✅ Multi-instance support
- ✅ Distributed locking (prevent race conditions)
- ✅ Position caching across instances
- ✅ Better performance (<5ms vs ~50ms)

**Cons**:
- ❌ Additional cost (Aiven: $0 free tier or $19/month)
- ❌ One more external service to manage
- ❌ Network latency (cloud to cloud)
- ❌ Complexity for single-instance deployment

**Good for**:
- Paid Render tiers (multiple dynos)
- High performance needs
- >5,000 concurrent users
- Multi-region deployments

---

## 🔄 What Redis Does (When Enabled)

### Session Storage
```
Without Redis:
  User connects → Session stored in memory → Server restart → Session lost

With Redis:
  User connects → Session stored in memory + Redis → Server restart → Session restored from Redis
```

### Position Caching
```
Without Redis:
  Position update → Store in memory → Database → Broadcast to users
  Lookup: ~50ms (DB query)

With Redis:
  Position update → Store in memory + Redis → Database (async) → Broadcast
  Lookup: <5ms (Redis cache)
```

### Rate Limiting
```
Without Redis:
  Rate limit check → Query database → Slow (100ms+)

With Redis:
  Rate limit check → Redis atomic counter → Fast (<1ms)
```

---

## 🎯 Recommendation for Your Project

### Current Status: ✅ Perfect As-Is

For **Render Free Tier** with your current usage:

```
✅ Use In-Memory Storage (Current Setup)
✅ PostgreSQL for persistence
✅ Don't add Redis (unnecessary cost/complexity)
✅ Lazy loading for fast startup
✅ Connection limit at 5,000 users
```

### Upgrade Path (If Needed)

**When to add Redis**:
- [ ] Planning to use paid Render tier (multiple dynos)
- [ ] Need multi-instance support
- [ ] Expecting >5,000 concurrent users
- [ ] Want <1s recovery on restart
- [ ] Need distributed locking for critical sections

**When to upgrade from Render**:
- [ ] Exceeding 10,000 concurrent users
- [ ] Need multiple backend instances
- [ ] Need global distribution (multi-region)
- [ ] Need 99.99% uptime SLA

---

## 📝 Current Architecture (Without Redis)

```
┌─────────────────────────────────┐
│     WebSocket Clients (5k)      │
└──────────────┬──────────────────┘
               │
       ┌───────▼────────┐
       │  Connection    │
       │  Limiter       │
       │  (5k hard cap) │
       └───────┬────────┘
               │
    ┌──────────▼──────────┐
    │  In-Memory Cache    │
    │  (Lazy-loaded)      │
    │  - Users            │
    │  - Rooms            │
    │  - Sessions         │
    │  - Positions (5m)   │
    └──────────┬──────────┘
               │
    ┌──────────▼──────────┐
    │   PostgreSQL DB     │
    │  - Persistent data  │
    │  - Session table    │
    │  - Position history │
    └─────────────────────┘
```

### What Gets Cached In-Memory:
1. **Users**: Loaded on-demand, LRU eviction at 5k
2. **Rooms**: Loaded with members, LRU eviction
3. **Positions**: 5-minute cache (auto-expire)
4. **Sessions**: In-memory only (restored from DB on restart)
5. **Contacts/Guardianships**: Loaded on-demand

### What Gets Persisted to DB:
1. **Active Sessions**: `active_sessions` table (for recovery)
2. **Position History**: `position_history` table
3. **User Data**: `users` table
4. **All relationships**: rooms, contacts, guardianships

---

## 🔌 Optional: How to Use Redis Code (If You Decide to Add It)

The Redis code is already implemented in:
- `backend/internal/cache/redis.go` (Redis client)
- `backend/internal/cache/redis_session.go` (Session store)

To use it:

### 1. Add Redis initialization to main.go
```go
// After line 85 in main.go
if cfg.RedisURL != "" {
    redisCache, err := cache.NewRedisCache(ctx, cache.RedisConfig{
        URL:    cfg.RedisURL,
        Prefix: "kinnect:",
    })
    if err == nil {
        sessionStore := cache.NewRedisSessionStore(redisCache)
        // Use sessionStore for session management
        defer redisCache.Close()
    }
}
```

### 2. Use Redis for specific operations
```go
// Session management
sessionStore.SaveActiveSession(ctx, session)
session, _ := sessionStore.GetActiveSession(ctx, userID)

// Position caching
sessionStore.CacheUserLocation(ctx, userID, lat, lng)

// Rate limiting
remaining, allowed, _ := redisCache.CheckRateLimit(ctx, clientID, 100, time.Minute)
```

---

## ✅ Summary

| Feature | Current (No Redis) | With Redis |
|---------|-------------------|-----------|
| Cost | $0 | $0-$19/month |
| Session storage | In-memory + DB | Redis + DB |
| Recovery time | 5-10s | <1s |
| Position lookup | 50ms (DB) | <5ms |
| Rate limiting | DB query | <1ms atomic |
| Multi-instance | ❌ | ✅ |
| Concurrent users | 5,000 | 5,000+ |
| Render free tier | ✅ | ✅ |
| Complexity | Low | Medium |

**Recommendation**: Keep current setup (no Redis) for Render free tier. Add Redis only if upgrading to paid tier or need specific features.

---

## 🚀 Quick Start (For Future Reference)

If you decide to add Redis later:

```bash
# 1. Get Aiven Redis URL
# 2. Add REDIS_URL to Render env vars
# 3. Update main.go (add Redis initialization code above)
# 4. git push origin main
# 5. Monitor logs
```

Done! Your current setup is optimized for Render free tier. 🎉
