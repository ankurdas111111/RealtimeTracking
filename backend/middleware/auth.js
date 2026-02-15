function requireAuth(req, res, next) {
    if (req.session && req.session.user && req.session.user.id) return next();
    return res.redirect("/login");
}

function requireAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.role === "admin") return next();
    return res.status(403).send("Forbidden");
}

module.exports = {
    requireAuth: requireAuth,
    requireAdmin: requireAdmin
};
