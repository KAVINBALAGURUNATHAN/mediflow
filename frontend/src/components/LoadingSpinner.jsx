import PropTypes from "prop-types";

const LoadingSpinner = ({
  size = "md",
  text = "Loading...",
  variant = "spinner",
  skeletonRows = 5,
}) => {
  const sizes = {
    sm: "w-4 h-4",
    md: "w-8 h-8",
    lg: "w-12 h-12",
  };

  const spinnerSize = sizes[size] || sizes.md;
  const rows = Math.max(1, skeletonRows);

  if (variant === "skeleton") {
    return (
      <div
        className="p-5 space-y-4 animate-fade-in"
        role="status"
        aria-live="polite"
        aria-label={text}
      >
        <div className="skeleton h-5 w-32" />

        {[...Array(rows)].map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="skeleton h-10 w-12 shrink-0 rounded-xl" />

            <div className="flex-1 space-y-2">
              <div className="skeleton h-4 w-3/4" />
              <div className="skeleton h-3 w-1/2" />
            </div>

            <div className="skeleton h-6 w-20 shrink-0 rounded-full" />
          </div>
        ))}

        <span className="sr-only">{text}</span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center justify-center gap-4 py-12 animate-fade-in"
      role="status"
      aria-live="polite"
      aria-label={text}
    >
      <div
        className={`${spinnerSize} border-[3px] border-slate-200/80 dark:border-slate-600/50 border-t-teal-500 rounded-full animate-spin`}
        aria-hidden="true"
      />

      {text && (
        <p className="text-sm font-medium text-slate-500 dark:text-slate-500">
          {text}
        </p>
      )}

      <span className="sr-only">{text}</span>
    </div>
  );
};

LoadingSpinner.propTypes = {
  size: PropTypes.oneOf(["sm", "md", "lg"]),
  text: PropTypes.string,
  variant: PropTypes.oneOf(["spinner", "skeleton"]),
  skeletonRows: PropTypes.number,
};

export default LoadingSpinner;