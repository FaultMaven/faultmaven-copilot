import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { AuthSlice, createAuthSlice } from './slices/auth-slice';
import { SessionSlice, createSessionSlice } from './slices/session-slice';
import { CasesSlice, createCasesSlice } from './slices/cases-slice';
import { UISlice, createUISlice } from './slices/ui-slice';

// Combine all slices into the main store type
export type AppState = AuthSlice & SessionSlice & CasesSlice & UISlice;

// Create the store with all slices and devtools middleware
export const useAppStore = create<AppState>()(
  devtools(
    (...a) => ({
      ...createAuthSlice(...a),
      ...createSessionSlice(...a),
      ...createCasesSlice(...a),
      ...createUISlice(...a),
    }),
    { name: 'FaultMavenStore' }
  )
);

// Optional: Selector hooks for performance optimization
// export const useAuth = () => useAppStore((state) => ({ 
//   isAuthenticated: state.isAuthenticated, 
//   user: state.user,
//   login: state.login,
//   logout: state.logout
// }));
// ... other selectors
