"use client";
import * as React from "react";
import * as AD from "@radix-ui/react-alert-dialog";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";

export const AlertDialog = AD.Root;
export const AlertDialogTrigger = AD.Trigger;
export const AlertDialogCancel = AD.Cancel;
export const AlertDialogAction = AD.Action;

export const AlertDialogContent = React.forwardRef<React.ElementRef<typeof AD.Content>, React.ComponentPropsWithoutRef<typeof AD.Content>>(
  ({ className, ...props }, ref) => (
    <AD.Portal>
      <AD.Overlay className="fixed inset-0 z-50 bg-navy/50" />
      <AD.Content ref={ref} className={cn("fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-lg border bg-white p-6 shadow-lg", className)} {...props} />
    </AD.Portal>
  ),
);
AlertDialogContent.displayName = "AlertDialogContent";
export const AlertDialogTitle = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof AD.Title>) => <AD.Title className={cn("text-lg font-semibold text-navy", className)} {...p} />;
export const AlertDialogDescription = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof AD.Description>) => <AD.Description className={cn("text-sm text-muted-foreground", className)} {...p} />;
export const cancelClass = buttonVariants({ variant: "outline" });
export const destructiveClass = buttonVariants({ variant: "destructive" });
