process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://kusbill:kusbill@localhost:5432/kusbill_test?schema=public";
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-test-secret";
// Email goes to an in-memory outbox in tests, and links are built from this fixed address.
process.env.MAIL_TRANSPORT = "memory";
process.env.APP_URL = "https://kusbill.test";
