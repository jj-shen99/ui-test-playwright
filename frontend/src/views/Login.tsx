import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { setCurrentUser } from "../useCurrentUser";
import { LogIn, Loader2, FlaskConical } from "lucide-react";

export default function Login() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });

  const mutation = useMutation({
    mutationFn: () => api.loginUser(form),
    onSuccess: (data) => {
      setCurrentUser(data.user);
      navigate("/");
    },
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <FlaskConical className="w-8 h-8 text-orange-500" />
            <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">OODP UI Testing</span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">Sign in to your account</p>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 shadow-sm">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="you@example.com"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md text-sm focus:ring-2 focus:ring-orange-300 focus:border-orange-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Enter your password"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md text-sm focus:ring-2 focus:ring-orange-300 focus:border-orange-400 outline-none"
                onKeyDown={(e) => e.key === "Enter" && mutation.mutate()}
              />
            </div>

            {mutation.isError && (
              <p className="text-red-500 text-sm">{(mutation.error as Error).message}</p>
            )}

            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || !form.email || !form.password}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-500 text-white rounded-md font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors"
            >
              {mutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              Sign In
            </button>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 flex justify-between text-sm">
            <Link to="/register" className="text-orange-600 hover:text-orange-700">
              Create an account
            </Link>
            <Link to="/forgot-password" className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
              Forgot password?
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
