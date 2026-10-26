export default function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand${light ? " brand-light" : ""}`}>
      <span className="brand-symbol" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M5 18V6h4l6 8V6h4v12h-4L9 10v8H5Z" fill="currentColor" />
        </svg>
      </span>
      <span>
        novigo<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
