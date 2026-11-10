process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://aac:aac@localhost:5432/aac_test";
process.env.PAYMENT_PROVIDER = "sandbox";
process.env.SANDBOX_WEBHOOK_SECRET = "whsec_test_secret";
process.env.APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-123";
process.env.DB_POOL_MAX = "30";
