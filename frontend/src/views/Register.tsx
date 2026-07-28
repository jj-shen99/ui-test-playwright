import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { UserPlus, Loader2, FlaskConical, CheckCircle } from "lucide-react";

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", name: "", password: "", confirmPassword: "" });
  const [validationError, setValidationError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => api.registerUser({ email: form.email, name: form.name, password: form.password }),
    onSuccess: () => {
      // Auto-navigate to login after short delay
      setTimeout(() => navigate("/login"), 2000);
    },
  });

  const handleSubmit = () => {
    setValidationError(null);

    if (!form.email || !form.name || !form.password) {
      setValidationError("All fields are required");
      return;
    }
    if (form.password !== form.confirmPassword) {
      setValidationError("Passwords do not match");
      return;
    }
    if (form.password.length < 8) {
      setValidationError("Password must be at least 8 characters");
      return;
    }
    if (!/[A-Z]/.test(form.password)) {
      setValidationError("Password must contain at least one uppercase letter");
      return;
    }
    if (!/[a-z]/.test(form.password)) {
      setValidationError("Password must contain at least one lowercase letter");
      return;
    }
    if (!/[0-9]/.test(form.password)) {
      setValidationError("Password must contain at least one number");
      return;
    }

    mutation.mutate();
  };

  if (mutation.isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="w-full max-w-md text-center">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Registration Successful!</h2>
          <p className="text-gray-500 dark:text-gray-400 mb-4">Your account has been created. Redirecting to login...</p>
          <Link to="/login" className="text-orange-600 hover:text-orange-700 font-medium">
            Go to Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <FlaskConical className="w-8 h-8 text-orange-500" />
            <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">OODP UI Testing</span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">Create a new account</p>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 shadow-sm">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Full Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="John Doe"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md text-sm focus:ring-2 focus:ring-orange-300 focus:border-orange-400 outline-none"
              />
            </div>
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
                placeholder="Min 8 chars, uppercase, lowercase, number"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md text-sm focus:ring-2 focus:ring-orange-300 focus:border-orange-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm Password</label>
              <input
                type="password"
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                placeholder="Re-enter your password"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md text-sm focus:ring-2 focus:ring-orange-300 focus:border-orange-400 outline-none"
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
            </div>

            {(validationError || mutation.isError) && (
              <p className="text-red-500 text-sm">
                {validationError || (mutation.error as Error).message}
              </p>
            )}

            <button
              onClick={handleSubmit}
              disabled={mutation.isPending}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-500 text-white rounded-md font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors"
            >
              {mutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <UserPlus className="w-4 h-4" />
              )}
              Create Account
            </button>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 text-center text-sm">
            <span className="text-gray-500 dark:text-gray-400">Already have an account? </span>
            <Link to="/login" className="text-orange-600 hover:text-orange-700">
              Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
