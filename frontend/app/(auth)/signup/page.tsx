"use client";

import Link from "next/link";
import Image from "next/image";
import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trackPixel } from "@/components/meta-pixel";
import { signupAction, type AuthState } from "../actions";

const initialState: AuthState = { error: null };

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signupAction, initialState);

  // Signup succeeded once the confirmation-email screen shows. Report it to the
  // Meta Pixel as a "CompleteRegistration" — a useful mid-funnel conversion to
  // optimise ads toward while paid subscriptions are still too sparse to bid on.
  useEffect(() => {
    if (state.emailSent) trackPixel("CompleteRegistration");
  }, [state.emailSent]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fbfaf7] px-4 text-neutral-950">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2 text-[15px] font-semibold">
          <Image src="/evr-logo.png" alt="" width={20} height={20} className="h-5 w-5" />
          EvolveRun
        </Link>
        <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
          {state.emailSent ? (
            <div className="text-center">
              <h1 className="evr-headline text-[30px] tracking-[-0.03em]">Check your email</h1>
              <p className="mt-3 text-[14.5px] text-neutral-600">
                We sent a confirmation link to your inbox. Click it to verify your account, then
                you&apos;ll set up your subscription.
              </p>
              <p className="mt-4 text-[13px] text-neutral-500">
                Didn&apos;t get it? Check your spam folder.
              </p>
              <Link
                href="/login"
                className="mt-6 inline-block text-[13.5px] font-medium text-[#dc6b3f] hover:underline"
              >
                Back to log in
              </Link>
            </div>
          ) : (
            <>
          <h1 className="evr-headline text-[30px] tracking-[-0.03em]">Create your account</h1>
          <p className="mt-2 text-[14.5px] text-neutral-600">Start your adaptive training journey.</p>
          <form action={formAction} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">Full name</Label>
              <Input id="fullName" name="fullName" type="text" required autoComplete="name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password (min. 8 characters)</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            {state.error && (
              <p className="text-sm text-red-600" role="alert">
                {state.error}
              </p>
            )}
            <Button
              type="submit"
              className="w-full bg-neutral-950 text-white hover:bg-neutral-800"
              disabled={pending}
            >
              {pending ? "Creating..." : "Create account"}
            </Button>
          </form>
          <p className="mt-5 text-center text-[13.5px] text-neutral-500">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-[#dc6b3f] hover:underline">
              Log in
            </Link>
          </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
