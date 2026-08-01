export default function AwaLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 160 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="AWA SKIN"
    >
      <text
        x="0"
        y="20"
        fill="white"
        fontFamily="Inter, system-ui, sans-serif"
        fontSize="20"
        fontWeight="600"
        letterSpacing="6"
      >
        AWA
      </text>
      <text
        x="68"
        y="20"
        fill="white"
        fontFamily="Inter, system-ui, sans-serif"
        fontSize="20"
        fontWeight="300"
        letterSpacing="4"
      >
        SKIN
      </text>
    </svg>
  );
}
