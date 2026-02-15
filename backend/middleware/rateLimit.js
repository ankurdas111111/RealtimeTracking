var rateLimit = require("express-rate-limit");

var loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Too many login attempts, try again in 15 minutes"
});

var registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Too many registrations, try again later"
});

module.exports = {
    loginLimiter: loginLimiter,
    registerLimiter: registerLimiter
};
