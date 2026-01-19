import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface LightningLogoProps {
  size?: "sm" | "md" | "lg";
  showGlow?: boolean;
  className?: string;
}

export function LightningLogo({ size = "md", showGlow = true, className }: LightningLogoProps) {
  const sizeClasses = {
    sm: "h-8 w-8",
    md: "h-10 w-10",
    lg: "h-14 w-14",
  };

  const iconSizes = {
    sm: "h-4 w-4",
    md: "h-5 w-5",
    lg: "h-7 w-7",
  };

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-sm bg-black border border-primary",
        sizeClasses[size],
        showGlow && "neon-border",
        className
      )}
      data-testid="logo-lightning"
    >
      <Zap
        className={cn(
          "text-primary fill-primary",
          iconSizes[size],
          showGlow && "drop-shadow-[0_0_8px_rgba(57,255,20,0.8)]"
        )}
      />
    </div>
  );
}
