// Queue Cure mark: a simple icon tile in brand blue. Pure CSS + icon, so
// there is no logo image to load or go missing.
import { Hospital } from "@phosphor-icons/react";

function BrandMark({ className = "w-9 h-9" }) {
  return (
    <div
      className={`${className} bg-primary-600 rounded-xl flex items-center justify-center`}
      aria-hidden="true"
    >
      <Hospital weight="fill" className="w-[55%] h-[55%] text-white" />
    </div>
  );
}

export default BrandMark;
