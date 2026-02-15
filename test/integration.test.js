/**
 * Integration tests for the HTTP routes.
 *
 * These tests use a real PostgreSQL database pointed to by DATABASE_URL.
 * If DATABASE_URL is not set, integration tests are skipped.
 */

var hasDbUrl = !!process.env.DATABASE_URL;

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = "test-secret-for-ci";

// If no DATABASE_URL, set a dummy to prevent crash at require-time,
// then skip all tests below.
if (!hasDbUrl) process.env.DATABASE_URL = "postgresql://skip:skip@localhost:5432/skip";

var request = require("supertest");

var mod = require("../backend/index");
var server = mod.server;
var io = mod.io;
var db = require("../backend/lib/db");

var describeIfDb = hasDbUrl ? describe : describe.skip;

describeIfDb("Integration tests (requires DATABASE_URL)", function() {

    beforeAll(async function() {
        // Wait for async start() to finish initialising DB
        await new Promise(function(resolve) { setTimeout(resolve, 2000); });
        if (!server.listening) {
            await new Promise(function(resolve) { server.listen(0, resolve); });
        }
    }, 15000);

    afterAll(async function() {
        io.close();
        await new Promise(function(resolve) {
            if (server.listening) server.close(resolve);
            else resolve();
        });
        await db.closePool();
    });

    describe("GET /health", function() {
        it("returns 200 with status ok", async function() {
            var res = await request(server).get("/health");
            expect(res.status).toBe(200);
            expect(res.body.status).toBe("ok");
            expect(typeof res.body.uptime).toBe("number");
        });
    });

    describe("GET /login", function() {
        it("returns 200 with login form", async function() {
            var res = await request(server).get("/login");
            expect(res.status).toBe(200);
            expect(res.text).toContain("Sign in");
            expect(res.text).toContain("_csrf");
        });
    });

    describe("GET /register", function() {
        it("returns 200 with register form", async function() {
            var res = await request(server).get("/register");
            expect(res.status).toBe(200);
            expect(res.text).toContain("Create account");
            expect(res.text).toContain("_csrf");
        });
    });

    describe("POST /login without CSRF", function() {
        it("returns 403 for missing CSRF token", async function() {
            var res = await request(server)
                .post("/login")
                .type("form")
                .send({ login_id: "test@example.com", password: "test" });
            expect(res.status).toBe(403);
        });
    });

    describe("POST /register without CSRF", function() {
        it("returns 403 for missing CSRF token", async function() {
            var res = await request(server)
                .post("/register")
                .type("form")
                .send({ first_name: "Test", last_name: "User", password: "testtest", confirm: "testtest", contact_type: "email", contact_value: "test@example.com" });
            expect(res.status).toBe(403);
        });
    });

    describe("GET / without auth", function() {
        it("redirects to /login", async function() {
            var res = await request(server).get("/");
            expect(res.status).toBe(302);
            expect(res.headers.location).toBe("/login");
        });
    });

    describe("Registration + Login flow", function() {
        var agent;
        var csrfToken;
        var testEmail = "testuser_" + String(Date.now()).slice(-8) + "@test.com";
        var testUserId = null;

        beforeAll(function() {
            agent = request.agent(server);
        });

        it("gets CSRF token from register page", async function() {
            var res = await agent.get("/register");
            expect(res.status).toBe(200);
            var match = res.text.match(/name="_csrf"\s+value="([^"]+)"/);
            expect(match).not.toBeNull();
            csrfToken = match[1];
        });

        it("registers a new user", async function() {
            var res = await agent
                .post("/register")
                .type("form")
                .send({
                    first_name: "Test",
                    last_name: "User",
                    password: "password123",
                    confirm: "password123",
                    contact_type: "email",
                    contact_value: testEmail,
                    _csrf: csrfToken
                });
            expect(res.status).toBe(302);
            expect(res.headers.location).toBe("/");
        });

        it("can access main page after registration", async function() {
            var res = await agent.get("/");
            expect(res.status).toBe(200);
            expect(res.text).toContain("Kinnect");
        });

        it("gets CSRF token for logout", async function() {
            var res = await agent.get("/");
            var match = res.text.match(/name="_csrf"\s+value="([^"]+)"/);
            expect(match).not.toBeNull();
            csrfToken = match[1];
        });

        it("logs out with CSRF token", async function() {
            var res = await agent
                .post("/logout")
                .type("form")
                .send({ _csrf: csrfToken });
            expect(res.status).toBe(302);
            expect(res.headers.location).toBe("/login");
        });

        it("redirects to /login after logout", async function() {
            var res = await agent.get("/");
            expect(res.status).toBe(302);
            expect(res.headers.location).toBe("/login");
        });

        it("can log in with email + password", async function() {
            // Get fresh CSRF token from login page
            var loginPage = await agent.get("/login");
            var match = loginPage.text.match(/name="_csrf"\s+value="([^"]+)"/);
            expect(match).not.toBeNull();
            var loginCsrf = match[1];

            var res = await agent
                .post("/login")
                .type("form")
                .send({
                    login_id: testEmail,
                    password: "password123",
                    _csrf: loginCsrf
                });
            expect(res.status).toBe(302);
            expect(res.headers.location).toBe("/");
        });

        afterAll(async function() {
            // Clean up test user from DB
            try {
                await db.getPool().query("DELETE FROM users WHERE email = $1", [testEmail]);
            } catch (_) {}
        });
    });
});

// Always-run test to confirm the test file itself is valid
describe("Test file sanity check", function() {
    it("loads without error", function() {
        expect(true).toBe(true);
    });

    if (!hasDbUrl) {
        it("skips integration tests when DATABASE_URL is not set", function() {
            console.log("INFO: Skipping integration tests (no DATABASE_URL). Unit tests in helpers.test.js still run.");
            expect(hasDbUrl).toBe(false);
        });
    }
});
