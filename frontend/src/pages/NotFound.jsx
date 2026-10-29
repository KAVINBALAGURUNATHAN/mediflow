import { useNavigate } from "react-router-dom";

function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12 flex items-center justify-center">
      <div className="glass-card p-8 sm:p-10 rounded-2xl text-center max-w-md animate-scale-in">
        <div className="w-24 h-24 bg-primary-600 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-lg">
          <svg className="w-12 h-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="page-heading mb-2">404</h1>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Page Not Found</h2>
        <p className="text-slate-600 dark:text-slate-500 mb-8">
          The page you are looking for doesn't exist.
        </p>
        <button
          onClick={() => navigate("/")}
          className="btn-primary"
        >
          Go Home
        </button>
      </div>
    </div>
  );
}

export default NotFound;