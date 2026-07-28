import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import { KeyRound, Loader2, FlaskConical, CheckCircle } from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const resetMutation = useMutation({
    mutationFn: () => api.resetPassword({ email, newPassword }),
  });

  const handleReset = () => {
    setValidationError(null);
    if (!email) {
      setValidationError("Email is required");
      return;
    }
    if (newPassword !== confirmPassword) {
      setValidationError("Passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      setValidationError("Password must be at least 8 characters");
      return;
    }
    if (!/[A-Z]/.test(newPassword)) {
      setValidationError("Password must contain at least one uppercase letter");
      return;
    }
    if (!/[a-z]/.test(newPassword)) {
      setValidationError("Password must contain at least one lowercase letter");
      return;
    }
    if (!/[0-9]/.test(newPassword)) {
      setValidationError("Password must contain at least one number");
      return;
    }
    resetMutation.mutate();
  };

  if (resetMutation.isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="w-full max-w-md text-center">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Password Reset!</h2>
          <p className="text-gray-500 dark:text-gray-400 mb-4">Your password has been changed successfully.</p>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-md font-medium hover:bg-orange-600"
          >
            Sign In
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
          <p className="text-sm text-gray-500 dark:text-gray-400">Reset your password</p>
        </div>

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 shadow-sm">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md text-sm focus:ring-2 focus:ring-orange-300 focus:border-orange-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 8 chars, uppercase, lowercase, number"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md text-sm focus:ring-2 focus:ring-orange-300 focus:border-orange-400 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md text-sm focus:ring-2 focus:ring-orange-300 focus:border-orange-400 outline-none"
                onKeyDown={(e) => e.key === "Enter" && handleReset()}
              />
            </div>

            {(validationError || resetMutation.isError) && (
              <p className="text-red-500 text-sm">
                {validationError || (resetMutation.error as Error).message}
              </p>
            )}

            <button
              onClick={handleReset}
              disabled={resetMutation.isPending}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-500 text-white rounded-md font-medium hover:bg-orange-600 disabled:opacity-50 transition-colors"
            >
              {resetMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <KeyRound className="w-4 h-4" />
              )}
              Reset Password
            </button>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 text-center text-sm">
            <Link to="/login" className="text-orange-600 hover:text-orange-700">
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
