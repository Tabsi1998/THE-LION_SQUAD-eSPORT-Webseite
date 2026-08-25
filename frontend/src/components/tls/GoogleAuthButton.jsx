import { startGoogleLogin } from "@/context/AuthContext";

// Official Google "G" mark.
function GoogleG({ className = "w-5 h-5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.66 4.1-5.5 4.1-3.3 0-6-2.73-6-6.1s2.7-6.1 6-6.1c1.88 0 3.14.8 3.86 1.49l2.63-2.53C16.86 3.1 14.66 2.1 12 2.1 6.98 2.1 2.9 6.18 2.9 11.2S6.98 20.3 12 20.3c5.78 0 9.6-4.06 9.6-9.78 0-.66-.07-1.16-.16-1.66H12z"/>
    </svg>
  );
}

export function GoogleAuthButton({ label = "Mit Google fortfahren", returnPath = "/dashboard" }) {
  return (
    <div className="mt-5" data-testid="google-auth-block">
      <div className="flex items-center gap-3 my-4">
        <span className="h-px flex-1 bg-white/10" />
        <span className="text-[10px] uppercase tracking-[0.3em] text-white/35">oder</span>
        <span className="h-px flex-1 bg-white/10" />
      </div>
      <button
        type="button"
        data-testid="google-auth-button"
        onClick={() => startGoogleLogin(returnPath)}
        className="w-full flex items-center justify-center gap-3 py-3 rounded-sm bg-white text-[#1f1f1f] font-bold tracking-wide hover:bg-white/90 transition"
      >
        <GoogleG />
        {label}
      </button>
    </div>
  );
}
