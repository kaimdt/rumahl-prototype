import { Toaster as Sonner, ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: "glass-toast",
          title: "text-foreground font-medium",
          description: "text-muted-foreground",
          actionButton: "bg-primary text-primary-foreground",
          cancelButton: "bg-muted text-muted-foreground",
          error: "glass-toast-error",
          success: "glass-toast-success",
          warning: "glass-toast-warning",
          info: "glass-toast-info",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
