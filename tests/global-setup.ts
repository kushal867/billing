import { execSync } from "node:child_process";

export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://kusbill:kusbill@localhost:5432/kusbill_test?schema=public";
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url } });
}
