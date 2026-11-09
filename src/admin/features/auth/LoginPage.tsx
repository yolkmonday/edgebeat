import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CircleAlert } from "lucide-react";
import { useLogin, useSession } from "@/api/use-session";
import { Logo } from "@/components/shared/Logo";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { isApiError } from "@/lib/api";

const schema = z.object({ password: z.string().min(1, "Enter your admin password.") });
type Values = z.infer<typeof schema>;

/** Only same-app absolute paths; blocks `//host` and `/\host` redirects. */
const safeNext = (next: string | null): string => (next && /^\/(?![/\\])/.test(next) ? next : "/");

const usePublicSiteName = () =>
  useQuery({
    queryKey: ["public-site-name"],
    queryFn: async () => {
      const res = await fetch("/api/v1/status");
      if (!res.ok) return null;
      const body = (await res.json()) as { siteName?: unknown };
      return typeof body.siteName === "string" ? body.siteName : null;
    },
    retry: false,
    staleTime: Infinity,
  });

const loginErrors = (e: unknown): { field?: string; form?: string } => {
  if (!isApiError(e)) return { form: "Can't reach the Worker. Check your connection." };
  if (e.status === 401) return { field: "Wrong password. Check for typos and try again." };
  if (e.status === 429) return { form: "Too many attempts. Wait a minute and try again." };
  if (e.code === "weak_admin_password")
    return { form: "ADMIN_PASSWORD is too weak. Set a new secret of at least 12 characters (not change-me) in Cloudflare, then sign in." };
  if (e.code === "server_misconfigured") return { form: "ENCRYPTION_KEY is missing or invalid. Set it in Cloudflare (32 random bytes, base64)." };
  if (e.code === "network") return { form: "Can't reach the Worker. Check your connection." };
  return { form: "Something went wrong. Try again." };
};

export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const session = useSession();
  const siteName = usePublicSiteName();
  const login = useLogin();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, setFocus, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: "" },
  });

  if (session.data) return <Navigate to={next} replace />;

  const onSubmit = handleSubmit(async ({ password }) => {
    setFormError(null);
    try {
      await login.mutateAsync(password);
      navigate(next, { replace: true });
    } catch (e) {
      const { field, form } = loginErrors(e);
      if (field) {
        setError("password", { message: field });
        setFocus("password", { shouldSelect: true });
      }
      if (form) setFormError(form);
    }
  });

  const subtitle = [siteName.data, location.host].filter(Boolean).join(" · ");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg p-4">
      <form
        onSubmit={onSubmit}
        noValidate
        className="flex w-full max-w-[400px] flex-col gap-6 rounded-lg border border-border bg-surface p-8 shadow-[0_1px_2px_var(--shadow)]"
      >
        <Logo wordmark />
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-[-0.02em] text-text">Sign in to admin</h1>
          <p className="text-sm text-muted">{subtitle}</p>
        </div>
        {formError ? (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-down-border bg-down-bg p-3 text-sm text-down-text">
            <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
            {formError}
          </p>
        ) : null}
        <Field label="Admin password" htmlFor="password" helper="The ADMIN_PASSWORD you set during install." error={formState.errors.password?.message}>
          <Input type="password" autoFocus autoComplete="current-password" {...register("password")} />
        </Field>
        <Button type="submit" loading={formState.isSubmitting} className="w-full">
          Sign in
        </Button>
      </form>
      <p className="max-w-[360px] text-center text-xs text-muted">
        Forgot it? Set a new ADMIN_PASSWORD secret in your Cloudflare dashboard, then sign in again.
      </p>
    </main>
  );
}
