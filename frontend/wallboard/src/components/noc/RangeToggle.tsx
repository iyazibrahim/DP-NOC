import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export type WebsiteRange = "24h" | "7d" | "30d";

const OPTIONS: WebsiteRange[] = ["24h", "7d", "30d"];

export function RangeToggle({
  value,
  onChange,
  className,
  options = OPTIONS
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  options?: string[];
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => {
        if (v) onChange(v);
      }}
      variant="outline"
      size="sm"
      className={cn("justify-start", className)}
    >
      {options.map((opt) => (
        <ToggleGroupItem key={opt} value={opt} aria-label={opt}>
          {opt}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
