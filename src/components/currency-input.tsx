"use client";
import { forwardRef } from "react";
import { Input } from "@/components/ui/input";

/** Numeric text field for money: shows the Rs. prefix, accepts digits and one decimal point. */
export const CurrencyInput = forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & { onValueChange?: (v: string) => void; invalid?: boolean; symbol?: string }>(
  ({ onValueChange, symbol = "Rs.", className, ...props }, ref) => (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{symbol}</span>
      <Input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        className={`num pl-11 text-right text-lg ${className ?? ""}`}
        {...props}
        onChange={(e) => {
          // Keep only digits, commas and a single decimal point.
          const cleaned = e.target.value.replace(/[^\d.,]/g, "");
          onValueChange?.(cleaned);
        }}
      />
    </div>
  ),
);
CurrencyInput.displayName = "CurrencyInput";
