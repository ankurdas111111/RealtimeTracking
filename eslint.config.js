const js = require("@eslint/js");

module.exports = [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2020,
            globals: {
                require: "readonly",
                module: "readonly",
                exports: "writable",
                process: "readonly",
                __dirname: "readonly",
                console: "readonly",
                setTimeout: "readonly",
                setInterval: "readonly",
                clearTimeout: "readonly",
                clearInterval: "readonly",
                Date: "readonly",
                Map: "readonly",
                Set: "readonly",
                Array: "readonly",
                Object: "readonly",
                Number: "readonly",
                Math: "readonly",
                Promise: "readonly",
                Buffer: "readonly",
                JSON: "readonly",
                Error: "readonly",
                describe: "readonly",
                it: "readonly",
                expect: "readonly",
                beforeAll: "readonly",
                afterAll: "readonly",
                test: "readonly"
            }
        },
        rules: {
            "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
            "no-console": "off",
            "semi": ["warn", "always"],
            "eqeqeq": ["error", "always"],
            "no-var": "off"
        }
    },
    {
        ignores: ["frontend/js/tracking.js", "frontend/js/country-codes.js", "node_modules/"]
    }
];
