var helpers = require("../lib/helpers");

describe("sanitizeString", function() {
    it("returns empty string for non-string input", function() {
        expect(helpers.sanitizeString(null)).toBe("");
        expect(helpers.sanitizeString(undefined)).toBe("");
        expect(helpers.sanitizeString(123)).toBe("");
        expect(helpers.sanitizeString({})).toBe("");
    });

    it("strips dangerous HTML characters", function() {
        expect(helpers.sanitizeString('<script>alert("xss")</script>')).toBe("scriptalert(xss)/script");
        expect(helpers.sanitizeString('hello <b>world</b>')).toBe("hello bworld/b");
    });

    it("truncates to maxLen", function() {
        expect(helpers.sanitizeString("abcdef", 3)).toBe("abc");
        expect(helpers.sanitizeString("ab", 5)).toBe("ab");
    });

    it("uses default maxLen of 200", function() {
        var long = "a".repeat(300);
        expect(helpers.sanitizeString(long).length).toBe(200);
    });
});

describe("validatePosition", function() {
    it("returns null for invalid input", function() {
        expect(helpers.validatePosition(null)).toBeNull();
        expect(helpers.validatePosition(undefined)).toBeNull();
        expect(helpers.validatePosition("string")).toBeNull();
        expect(helpers.validatePosition({})).toBeNull();
    });

    it("rejects out-of-range latitude", function() {
        expect(helpers.validatePosition({ latitude: 91, longitude: 0 })).toBeNull();
        expect(helpers.validatePosition({ latitude: -91, longitude: 0 })).toBeNull();
    });

    it("rejects out-of-range longitude", function() {
        expect(helpers.validatePosition({ latitude: 0, longitude: 181 })).toBeNull();
        expect(helpers.validatePosition({ latitude: 0, longitude: -181 })).toBeNull();
    });

    it("accepts valid position and normalizes speed", function() {
        var result = helpers.validatePosition({
            latitude: 28.6139,
            longitude: 77.2090,
            speed: 50,
            formattedTime: "12:00:00"
        });
        expect(result).not.toBeNull();
        expect(result.latitude).toBeCloseTo(28.6139);
        expect(result.longitude).toBeCloseTo(77.2090);
        expect(result.speed).toBe(50);
        expect(result.formattedTime).toBe("12:00:00");
    });

    it("clamps negative speed to 0", function() {
        var result = helpers.validatePosition({ latitude: 0, longitude: 0, speed: -5 });
        expect(result.speed).toBe(0);
    });

    it("clamps extreme speed to 0", function() {
        var result = helpers.validatePosition({ latitude: 0, longitude: 0, speed: 1500 });
        expect(result.speed).toBe(0);
    });

    it("defaults speed to 0 when missing", function() {
        var result = helpers.validatePosition({ latitude: 0, longitude: 0 });
        expect(result.speed).toBe(0);
    });
});

describe("haversineM", function() {
    it("returns 0 for same point", function() {
        expect(helpers.haversineM(28.6, 77.2, 28.6, 77.2)).toBeCloseTo(0, 0);
    });

    it("calculates approximate distance between known cities", function() {
        // Delhi to Mumbai: ~1150 km
        var dist = helpers.haversineM(28.6139, 77.2090, 19.0760, 72.8777);
        expect(dist).toBeGreaterThan(1100000);
        expect(dist).toBeLessThan(1200000);
    });

    it("handles equator crossing", function() {
        var dist = helpers.haversineM(1, 0, -1, 0);
        // ~222 km
        expect(dist).toBeGreaterThan(220000);
        expect(dist).toBeLessThan(225000);
    });
});

describe("generateCode", function() {
    it("returns a 6-character string", function() {
        var code = helpers.generateCode();
        expect(typeof code).toBe("string");
        expect(code.length).toBe(6);
    });

    it("only contains allowed characters", function() {
        var allowed = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        for (var i = 0; i < 50; i++) {
            var code = helpers.generateCode();
            for (var j = 0; j < code.length; j++) {
                expect(allowed).toContain(code[j]);
            }
        }
    });

    it("generates unique codes (statistical check)", function() {
        var codes = new Set();
        for (var i = 0; i < 100; i++) codes.add(helpers.generateCode());
        // With 31^6 possible codes, 100 should all be unique
        expect(codes.size).toBe(100);
    });
});

describe("socketRateLimit", function() {
    it("allows requests under the limit", function() {
        var fakeSocket = {};
        for (var i = 0; i < 5; i++) {
            expect(helpers.socketRateLimit(fakeSocket, "test", 5)).toBe(true);
        }
    });

    it("blocks requests over the limit", function() {
        var fakeSocket = {};
        for (var i = 0; i < 5; i++) {
            helpers.socketRateLimit(fakeSocket, "test2", 5);
        }
        expect(helpers.socketRateLimit(fakeSocket, "test2", 5)).toBe(false);
    });

    it("resets after the window expires", function() {
        var fakeSocket = {};
        for (var i = 0; i < 5; i++) {
            helpers.socketRateLimit(fakeSocket, "test3", 5);
        }
        expect(helpers.socketRateLimit(fakeSocket, "test3", 5)).toBe(false);
        // Simulate window expiry
        fakeSocket._rl_test3.resetAt = Date.now() - 1;
        expect(helpers.socketRateLimit(fakeSocket, "test3", 5)).toBe(true);
    });

    it("tracks different events independently", function() {
        var fakeSocket = {};
        for (var i = 0; i < 5; i++) {
            helpers.socketRateLimit(fakeSocket, "eventA", 5);
        }
        expect(helpers.socketRateLimit(fakeSocket, "eventA", 5)).toBe(false);
        expect(helpers.socketRateLimit(fakeSocket, "eventB", 5)).toBe(true);
    });
});
