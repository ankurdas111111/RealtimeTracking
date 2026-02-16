var express = require("express");
var http = require("http");
var path = require("path");
var crypto = require("crypto");
var compression = require("compression");
var session = require("express-session");
var pgSession = require("connect-pg-simple")(session);
var helmet = require("helmet");
var db = require("./lib/db");
var csrfMiddleware = require("./middleware/csrf");

// ── Express app + HTTP server ────────────────────────────────────────────────
var app = express();
var server = http.createServer(app);

// ── HTTP compression (gzip/brotli for JSON APIs + SPA assets) ────────────────
app.use(compression({ threshold: 512 }));

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ── Security headers (CSP) ──────────────────────────────────────────────────
var isDev = process.env.NODE_ENV !== "production";
app.use(function(req, res, next) {
    res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
    next();
});
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: isDev
                ? ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://unpkg.com"]
                : ["'self'", "https://unpkg.com", function(req, res) { return "'nonce-" + res.locals.cspNonce + "'"; }],
            styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://fonts.googleapis.com"],
            imgSrc: ["'self'", "data:", "https://*.tile.openstreetmap.org", "https://*.basemaps.cartocdn.com", "https://unpkg.com"],
            connectSrc: ["'self'", "ws:", "wss:"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"]
        }
    },
    crossOriginEmbedderPolicy: false
}));

if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
    if (!process.env.SESSION_SECRET) {
        throw new Error("SESSION_SECRET is required in production");
    }
}

// ── Session store (PostgreSQL via connect-pg-simple) ─────────────────────────
var sessionMiddleware = session({
    store: new pgSession({
        pool: db.getPool(),
        tableName: "session",
        createTableIfMissing: false,
        pruneSessionInterval: 15 * 60
    }),
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production" ? "auto" : false,
        maxAge: 7 * 24 * 60 * 60 * 1000
    }
});

app.use(sessionMiddleware);

// ── Serve Svelte SPA from frontend/dist/ (production) ───────────────────────
var distPath = path.join(__dirname, "../frontend/dist");
app.use(express.static(distPath, {
    maxAge: process.env.NODE_ENV === "production" ? "7d" : 0,
    etag: true,
    lastModified: true
}));

// ── CSRF protection ─────────────────────────────────────────────────────────
app.use(csrfMiddleware.csrfTokenMiddleware);

// ── Routes ──────────────────────────────────────────────────────────────────
app.use(require("./routes/health"));
app.use(require("./routes/auth"));
app.use(require("./routes/pages"));
app.use(require("./routes/admin"));

// ── SPA catch-all: serve index.html for all non-API, non-asset routes ───────
var fs = require("fs");
var indexHtml = null;
app.get("{*path}", function(req, res) {
    // Don't catch-all API or socket routes
    if (req.path.startsWith("/api/") || req.path.startsWith("/socket.io") || req.path.startsWith("/health")) {
        return res.status(404).json({ error: "Not found" });
    }
    // Serve the SPA index.html
    if (!indexHtml) {
        var indexPath = path.join(distPath, "index.html");
        if (fs.existsSync(indexPath)) {
            indexHtml = fs.readFileSync(indexPath, "utf8");
        } else {
            return res.status(404).send("Frontend not built. Run npm run build.");
        }
    }
    res.setHeader("Content-Type", "text/html");
    res.send(indexHtml);
});

// ── Global Express error handler (must be 4 args) ────────────────────────────
app.use(function(err, req, res, _next) {
    var config = require("./config");
    config.log.error({ err: err.message, stack: err.stack, method: req.method, url: req.originalUrl }, "Unhandled Express error");
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal server error" });
});

module.exports = {
    app: app,
    server: server,
    sessionMiddleware: sessionMiddleware
};
