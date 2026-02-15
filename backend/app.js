var express = require("express");
var http = require("http");
var path = require("path");
var crypto = require("crypto");
var session = require("express-session");
var pgSession = require("connect-pg-simple")(session);
var helmet = require("helmet");
var db = require("./lib/db");
var csrfMiddleware = require("./middleware/csrf");

// ── Express app + HTTP server ────────────────────────────────────────────────
var app = express();
var server = http.createServer(app);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: false }));

// ── Security headers (CSP with per-request nonce for inline scripts) ────────
app.use(function(req, res, next) {
    res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
    next();
});
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "https://unpkg.com", function(req, res) { return "'nonce-" + res.locals.cspNonce + "'"; }],
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
app.use(express.static(path.join(__dirname, "../frontend")));

// ── CSRF protection ─────────────────────────────────────────────────────────
app.use(csrfMiddleware.csrfTokenMiddleware);

// ── Routes ──────────────────────────────────────────────────────────────────
app.use(require("./routes/health"));
app.use(require("./routes/auth"));
app.use(require("./routes/pages"));
app.use(require("./routes/admin"));

module.exports = {
    app: app,
    server: server,
    sessionMiddleware: sessionMiddleware
};
