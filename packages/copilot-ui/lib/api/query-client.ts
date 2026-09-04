import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30, // 30 minutes
      retry: 1,
      refetchOnWindowFocus: false,
      // `true` (not 'always') so reconnect respects staleTime — an extension
      // sees frequent connectivity transitions (SW sleep/wake, network changes)
      // and 'always' would refetch every active query on each blip.
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});
