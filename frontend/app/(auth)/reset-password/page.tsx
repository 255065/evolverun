"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updatePasswordAction, type AuthState } from "../actions";

const initialState: AuthState = { error: null };

export default function ResetPasswordPage() {
  const [state, formAction, pending] = useActionState(updatePasswordAction, initialState);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fbfaf7] px-4 text-neutral-950">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2 text-[15px] font-semibold">
          <Image src="/evr-logo.png" alt="" width={20} height={20} className="h-5 w-5" />
          EvolveRun
        </Link>
        <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
          <h1 className="evr-headline text-[30px] tracking-[-0.03em]">Choose a new password</h1>
          <p className="mt-2 text-[14.5px] text-neutral-600">
            Enter a new password for your account.
          </p>
          <form action={formAction} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input
                id="confirm"
                name="confirm"
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
              {pending ? "Saving..." : "Update password"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
