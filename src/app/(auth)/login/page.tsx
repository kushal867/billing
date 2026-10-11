import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";
import { signupEnabled } from "@/lib/services/signup";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-xl font-bold text-white">K</div>
          <h1 className="text-2xl font-semibold text-navy">KusBill</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your Bills. Your Balance. Automatically.</p>
        </div>
        <LoginForm next={next} />
        {signupEnabled() && (
          <p className="text-center text-sm text-muted-foreground">New here? <Link href="/signup" className="font-medium text-primary hover:underline">Create an account</Link></p>
        )}
      </div>
    </main>
  );
}
