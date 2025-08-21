import React, { useEffect, useState } from "react";

interface AriaLiveRegionProps {
  message: string;
  priority?: 'polite' | 'assertive';
  clearAfter?: number; // Clear message after X milliseconds
}

export default function AriaLiveRegion({ 
  message, 
  priority = 'polite', 
  clearAfter = 3000 
}: AriaLiveRegionProps) {
  const [currentMessage, setCurrentMessage] = useState("");

  useEffect(() => {
    if (message) {
      setCurrentMessage(message);
      
      if (clearAfter > 0) {
        const timer = setTimeout(() => {
          setCurrentMessage("");
        }, clearAfter);
        
        return () => clearTimeout(timer);
      }
    }
  }, [message, clearAfter]);

  return (
    <div
      aria-live={priority}
      aria-atomic="true"
      className="sr-only"
    >
      {currentMessage}
    </div>
  );
}