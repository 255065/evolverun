"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordResetAction, type ResetRequestState } from "../actions";

const initialState: ResetRequestState = { error: null, sent: false };

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, initialState);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fbfaf7] px-4 text-neutral-950">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2 text-[15px] font-semibold">
          <Image src="/evr-logo.png" alt="" width={20} height={20} className="h-5 w-5" />
          EvolveRun
        </Link>
        <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
          <h1 className="evr-headline text-[30px] tracking-[-0.03em]">Reset your password</h1>

          {state.sent ? (
            <p className="mt-3 text-[14.5px] text-neutral-600" role="status">
              If an account exists for that email, we&apos;ve sent a link to reset your password.
              Check your inbox (and spam).
            </p>
          ) : (
            <>
              <p className="mt-2 text-[14.5px] text-neutral-600">
                Enter your email and we&apos;ll send you a reset link.
              </p>
              <form action={formAction} className="mt-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" required autoComplete="email" />
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
                  {pending ? "Sending..." : "Send reset link"}
                </Button>
              </form>
            </>
          )}

          <p className="mt-5 text-center text-[13.5px] text-neutral-500">
            <Link href="/login" className="font-medium text-[#dc6b3f] hover:underline">
              Back to log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
