var crypto = require("crypto");

function csrfTokenMiddleware(req, res, next) {
    if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString("hex");
    res.locals.csrfToken = req.session.csrfToken;
    next();
}

function verifyCsrf(req, res, next) {
    var token = (req.body && req.body._csrf) || req.headers["x-csrf-token"] || "";
    if (token !== req.session.csrfToken) return res.status(403).json({ ok: false, error: "Invalid CSRF token" });
    next();
}

module.exports = {
    csrfTokenMiddleware: csrfTokenMiddleware,
    verifyCsrf: verifyCsrf
};
