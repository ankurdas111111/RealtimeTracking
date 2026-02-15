var crypto = require("crypto");

// Middleware: generate CSRF token per session and expose via res.locals
function csrfTokenMiddleware(req, res, next) {
    if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString("hex");
    res.locals.csrfToken = req.session.csrfToken;
    next();
}

// Route-level middleware: verify CSRF token from request body
function verifyCsrf(req, res, next) {
    if (req.body._csrf !== req.session.csrfToken) return res.status(403).send("Invalid CSRF token");
    next();
}

module.exports = {
    csrfTokenMiddleware: csrfTokenMiddleware,
    verifyCsrf: verifyCsrf
};
