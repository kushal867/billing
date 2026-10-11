process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://kusbill:kusbill@localhost:5432/kusbill_test?schema=public";
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-test-secret";
