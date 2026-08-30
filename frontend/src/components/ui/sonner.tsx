import { Toaster as Sonner, ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      position="bottom-right"
      offset={44}
      mobileOffset={10}
      visibleToasts={5}
      expand
      gap={8}
      toastOptions={{
        classNames: {
          toast: "glass-toast rumahl-system-toast",
          title: "rumahl-system-toast-title text-foreground font-medium",
          description: "rumahl-system-toast-description text-muted-foreground",
          actionButton: "rumahl-system-toast-action bg-primary text-primary-foreground",
          cancelButton: "rumahl-system-toast-cancel bg-muted text-muted-foreground",
          error: "glass-toast-error",
          success: "glass-toast-success",
          warning: "glass-toast-warning",
          info: "glass-toast-info",
        },
        style: { bottom: "max(0.5rem, env(safe-area-inset-bottom))" },
      }}
      {...props}
    />
  )
}

export { Toaster }
