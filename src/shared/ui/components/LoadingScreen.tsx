import React from 'react';

interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message = 'Loading...' }: LoadingScreenProps) {
  return (
    <div className="flex items-center justify-center h-screen bg-fm-bg">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-fm-blue mb-4"></div>
        <p className="text-fm-dim">{message}</p>
      </div>
    </div>
  );
}
