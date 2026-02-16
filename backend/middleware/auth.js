function requireAuth(req, res, next) {
    if (req.session && req.session.user && req.session.user.id) return next();
    return res.status(401).json({ ok: false, error: "Not authenticated" });
}

function requireAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.role === "admin") return next();
    return res.status(403).json({ ok: false, error: "Forbidden" });
}

module.exports = {
    requireAuth: requireAuth,
    requireAdmin: requireAdmin
};
