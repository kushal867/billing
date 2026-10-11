import bcrypt from "bcryptjs";

const COST = 12;
export const hashPassword = (plain: string) => bcrypt.hash(plain, COST);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);
// Used to burn equal time when the email does not exist (avoids user enumeration by timing).
let dummy: string | undefined;
export const dummyHash = () => (dummy ??= bcrypt.hashSync("kusbill-dummy-password", COST));

export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return "Password must be at least 8 characters";
  if (pw.length > 128) return "Password is too long";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Password must contain letters and numbers";
  return null;
}
